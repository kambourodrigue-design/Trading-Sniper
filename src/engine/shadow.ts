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
      const open = await env.DB.prepare("SELECT COUNT(*) n FROM shadow_signals WHERE symbol=? AND outcome='open'").bind(s.symbol).first<{n:number}>();
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
      const finalPassed = setup.passed && finalScore >= 82 && !(fundamental?.veto ?? false);
      if (fundamental) setup.reasons.push(fundamental.summary);
      if (!finalPassed) {
        const note = (fundamental?.veto ? "Contradiction fondamentale forte ; " : "") +
          (setup.passed ? `Score final ${finalScore}/100 inférieur au seuil V2 82/100.` : setup.rejection || "Aucun setup V2 validé.");
        results.push({symbol:s.symbol,status:"rejected",score:finalScore,note});
        await env.DB.prepare("INSERT OR IGNORE INTO shadow_runs(symbol,bucket_hour,status,score,created_at) VALUES(?,?, 'rejected',?,?)").bind(s.symbol,bucket,finalScore,Math.floor(now/1000)).run();
        continue;
      }
      const id = newId();
      await env.DB.prepare(`INSERT OR IGNORE INTO shadow_signals
        (id,symbol,direction,entry,stop_loss,tp1,tp2,tp3,score,strategy,reasoning,outcome,tp_reached,r_multiple,created_at,bucket_hour,telegram_sent_at)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'open',0,NULL,?,?,NULL)`)
        .bind(id,s.symbol,setup.dir,setup.entry,setup.sl,setup.tps[0],setup.tps[1],setup.tps[2],finalScore,setup.strategy,setup.reasons.join(" · ").slice(0,1200),Math.floor(now/1000),bucket).run();
      await env.DB.prepare("INSERT OR IGNORE INTO shadow_runs(symbol,bucket_hour,status,score,created_at) VALUES(?,?, 'candidate',?,?)").bind(s.symbol,bucket,finalScore,Math.floor(now/1000)).run();
      results.push({symbol:s.symbol,status:"shadow_candidate",score:finalScore,note:"Setup V2 validé après filtres techniques et fondamentaux ; signal virtuel uniquement."});
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
  return results;
}

async function flushShadowTelegramNotifications(env: Env, now: number): Promise<void> {
  if (env.TELEGRAM_V2_ENABLED === "false" || !tgConfigured(env)) return;
  const configured = Number(env.TELEGRAM_V2_MIN_SCORE);
  const minScore = Number.isFinite(configured) && configured >= 0 ? Math.min(100, configured) : 75;
  const pending = await env.DB.prepare(
    "SELECT id,symbol,direction,entry,stop_loss,tp1,tp2,tp3,score,strategy,reasoning,created_at FROM shadow_signals WHERE telegram_sent_at IS NULL AND score>=? AND created_at>=? ORDER BY created_at ASC LIMIT 10"
  ).bind(minScore, Math.floor(now / 1000) - 86400).all<{
    id:string;symbol:string;direction:string;entry:number;stop_loss:number;tp1:number;tp2:number|null;tp3:number|null;
    score:number;strategy:string|null;reasoning:string|null;created_at:number;
  }>();
  for (const s of pending.results) {
    const esc = (v: string) => v.replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");
    const price = (v:number|null) => v == null ? "—" : String(v);
    const text = [
      "🧪 <b>SETUP V2 — SHADOW (VIRTUEL)</b>",
      `📊 <b>${esc(s.symbol)}</b> · ${s.direction === "BUY" ? "🟢 BUY" : "🔴 SELL"}`,
      `⭐ Score : <b>${s.score}/100</b>`,
      `🧭 Stratégie : <b>${esc(s.strategy ?? "ICT/SMC")}</b>`,
      `🎯 Entrée : <b>${price(s.entry)}</b>`,
      `🛡️ Stop Loss : <b>${price(s.stop_loss)}</b>`,
      `🏁 TP1 : <b>${price(s.tp1)}</b> · TP2 : <b>${price(s.tp2)}</b> · TP3 : <b>${price(s.tp3)}</b>`,
      s.reasoning ? `📋 <i>${esc(s.reasoning.slice(0,650))}</i>` : "",
      `🕒 ${new Date(s.created_at*1000).toISOString()}`,
      "",
      "⚠️ Signal virtuel : aucune position réelle n'est ouverte. Vérifie le setup avant toute décision."
    ].filter(Boolean).join("\\n");
    const sent = await tgSend(env, text);
    if (sent.ok) {
      await env.DB.prepare("UPDATE shadow_signals SET telegram_sent_at=? WHERE id=? AND telegram_sent_at IS NULL")
        .bind(Math.floor(now/1000), s.id).run();
    } else {
      console.error("telegram V2 setup", s.id, sent.errors.join(" | "));
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
          const target=result.outcome==="sl" ? (result.tp===2 ? sig.tp1 : null) : result.tp>=3 ? sig.tp3 : result.tp===2 ? sig.tp2 : result.tp===1 ? sig.tp1 : null;
          const signedReward=target==null || !risk ? null : (sig.direction==="BUY" ? target-sig.entry : sig.entry-target)/risk;
          const r=result.outcome==="sl" ? (result.tp===0 ? -1 : result.tp===1 ? 0 : signedReward) : result.outcome==="tp1" || result.outcome==="tp2" || result.outcome==="tp3" ? signedReward : null;
          await env.DB.prepare("UPDATE shadow_signals SET tp_reached=?,outcome=?,progress_at=?,closed_at=CASE WHEN ?='open' THEN NULL ELSE ? END,r_multiple=CASE WHEN ?='open' THEN NULL ELSE ? END WHERE id=?")
            .bind(result.tp,result.outcome,result.progressAt??sig.progress_at??null,result.outcome,Math.floor(now/1000),result.outcome,r,sig.id).run();
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
  return {version:2,mode:"shadow_only",algorithm:"liquidity_intelligence_ict_smc",live_engine:"origin",live_signals_modified:false,notifications_enabled:env.TELEGRAM_V2_ENABLED !== "false" && tgConfigured(env),telegram_min_score:Number(env.TELEGRAM_V2_MIN_SCORE)||75,totals,bySymbol:bySymbol.results,recent:recent.results,runs:runs.results};
}
