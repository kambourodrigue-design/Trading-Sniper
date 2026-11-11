import { SYMBOLS, CFG, SymbolCfg, PROFILES, Profile } from "./config";
import { Candle, Dir, Evaluation } from "./types";
import { Analysis, buildAnalysis, evaluate, roundP } from "./analyze";
import { getBundle, getM15 } from "../lib/prices";
import { isMarketOpen } from "./sessions";
import { evaluateOutcome, Sig } from "./outcome";
import { getCalendar, getMacroContext, newsBlock, upcomingEvents, CalEvent } from "../lib/macro";
import { askAIs, askIndependent, configuredAIs, consensus, independentConsensus, mergeLevels } from "../lib/ai";
import { validateLevels } from "./independent";
import { cacheGet, cacheSet, cachePurge } from "../lib/cache";
import { newId } from "../lib/auth";
import { notify, signalMessage, outcomeMessage } from "../lib/telegram";

export interface RunResult { symbol: string; status: string; score: number; note: string }

const HOUR = 3_600_000;
const isUnique = (e: unknown) => /UNIQUE constraint/i.test(String((e as Error)?.message ?? e));

export { isMarketOpen, evaluateOutcome };

export function getProfile(env: Env): Profile {
  const p = PROFILES[(env.PROFILE ?? "active").toLowerCase()] ?? PROFILES.active;
  const ms = Number(env.MIN_SCORE);
  return Number.isFinite(ms) && ms > 0 ? { ...p, minScore: ms } : p; // MIN_SCORE (facultatif) remplace le seuil du profil
}

// Un trade reste « ouvert » (et bloque l'actif) tant qu'il n'a pas atteint son résultat : SL, TP3, stop suiveur ou expiration.
async function trackOutcomes(env: Env, now: number): Promise<boolean> {
  const rows = (await env.DB.prepare(
    "SELECT id, symbol, direction, entry, stop_loss, tp1, tp2, tp3, tp_reached, created_at FROM signals WHERE outcome = 'open' AND entry IS NOT NULL AND stop_loss IS NOT NULL AND tp1 IS NOT NULL"
  ).all<Sig>()).results;
  const bySymbol = new Map<string, Sig[]>();
  for (const r of rows) bySymbol.set(r.symbol, [...(bySymbol.get(r.symbol) ?? []), r]);
  let changed = false;
  for (const [symbol, sigs] of bySymbol) {
    const cfg = SYMBOLS.find((x) => x.symbol === symbol);
    if (!cfg) continue;
    const oldest = Math.min(...sigs.map((x) => x.created_at)) * 1000;
    let c15: Candle[];
    try { c15 = await getM15(env, cfg, oldest - HOUR, now); } catch (e) { console.error("suivi", symbol, (e as Error).message); continue; }
    for (const s of sigs) {
      const r = evaluateOutcome(s, c15, now);
      if (r.outcome !== "open" || r.tp !== s.tp_reached) {
        await env.DB.prepare("UPDATE signals SET tp_reached = ?, outcome = ?, closed_at = CASE WHEN ? = 'open' THEN NULL ELSE ? END WHERE id = ?")
          .bind(r.tp, r.outcome, r.outcome, Math.floor(now / 1000), s.id).run();
        changed = true;
        const msg = outcomeMessage(s, s.tp_reached, r);
        if (msg) await notify(env, msg);
      }
    }
  }
  return changed;
}

// ---------- Prompts soumis aux IA ----------
const ts = (s: Analysis["h1"]) => `clôture ${s.close.toFixed(2)}, MM50 ${s.sma50.toFixed(2)}, MM200 ${s.sma200.toFixed(2)}, tendance ${s.trend}, RSI ${s.rsi.toFixed(0)}`;

function buildPrompt(s: SymbolCfg, an: Analysis, ev: Evaluation, macro: string, cal: CalEvent[], now: number, losses: string): string {
  const candles = an.lastCandles.map((c) => `${new Date(c.t).toISOString().slice(5, 13)}h O${c.o} H${c.h} L${c.l} C${c.c}`).join("\n");
  return `ACTIF : ${s.symbol} (${s.label}) — prix ${an.price} — ATR H1 ${an.atr.toFixed(2)}
SETUP CANDIDAT : ${ev.dir} | entrée ${ev.entry} | SL ${ev.sl} | TP1 ${ev.tps[0]} / TP2 ${ev.tps[1]} / TP3 ${ev.tps[2]} | score moteur ${ev.score}/100
CONFLUENCES DÉTECTÉES : ${ev.reasons.join(" ; ")}
TENDANCE : H1 (${ts(an.h1)}) | H4 (${ts(an.h4)}) | D1 (${ts(an.d1)})
STRUCTURE H1 : ${an.structure.trend}${an.structure.event ? `, ${an.structure.event.type} ${an.structure.event.dir} il y a ${an.structure.event.barsAgo} bougies` : ""} | Wyckoff : ${an.wyckoff.phase}${an.wyckoff.event ? ` (${an.wyckoff.event})` : ""} | Position dans le range : ${Math.round(an.pd.pos * 100)} %
FIGURES : ${an.patterns.length ? an.patterns.map((p) => `${p.name} ${p.dir}${p.confirmed ? " confirmé" : " en formation"}`).join(", ") : "aucune"}
BOUGIES H1 RÉCENTES :\n${candles}
NEWS ÉCONOMIQUES (devises ${s.currencies.join("/")}) :\n${upcomingEvents(cal, s.currencies, now)}
CONTEXTE MACRO & GÉOPOLITIQUE :\n${macro}
${losses}Confirme ou rejette ce setup ${ev.dir}. Réponds uniquement en JSON.`;
}

const fmtC = (c: Candle[], n: number, price: number, daily = false) =>
  c.slice(-n).map((k) => `${new Date(k.t).toISOString().slice(5, daily ? 10 : 13).replace("T", " ")}${daily ? "" : "h"} O${roundP(k.o, price)} H${roundP(k.h, price)} L${roundP(k.l, price)} C${roundP(k.c, price)}`).join("\n");

function buildIndependentPrompt(s: SymbolCfg, an: Analysis, best: Evaluation, h1: Candle[], h4: Candle[], d1: Candle[], macro: string, cal: CalEvent[], now: number, losses: string): string {
  return `ACTIF : ${s.symbol} (${s.label}) — date ${new Date(now).toISOString().slice(0, 16)} UTC — PRIX ACTUEL ${an.price} — ATR H1 ${an.atr.toFixed(2)}
INDICATEURS : H1 (${ts(an.h1)}) | H4 (${ts(an.h4)}) | D1 (${ts(an.d1)})
BOUGIES D1 (20 dernières) :\n${fmtC(d1, 20, an.price, true)}
BOUGIES H4 (30 dernières) :\n${fmtC(h4, 30, an.price)}
BOUGIES H1 (60 dernières) :\n${fmtC(h1, 60, an.price)}
DÉTECTIONS AUTOMATIQUES (à titre indicatif, tu peux les contredire) : structure H1 ${an.structure.trend}${an.structure.event ? `, ${an.structure.event.type} ${an.structure.event.dir} il y a ${an.structure.event.barsAgo} bougies` : ""} ; Wyckoff ${an.wyckoff.phase}${an.wyckoff.event ? ` (${an.wyckoff.event})` : ""} ; position dans le range ${Math.round(an.pd.pos * 100)} % ; figures : ${an.patterns.length ? an.patterns.map((p) => `${p.name} ${p.dir}${p.confirmed ? " confirmé" : " en formation"}`).join(", ") : "aucune"} ; meilleur score de confluence du moteur : ${best.score}/100 (${best.dir}).
NEWS ÉCONOMIQUES (devises ${s.currencies.join("/")}) :\n${upcomingEvents(cal, s.currencies, now)}
CONTEXTE MACRO & GÉOPOLITIQUE :\n${macro}
${losses}Fais ta propre analyse et propose un trade seulement s'il est de haute probabilité. Réponds uniquement en JSON.`;
}

async function recentLosses(env: Env, symbol: string): Promise<string> {
  const rows = (await env.DB.prepare("SELECT direction, entry, reasoning FROM signals WHERE symbol = ? AND outcome = 'sl' ORDER BY created_at DESC LIMIT 3").bind(symbol).all<{ direction: string; entry: number; reasoning: string | null }>()).results;
  return rows.length ? `ERREURS RÉCENTES À ÉVITER (setups stoppés) :\n${rows.map((r) => `- ${r.direction} à ${r.entry} : ${(r.reasoning ?? "").split("\n")[0].slice(0, 160)}`).join("\n")}\n\n` : "";
}

const SOLO = " (validé par une seule IA disponible : seuil de confiance relevé)";

// ---------- Analyse indépendante des IA ----------
async function independentAnalysis(env: Env, s: SymbolCfg, an: Analysis, best: Evaluation, h1: Candle[], h4: Candle[], d1: Candle[], cal: CalEvent[], now: number): Promise<{ published: boolean; note: string; log: Record<string, unknown> }> {
  const macro = await getMacroContext(env);
  const { verdicts, errors } = await askIndependent(env, buildIndependentPrompt(s, an, best, h1, h4, d1, macro, cal, now, await recentLosses(env, s.symbol)));
  const cons = independentConsensus(verdicts);
  const log: Record<string, unknown> = { verdicts, errors, consensus: cons.reason };
  if (!cons.ok || !cons.dir) return { published: false, note: cons.reason, log };
  const v = validateLevels(cons.dir, an.price, an.atr, mergeLevels(cons.agree));
  if (!v.ok) { log.guard = v.reason; return { published: false, note: `niveaux refusés (${v.reason})`, log }; }
  const conf = Math.min(95, Math.round(cons.agree.reduce((a, x) => a + x.confidence, 0) / cons.agree.length));
  const top = [...cons.agree].sort((a, b) => b.confidence - a.confidence)[0];
  const strategies = [...new Set(cons.agree.flatMap((x) => x.strategies))].slice(0, 4);
  try {
    await env.DB.prepare(
      `INSERT INTO signals (id, symbol, direction, entry, stop_loss, tp1, tp2, tp3, confidence, strategy, rr_ratio, source, user_id, status, timeframe, score, reasoning, ai_votes, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ai', NULL, 'published', 'H1', ?, ?, ?, ?)`
    ).bind(newId(), s.symbol, cons.dir, roundP(an.price, an.price), v.sl, v.tps[0], v.tps[1], v.tps[2], conf, strategies.join(" + ") || "Analyse IA indépendante", v.rr,
      best.score, `Analyse IA indépendante : ${top.reasoning}${verdicts.length === 1 ? SOLO : ""}`,
      JSON.stringify(cons.agree.map((x) => ({ provider: x.provider.split(":")[0], decision: x.decision, confidence: x.confidence }))), Math.floor(now / 1000)).run();
  } catch (e) {
    if (isUnique(e)) return { published: false, note: "un trade est déjà ouvert sur cet actif", log };
    throw e;
  }
  await notify(env, signalMessage({ symbol: s.symbol, direction: cons.dir, entry: roundP(an.price, an.price), stop_loss: v.sl, tp1: v.tps[0], tp2: v.tps[1], tp3: v.tps[2], confidence: conf, rr_ratio: v.rr, strategy: strategies.join(" + ") || "Analyse IA indépendante", reasoning: top.reasoning, source: "ai" }));
  return { published: true, note: cons.reason, log };
}

// ---------- Analyse d'un actif ----------
async function analyzeOne(env: Env, s: SymbolCfg, now: number, cal: { ok: boolean; events: CalEvent[] }): Promise<RunResult | null> {
  const maxAge = s.session === "us" ? 9_000_000 : 4_500_000; // la dernière bougie H1 clôturée doit être récente
  const bundle = await getBundle(env, s, now, maxAge);
  const { h1, h4, d1 } = bundle;
  if (h1.length === 0 || now - h1[h1.length - 1].t > maxAge) {
    const k = `try:${s.symbol}:${Math.floor(now / HOUR)}`;
    const n = Number(await cacheGet(env, k) ?? 0) + 1;
    await cacheSet(env, k, String(n), 7200);
    if (n < 3) return null; // données pas encore publiées : on réessaie au prochain passage (sans marquer l'heure comme analysée)
    const note = "données non à jour après 3 essais (jour férié ? flux en retard ?) : actif ignoré jusqu'à l'heure suivante";
    await env.DB.prepare("INSERT INTO analysis_log (symbol, ts, status, dir, score, gates, ai, note) VALUES (?, ?, 'stale', NULL, 0, '[]', NULL, ?)").bind(s.symbol, Math.floor(now / 1000), note).run();
    await env.DB.prepare("INSERT INTO analysis_state (symbol, last_hour) VALUES (?, ?) ON CONFLICT(symbol) DO UPDATE SET last_hour = excluded.last_hour").bind(s.symbol, Math.floor(now / HOUR)).run();
    return { symbol: s.symbol, status: "stale", score: 0, note };
  }
  const an = buildAnalysis(s.symbol, h1, h4, d1);
  // Règle : 1 seul trade par actif, suivi jusqu'à son résultat (SL / TP / stop suiveur / expiration) avant tout nouveau signal.
  const open = await env.DB.prepare("SELECT COUNT(*) n FROM signals WHERE symbol = ? AND outcome = 'open' AND user_id IS NULL").bind(s.symbol).first<{ n: number }>();
  const ctx = {
    newsBlock: newsBlock(cal.events, s.currencies, now, CFG.newsBeforeMin, CFG.newsAfterMin),
    marketOpen: isMarketOpen(s, now), hasOpen: (open?.n ?? 0) > 0, p: getProfile(env),
  };
  const evals = (["BUY", "SELL"] as Dir[]).map((d) => evaluate(an, d, ctx)).sort((a, b) => Number(b.passed) - Number(a.passed) || b.score - a.score);
  const best = evals[0];
  let status = "rejected", note = best.gates.filter((g) => !g.ok).map((g) => g.name).join(", ") || "—";
  let aiLog: Record<string, unknown> | null = null;

  // Chemin 1 : setup détecté par les règles, validé par les IA
  if (best.passed) {
    if (configuredAIs(env).length === 0) { status = "no_ai"; note = "règles validées mais aucune clé IA configurée"; }
    else {
      const macro = await getMacroContext(env);
      const { verdicts, errors } = await askAIs(env, buildPrompt(s, an, best, macro, cal.events, now, await recentLosses(env, s.symbol)));
      const cons = consensus(verdicts, best.dir);
      aiLog = { verdicts, errors, consensus: cons.reason };
      if (cons.ok) {
        const avg = cons.agree.reduce((a, v) => a + v.confidence, 0) / cons.agree.length;
        const conf = Math.min(99, Math.round(0.5 * best.score + 0.5 * avg));
        const top = [...cons.agree].sort((a, b) => b.confidence - a.confidence)[0];
        try {
          await env.DB.prepare(
            `INSERT INTO signals (id, symbol, direction, entry, stop_loss, tp1, tp2, tp3, confidence, strategy, rr_ratio, source, user_id, status, timeframe, score, reasoning, ai_votes, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'auto', NULL, 'published', 'H1', ?, ?, ?, ?)`
          ).bind(newId(), s.symbol, best.dir, best.entry, best.sl, best.tps[0], best.tps[1], best.tps[2], conf, best.tags.join(" + "), best.rr,
            best.score, `${best.reasons.join(" · ")}\nIA : ${top.reasoning}${verdicts.length === 1 ? SOLO : ""}`,
            JSON.stringify(cons.agree.map((v) => ({ provider: v.provider.split(":")[0], decision: v.decision, confidence: v.confidence }))), Math.floor(now / 1000)).run();
          status = "published"; note = cons.reason;
          await notify(env, signalMessage({ symbol: s.symbol, direction: best.dir, entry: best.entry, stop_loss: best.sl, tp1: best.tps[0], tp2: best.tps[1], tp3: best.tps[2], confidence: conf, rr_ratio: best.rr, strategy: best.tags.join(" + "), reasoning: `${best.reasons.join(" · ")}\nIA : ${top.reasoning}`, source: "auto" }));
        } catch (e) {
          if (!isUnique(e)) throw e;
          status = "rejected"; note = "un trade est déjà ouvert sur cet actif";
        }
      } else { status = "ai_rejected"; note = cons.reason; }
    }
  }

  // Chemin 2 : analyse indépendante des IA (AI_INDEPENDENT : off | prefilter (défaut) | always).
  // Non lancée si les IA viennent de rejeter le setup des règles (mêmes données → évite de payer deux fois).
  // off : jamais ; prefilter : si score moteur >= AI_PREFILTER_SCORE ; h4 (défaut) : prefilter + à chaque clôture H4 (0h, 4h, 8h… UTC) ; always : chaque heure.
  const mode = (env.AI_INDEPENDENT || "h4").toLowerCase();
  const pre = Number(env.AI_PREFILTER_SCORE) || 30;
  const h4Close = Math.floor(now / HOUR) % 4 === 0;
  if (mode !== "off" && configuredAIs(env).length > 0 && ctx.marketOpen && !ctx.hasOpen && ctx.newsBlock === null
      && status !== "published" && status !== "ai_rejected" && (mode === "always" || best.score >= pre || (mode === "h4" && h4Close))) {
    const ind = await independentAnalysis(env, s, an, best, h1, h4, d1, cal.events, now);
    aiLog = { ...(aiLog ?? {}), independent: ind.log };
    if (ind.published) { status = "ai_signal"; note = ind.note; } else note = `${note} | IA indépendante : ${ind.note}`;
  }

  await env.DB.prepare("INSERT INTO analysis_log (symbol, ts, status, dir, score, gates, ai, note) VALUES (?, ?, ?, ?, ?, ?, ?, ?)")
    .bind(s.symbol, Math.floor(now / 1000), status, best.dir, best.score, JSON.stringify(best.gates), aiLog ? JSON.stringify(aiLog) : null, `${note} · données : ${bundle.source}`.slice(0, 400)).run();
  await env.DB.prepare("INSERT INTO analysis_state (symbol, last_hour) VALUES (?, ?) ON CONFLICT(symbol) DO UPDATE SET last_hour = excluded.last_hour")
    .bind(s.symbol, Math.floor(now / HOUR)).run();
  return { symbol: s.symbol, status, score: best.score, note };
}

// ---------- Point d'entrée (cron toutes les 5 min + admin) ----------
export async function runEngine(env: Env, opts: { force?: boolean; symbol?: string } = {}): Promise<RunResult[]> {
  const now = Date.now(), hour = Math.floor(now / HOUR), minute = new Date(now).getUTCMinutes();
  const results: RunResult[] = [];
  let changed = false;
  await cachePurge(env);
  if (minute < 5) await env.DB.prepare("DELETE FROM analysis_log WHERE ts < ?").bind(Math.floor(now / 1000) - 7 * 86400).run();

  // Suivi des résultats : au plus toutes les 25 min (économise les crédits de données)
  if (opts.force || !(await cacheGet(env, "trk:last"))) {
    await cacheSet(env, "trk:last", "1", 25 * 60);
    changed = await trackOutcomes(env, now).catch((e) => { console.error("suivi des résultats", e); return false; });
  }
  if (await cacheGet(env, "td:pause")) { if (changed) await env.CACHE.delete("signals:latest"); return results; } // crédits du jour épuisés
  const cal = await getCalendar(env);

  const due: Array<{ s: SymbolCfg; last: number }> = [];
  for (const s of SYMBOLS) {
    if (opts.symbol && s.symbol !== opts.symbol) continue;
    if (!opts.force && !isMarketOpen(s, now)) continue;
    if (!opts.force && await cacheGet(env, `dis:${s.symbol}`)) continue; // actif désactivé (formule de données insuffisante)
    const st = await env.DB.prepare("SELECT last_hour FROM analysis_state WHERE symbol = ?").bind(s.symbol).first<{ last_hour: number }>();
    if (opts.force || ((!st || st.last_hour < hour) && minute >= 1)) due.push({ s, last: st?.last_hour ?? 0 });
  }
  due.sort((a, b) => a.last - b.last);
  const max = opts.force ? due.length : Number(env.MAX_PER_RUN) || CFG.maxPerRun;
  for (const { s } of due.slice(0, max)) {
    try {
      const r = await analyzeOne(env, s, now, cal);
      if (r) { results.push(r); if (r.status === "published" || r.status === "ai_signal") changed = true; }
    } catch (e) {
      const msg = String((e as Error).message).slice(0, 300);
      console.error("analyse", s.symbol, msg);
      const planErr = /available starting with|grow plan|pro plan|ultra plan|not available on your plan/i.test(msg);
      // Plan de données insuffisant : 12 h. Panne passagère (429, blocage, réseau) : 30 min, pour ne pas marteler les fournisseurs.
      await cacheSet(env, `dis:${s.symbol}`, msg, planErr ? 12 * 3600 : 1800);
      await env.DB.prepare("INSERT INTO analysis_log (symbol, ts, status, dir, score, gates, ai, note) VALUES (?, ?, 'error', NULL, 0, '[]', NULL, ?)")
        .bind(s.symbol, Math.floor(now / 1000), `actif en pause ${planErr ? "12 h" : "30 min"} — ${msg}`.slice(0, 400)).run();
      if (/run out of api credits|daily limit/i.test(msg)) await cacheSet(env, "td:pause", msg, 3600);
      results.push({ symbol: s.symbol, status: "error", score: 0, note: msg });
    }
  }
  if (changed) await env.CACHE.delete("signals:latest"); // le flux public n'est invalidé que s'il a changé (économise les écritures KV)
  return results;
}
