import { refreshAdaptiveLearning } from "./adaptive-learning";
import { SYMBOLS, CFG } from "./config";
import { getBundle, getOutcomeCandles } from "../lib/prices";
import { getCalendar, getMacroContext, newsBlock } from "../lib/macro";
import { assessFundamentals } from "./fundamental-engine";
import { isMarketOpen } from "./sessions";
import { evaluateOutcome, Sig } from "./outcome";
import { newId } from "../lib/auth";
import { detectLiquiditySetup } from "./liquidity-engine";
import { cacheGet, cacheSet } from "../lib/cache";
import { tgConfigured, tgSend } from "../lib/telegram";

const HOUR = 3_600_000;
const SLOT = 15 * 60_000; // cadence de détection M15

/**
 * V2 Liquidity Intelligence is an independent rule-based detector.
 * It consumes the same market candles as Origin but does not call Origin's evaluate()
 * and writes only to shadow_signals / shadow_runs.
 */
export async function runShadowEngine(env: Env, opts: { force?: boolean; symbol?: string } = {}) {
  const now = Date.now();
  const cal = await getCalendar(env);
  // Le contexte fondamental est mis en cache par macro.ts ; si les sources sont indisponibles,
  // le moteur conserve une évaluation technique sans inventer de données macro.
  let macroText = "";
  try { macroText = await getMacroContext(env); } catch (e) { console.error("V2 fundamentals unavailable", String(e)); }
  const results: Array<{symbol:string;status:string;score:number;note:string}> = [];
  for (const s of SYMBOLS) {
    if (opts.symbol && opts.symbol !== s.symbol) continue;
    if (!opts.force && !isMarketOpen(s, now)) continue;
    const bucket = Math.floor(now / SLOT);
    const seen = await env.DB.prepare("SELECT symbol FROM shadow_runs WHERE symbol=? AND bucket_hour=?").bind(s.symbol,bucket).first();
    if (seen) continue;
    try {
      const maxAge = s.session === "us" ? 9_000_000 : 7_500_000;
      const bundle = await getBundle(env,s,now,maxAge);
      const {m15,h1,h4,d1} = bundle;
      if (!h1.length || !h4.length || !d1.length ||
          h1.length < 60 || h4.length < 60 || d1.length < 60 || m15.length < 50 ||
          now-h1[h1.length-1].t>maxAge || now-m15[m15.length-1].t>30*60_000 ||
          now-h4[h4.length-1].t>12*HOUR || now-d1[d1.length-1].t>48*HOUR) {
        results.push({symbol:s.symbol,status:"stale",score:0,note:"Données de marché trop anciennes ou historique M15 insuffisant."});
        await env.DB.prepare("INSERT OR IGNORE INTO shadow_runs(symbol,bucket_hour,status,score,created_at) VALUES(?,?,'stale',0,?)").bind(s.symbol,bucket,Math.floor(now/1000)).run();
        continue;
      }
      // Une seule position Shadow ouverte pour l'ensemble des actifs.
      // Le contrôle est répété dans l'INSERT conditionnel pour éviter les courses concurrentes.
      const open = await env.DB.prepare("SELECT COUNT(*) n FROM shadow_signals WHERE outcome='open'").first<{n:number}>();
      const news = cal.ok ? newsBlock(cal.events,s.currencies,now,CFG.newsBeforeMin,CFG.newsAfterMin) : "calendrier économique indisponible : observation suspendue";
      const setup = detectLiquiditySetup(s,m15,h1,h4,d1,now,{
        newsBlocked: news !== null,
        marketOpen: isMarketOpen(s,now),
        hasOpen: (open?.n ?? 0)>0,
      });
      const fundamental = setup.passed
        ? assessFundamentals(s.symbol, setup.dir, macroText)
        : null;
      const finalScore = fundamental ? Math.max(0, Math.min(100, setup.score + fundamental.adjustment)) : setup.score;
      const initialRisk = Math.abs(setup.entry - setup.sl);
      const targetR = setup.tps.map(tp => initialRisk > 0
        ? (setup.dir === "BUY" ? tp - setup.entry : setup.entry - tp) / initialRisk
        : 0);
      const rrValid = targetR.length === 3 && targetR[0] >= 2 && targetR[1] >= 5 && targetR[2] >= 8;
      const finalPassed = setup.passed && rrValid && finalScore >= 82 && !(fundamental?.veto ?? false);
      if (setup.passed && !rrValid) setup.rejection = `Objectifs insuffisants après arrondi : TP1 ${targetR[0]?.toFixed(2)}R / TP2 ${targetR[1]?.toFixed(2)}R / TP3 ${targetR[2]?.toFixed(2)}R ; minimum 2R / 5R / 8R.`;
      if (fundamental) setup.reasons.push(fundamental.summary);
      if (!finalPassed) {
        const note = (fundamental?.veto ? "Contradiction fondamentale forte ; " : "") +
          (setup.passed && !rrValid ? setup.rejection : setup.passed ? `Score final ${finalScore}/100 inférieur au seuil V2 82/100.` : setup.rejection || "Aucun setup V2 validé.");
        results.push({symbol:s.symbol,status:"rejected",score:finalScore,note});
        await env.DB.prepare("INSERT OR IGNORE INTO shadow_runs(symbol,bucket_hour,status,score,created_at) VALUES(?,?, 'rejected',?,?)").bind(s.symbol,bucket,finalScore,Math.floor(now/1000)).run();
        continue;
      }
      const id = newId();
      const inserted = await env.DB.prepare(`INSERT OR IGNORE INTO shadow_signals
        (id,symbol,direction,entry,stop_loss,tp1,tp2,tp3,score,strategy,reasoning,outcome,tp_reached,r_multiple,created_at,bucket_hour,telegram_sent_at)
        SELECT ?,?,?,?,?,?,?,?,?,?,?,'open',0,NULL,?,?,NULL
        WHERE NOT EXISTS (SELECT 1 FROM shadow_signals WHERE outcome='open')`)
        .bind(id,s.symbol,setup.dir,setup.entry,setup.sl,setup.tps[0],setup.tps[1],setup.tps[2],finalScore,setup.strategy,setup.reasons.join(" · ").slice(0,1200),Math.floor(now/1000),bucket).run();
      const created = Number(inserted.meta?.changes ?? 0) > 0;
      if (!created) {
        const note = "Un autre signal Shadow est déjà ouvert ; candidat ignoré pour respecter la limite globale d'une position.";
        await env.DB.prepare("INSERT OR IGNORE INTO shadow_runs(symbol,bucket_hour,status,score,created_at) VALUES(?,?, 'blocked_open_position',?,?)").bind(s.symbol,bucket,finalScore,Math.floor(now/1000)).run();
        results.push({symbol:s.symbol,status:"blocked_open_position",score:finalScore,note});
        continue;
      }
      await env.DB.prepare("INSERT OR IGNORE INTO shadow_runs(symbol,bucket_hour,status,score,created_at) VALUES(?,?, 'candidate',?,?)").bind(s.symbol,bucket,finalScore,Math.floor(now/1000)).run();
      results.push({symbol:s.symbol,status:"shadow_candidate",score:finalScore,note:"Setup V2 validé ; position Shadow unique ouverte après filtres techniques et fondamentaux."});
    } catch(e) {
      const note=String((e as Error).message??e).slice(0,250);
      console.error("V2 shadow",s.symbol,note);
      results.push({symbol:s.symbol,status:"error",score:0,note});
      await env.DB.prepare("INSERT OR IGNORE INTO shadow_runs(symbol,bucket_hour,status,score,created_at) VALUES(?,?, 'error',0,?)").bind(s.symbol,bucket,Math.floor(now/1000)).run().catch(()=>{});
    }
  }
  const lastTrack=Number(await cacheGet(env,"shadow:track:last")??0);
  if (now-lastTrack>=15*60_000) {
    await cacheSet(env,"shadow:track:last",String(now),30*60);
    await trackShadowOutcomes(env,now);
  }
  await refreshAdaptiveLearning(env).catch(e => console.error("V2 adaptive learning", String(e)));
  await flushShadowTelegramNotifications(env, now);
  await flushShadowOutcomeEvents(env);
  return results;
}

async function flushShadowTelegramNotifications(env: Env, now: number): Promise<void> {
  if (env.TELEGRAM_V2_ENABLED === "false" || !tgConfigured(env)) return;
  const configured = Number(env.TELEGRAM_V2_MIN_SCORE);
  const minScore = Number.isFinite(configured) && configured >= 0 ? Math.min(100, configured) : 82;
  const pending = await env.DB.prepare(
    "SELECT id,symbol,direction,entry,stop_loss,tp1,tp2,tp3,score,strategy,reasoning,created_at FROM shadow_signals WHERE telegram_sent_at IS NULL AND score>=? AND created_at>=? ORDER BY created_at ASC LIMIT 10"
  ).bind(minScore, Math.floor(now / 1000) - 86400).all<{
    id:string;symbol:string;direction:string;entry:number;stop_loss:number;tp1:number;tp2:number|null;tp3:number|null;
    score:number;strategy:string|null;reasoning:string|null;created_at:number;
  }>();
  const esc = (v: string) => v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  const price = (v:number|null) => v == null ? "—" : String(v);
  const rr = (entry:number, sl:number, target:number|null, direction:string) => {
    if (target == null) return "—";
    const risk = Math.abs(entry - sl);
    if (!(risk > 0)) return "—";
    const reward = direction === "BUY" ? target - entry : entry - target;
    return `${(reward / risk).toFixed(2)}R`;
  };
  for (const s of pending.results) {
    const reasons = (s.reasoning ?? "").split(" · ").map(x => x.trim()).filter(Boolean);
    const technical = reasons.filter(x => /sweep|liquidit|MSS|CHoCH|displacement|FVG|premium|discount|range|borne|rejet|breakout|cassure|kill zone|asiatique|mèche|ATR|obstacle|structure|biais H/i.test(x));
    const fundamental = reasons.filter(x => /fondamental|macro|USD|EUR|GBP|JPY|news|actualité|calendrier|taux|CFTC|VIX/i.test(x) && !technical.includes(x));
    const other = reasons.filter(x => !technical.includes(x) && !fundamental.includes(x));
    const date = new Date(s.created_at * 1000).toLocaleString("fr-FR", { timeZone: "Africa/Ouagadougou", dateStyle: "medium", timeStyle: "short" });
    const lines = [
      "🧪 <b>LUCIDE SNIPER V2</b>",
      "<b>ALERTE DE SETUP — MODE SHADOW</b>",
      "━━━━━━━━━━━━━━━━━━",
      "<b>1. IDENTIFICATION</b>",
      `• Actif : <b>${esc(s.symbol)}</b>`,
      `• Direction : <b>${s.direction === "BUY" ? "🟢 ACHAT (BUY)" : "🔴 VENTE (SELL)"}</b>`,
      `• Score de sélection : <b>${s.score}/100</b>`,
      `• Stratégie : <b>${esc(s.strategy ?? "ICT / SMC")}</b>`,
      "",
      "<b>2. PLAN DE TRADE</b>",
      `• Entrée : <code>${price(s.entry)}</code>`,
      `• Stop Loss : <code>${price(s.stop_loss)}</code>`,
      `• Risque initial : <b>1R</b>`,
      "",
      "<b>3. OBJECTIFS &amp; RENDEMENT</b>",
      `• TP1 : <code>${price(s.tp1)}</code> — <b>${rr(s.entry,s.stop_loss,s.tp1,s.direction)}</b>`,
      `• TP2 : <code>${price(s.tp2)}</code> — <b>${rr(s.entry,s.stop_loss,s.tp2,s.direction)}</b>`,
      `• TP3 : <code>${price(s.tp3)}</code> — <b>${rr(s.entry,s.stop_loss,s.tp3,s.direction)}</b>`,
      "• Extension : <b>jusqu’à 30R</b> si la liquidité et la structure le permettent ; non garantie.",
      "",
      "<b>4. CONFIRMATIONS TECHNIQUES</b>",
      ...(technical.length ? technical.slice(0,7).map(x => `• ${esc(x.slice(0,180))}`) : ["• Détails techniques non fournis."]),
      "",
      "<b>5. CONTEXTE FONDAMENTAL</b>",
      ...(fundamental.length ? fundamental.slice(0,3).map(x => `• ${esc(x.slice(0,180))}`) : ["• Aucun élément fondamental distinct enregistré dans ce signal."]),
      ...(other.length ? ["", "<b>6. NOTES DU MOTEUR</b>", ...other.slice(0,2).map(x => `• ${esc(x.slice(0,160))}`)] : []),
      "",
      "<b>7. STATUT &amp; HORODATAGE</b>",
      "• Statut : <b>VIRTUEL — SHADOW</b>",
      `• Détecté : ${esc(date)} (UTC)`,
      "• Moteur Origin : inchangé ; aucune position réelle ouverte.",
      "━━━━━━━━━━━━━━━━━━",
      "⚠️ <i>Signal expérimental de V2. Les objectifs sont des projections, pas des gains garantis. Vérifier spread, exécution et risque avant toute décision.</i>"
    ];
    const sent = await tgSend(env, lines.join("\n"));
    if (sent.ok) {
      await env.DB.prepare("UPDATE shadow_signals SET telegram_sent_at=? WHERE id=? AND telegram_sent_at IS NULL")
        .bind(Math.floor(now/1000), s.id).run();
    } else {
      console.error("telegram V2 setup", s.id, sent.errors.join(" | "));
    }
  }
}

type ShadowTelegramEvent = {
  id: string; signal_id: string; event_type: string; symbol: string;
  status: string; r_multiple: number | null; message: string | null; created_at: number;
};

async function queueShadowTelegramEvent(env: Env, signalId: string, symbol: string, eventType: string, payload: Record<string, unknown>, now: number): Promise<void> {
  // Schéma D1 déjà présent en production : id, signal_id, event_type, symbol,
  // status, r_multiple, message, created_at, sent_at.
  // La contrainte UNIQUE(signal_id,event_type) assure la déduplication.
  const rMultiple = typeof payload.r_multiple === "number" ? payload.r_multiple : null;
  await env.DB.prepare(`INSERT OR IGNORE INTO shadow_telegram_events
    (id,signal_id,event_type,symbol,status,r_multiple,message,created_at,sent_at)
    VALUES (?,?,?,?, 'pending',?,?,?,NULL)`)
    .bind(newId(), signalId, eventType, symbol, rMultiple, JSON.stringify(payload), Math.floor(now / 1000)).run();
}

async function flushShadowOutcomeEvents(env: Env): Promise<void> {
  if (env.TELEGRAM_V2_ENABLED === "false" || !tgConfigured(env)) return;
  const pending = await env.DB.prepare(`SELECT e.id,e.signal_id,e.event_type,e.symbol,e.status,e.r_multiple,e.message,e.created_at,
      s.direction,s.entry,s.stop_loss,s.tp1,s.tp2,s.tp3,s.score,s.strategy,s.r_multiple AS signal_r_multiple,s.outcome
    FROM shadow_telegram_events e JOIN shadow_signals s ON s.id=e.signal_id
    WHERE e.status='pending' AND e.sent_at IS NULL ORDER BY e.created_at ASC LIMIT 25`).all<ShadowTelegramEvent & {
      symbol:string;direction:string;entry:number;stop_loss:number;tp1:number;tp2:number|null;tp3:number|null;
      score:number;strategy:string|null;r_multiple:number|null;outcome:string;
    }>();
  const esc = (v: string) => v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
  for (const e of pending.results) {
    let details: Record<string, unknown> = {};
    try { details = e.message ? JSON.parse(e.message) as Record<string, unknown> : {}; } catch { /* payload optionnel */ }
    const labels: Record<string,string> = {
      tp1:"🎯 TP1 ATTEINT", tp2:"🎯 TP2 ATTEINT", tp3:"🏆 TP3 ATTEINT",
      sl:"🛑 STOP LOSS ATTEINT", trailing_sl:"🛡️ STOP DE PROTECTION TOUCHÉ",
      expired:"⌛ SIGNAL EXPIRÉ / INVALIDÉ"
    };
    const eventTitle = labels[e.event_type] ?? "📍 MISE À JOUR DU SIGNAL";
    const eventR = typeof details.r_multiple === "number" ? `${details.r_multiple.toFixed(2)}R` : "—";
    const exitLabel = typeof details.exit_label === "string" ? details.exit_label : "";
    const date = new Date(e.created_at * 1000).toLocaleString("fr-FR", {timeZone:"Africa/Ouagadougou",dateStyle:"medium",timeStyle:"short"});
    const lines = [
      "🧪 <b>LUCIDE SNIPER V2 — SUIVI</b>",
      `<b>${eventTitle}</b>`,
      "━━━━━━━━━━━━━━━━━━",
      `• Signal : <code>${esc(e.signal_id)}</code>`,
      `• Actif : <b>${esc(e.symbol)}</b>`,
      `• Direction : <b>${e.direction === "BUY" ? "🟢 BUY" : "🔴 SELL"}</b>`,
      `• Score initial : <b>${e.score}/100</b>`,
      `• Stratégie : <b>${esc(e.strategy ?? "ICT / SMC")}</b>`,
      `• Niveau atteint : <b>${esc(String(details.level ?? "—"))}</b>`,
      `• Résultat / progression : <b>${eventR}</b>`,
      ...(exitLabel ? [`• Sortie : <b>${esc(exitLabel)}</b>`] : []),
      `• Statut : <b>VIRTUEL — SHADOW</b>`,
      `• Heure : ${esc(date)} UTC`,
      "━━━━━━━━━━━━━━━━━━",
      "<i>Suivi simulé par Lucide Sniper V2. Aucune position réelle n'est ouverte.</i>"
    ];
    const sent = await tgSend(env, lines.join("\n"));
    if (sent.ok) {
      await env.DB.prepare("UPDATE shadow_telegram_events SET status='sent',sent_at=? WHERE id=? AND sent_at IS NULL")
        .bind(Math.floor(Date.now()/1000), e.id).run();
    } else {
      console.error("telegram V2 outcome", e.id, sent.errors.join(" | "));
    }
  }
}

async function trackShadowOutcomes(env: Env, now: number): Promise<void> {
  const rows=(await env.DB.prepare("SELECT id,symbol,direction,entry,stop_loss,tp1,tp2,tp3,tp_reached,created_at,progress_at FROM shadow_signals WHERE outcome='open' AND entry IS NOT NULL AND stop_loss IS NOT NULL AND tp1 IS NOT NULL").all<Sig>()).results;
  const grouped=new Map<string,Sig[]>();
  for(const row of rows) grouped.set(row.symbol,[...(grouped.get(row.symbol)??[]),row]);
  for(const [symbol,sigs] of grouped) {
    const cfg=SYMBOLS.find(x=>x.symbol===symbol); if(!cfg) continue;
    try {
      const history=await getOutcomeCandles(env,cfg,Math.min(...sigs.map(x=>x.created_at))*1000-HOUR,now);
      for(const sig of sigs) {
        const result=evaluateOutcome(sig,history.candles,now,history.candleMs);
        if(result.outcome!=="open" || result.tp!==sig.tp_reached) {
          const risk=Math.abs(sig.entry-sig.stop_loss);
          const targets=[sig.tp1,sig.tp2,sig.tp3];
          // Enregistrer chaque palier nouvellement franchi, même si plusieurs sont atteints entre deux scans.
          for(let level=sig.tp_reached+1; level<=result.tp && level<=3; level++) {
            const target=targets[level-1];
            const r=target==null || !risk ? null : (sig.direction==="BUY" ? target-sig.entry : sig.entry-target)/risk;
            await queueShadowTelegramEvent(env,sig.id,sig.symbol,`tp${level}`,{level:`TP${level}`,r_multiple:r},now);
          }
          const target=result.tp>=3 ? sig.tp3 : result.tp===2 ? sig.tp2 : result.tp===1 ? sig.tp1 : null;
          const signedReward=target==null || !risk ? null : (sig.direction==="BUY" ? target-sig.entry : sig.entry-target)/risk;
          const r=result.outcome==="sl" ? (result.tp===0 ? -1 : 0) : result.outcome==="tp1" || result.outcome==="tp2" || result.outcome==="tp3" ? signedReward : null;
          await env.DB.prepare("UPDATE shadow_signals SET tp_reached=?,outcome=?,progress_at=?,closed_at=CASE WHEN ?='open' THEN NULL ELSE ? END,r_multiple=CASE WHEN ?='open' THEN NULL ELSE ? END WHERE id=?")
            .bind(result.tp,result.outcome,result.progressAt??sig.progress_at??null,result.outcome,Math.floor(now/1000),result.outcome,r,sig.id).run();
          if(result.outcome==="sl") {
            await queueShadowTelegramEvent(env,sig.id,sig.symbol,"sl",{level:"SL initial",r_multiple:-1,exit_label:"Stop Loss initial"},now);
          } else if(result.outcome==="tp3") {
            await queueShadowTelegramEvent(env,sig.id,sig.symbol,"tp3",{level:"TP3",r_multiple:signedReward,exit_label:"Objectif final atteint"},now);
          } else if(result.exitReason==="expired") {
            await queueShadowTelegramEvent(env,sig.id,sig.symbol,"expired",{level:`TP${result.tp} maximum`,r_multiple:r,exit_label:"Durée maximale du setup dépassée"},now);
          } else if(result.exitReason==="trailing_sl" && result.tp>0) {
            // Le moteur applique un stop suiveur à l'entrée après TP1, puis à TP1 après TP2.
            await queueShadowTelegramEvent(env,sig.id,sig.symbol,"trailing_sl",{level:`Protection après TP${result.tp}`,r_multiple:signedReward,exit_label:"Stop suiveur déclenché"},now);
          }
        }
      }
    } catch(e) { console.error("V2 shadow outcome",symbol,(e as Error).message); }
  }
}

export async function shadowReport(env: Env) {
  const totals=await env.DB.prepare("SELECT COUNT(*) total,SUM(CASE WHEN outcome='open' THEN 1 ELSE 0 END) open,SUM(CASE WHEN outcome IN ('tp1','tp2','tp3') THEN 1 ELSE 0 END) wins,SUM(CASE WHEN outcome='sl' THEN 1 ELSE 0 END) losses,ROUND(AVG(r_multiple),3) avg_r FROM shadow_signals").first();
  const bySymbol=await env.DB.prepare("SELECT symbol,COUNT(*) total,SUM(CASE WHEN outcome='open' THEN 1 ELSE 0 END) open,SUM(CASE WHEN outcome IN ('tp1','tp2','tp3') THEN 1 ELSE 0 END) wins,SUM(CASE WHEN outcome='sl' THEN 1 ELSE 0 END) losses,ROUND(AVG(r_multiple),3) avg_r FROM shadow_signals GROUP BY symbol ORDER BY symbol").all();
  const recent=await env.DB.prepare("SELECT id,symbol,direction,entry,stop_loss,tp1,tp2,tp3,score,strategy,outcome,tp_reached,r_multiple,created_at,closed_at FROM shadow_signals ORDER BY created_at DESC LIMIT 50").all();
  const runs=await env.DB.prepare("SELECT status,COUNT(*) total FROM shadow_runs GROUP BY status ORDER BY status").all();
  return {version:2,mode:"shadow_only",algorithm:"liquidity_intelligence_ict_smc",live_engine:"origin",live_signals_modified:false,notifications_enabled:env.TELEGRAM_V2_ENABLED !== "false" && tgConfigured(env),telegram_min_score:Number(env.TELEGRAM_V2_MIN_SCORE)||82,totals,bySymbol:bySymbol.results,recent:recent.results,runs:runs.results};
}
