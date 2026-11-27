import { bearerToken, getUser, isAdminEmail, newId } from "./lib/auth";
import { runAutoSignals } from "./scheduled";
import { tgSend, notify, signalMessage, closedMessage } from "./lib/telegram";
import { SYMBOLS, PROFILES, CFG } from "./engine/config";
import type { Src } from "./engine/config";
import { buildAnalysis, evaluate } from "./engine/analyze";
import { adaptiveProfile } from "./engine/run";
import { isMarketOpen } from "./engine/sessions";
import { evaluateOutcome, Sig } from "./engine/outcome";
import { summarize, summarizeCounts } from "./engine/metrics";
import { biquoteCandles, yahooCandles } from "./lib/prices";
import type { Candle, Dir } from "./engine/types";
import { probeSources } from "./lib/prices";
import { probeIntermarket } from "./lib/intermarket";
import { fundamentalBias, newsBlock, type CalEvent } from "./lib/macro";
import { learningReport } from "./engine/learning";
import { learningV2Report } from "./engine/learning-v2";
import { shadowReport } from "./engine/shadow";

const PLANS = ["starter", "pro", "elite"];

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json", "access-control-allow-origin": "*" },
  });
}
const err = (message: string, status = 400) => json({ error: message }, status);
const num = (v: unknown): number | null => (v === null || v === undefined || v === "" || isNaN(Number(v)) ? null : Number(v));

export async function handleAdmin(req: Request, env: Env, ctx: ExecutionContext, pathname: string): Promise<Response | null> {
  if (!pathname.startsWith("/api/admin/")) return null;

  const user = await getUser(env.DB, bearerToken(req));
  if (!user) return err("Non authentifié.", 401);
  if (!isAdminEmail(env, user.email)) return err("Accès réservé à l'administrateur.", 403);

  const now = Math.floor(Date.now() / 1000);
  const m = req.method;
  const activeSub = `status = 'active' AND (current_period_end IS NULL OR current_period_end > ${now})`;

  // --- Stats ---
  if (pathname === "/api/admin/stats" && m === "GET") {
    const users = await env.DB.prepare("SELECT COUNT(*) n FROM users").first<{ n: number }>();
    const byPlan = await env.DB.prepare(
      `SELECT plan, COUNT(DISTINCT user_id) n FROM subscriptions WHERE ${activeSub} GROUP BY plan`
    ).all<{ plan: string; n: number }>();
    const s24 = await env.DB.prepare("SELECT COUNT(*) n FROM signals WHERE created_at > ?").bind(now - 86400).first<{ n: number }>();
    const openSig = await env.DB.prepare("SELECT COUNT(*) n FROM signals WHERE outcome = 'open' AND user_id IS NULL").first<{ n: number }>();
    const outc = await env.DB.prepare("SELECT source, outcome, COUNT(*) n FROM signals WHERE source IN ('auto', 'ai') AND status = 'published' AND created_at > ? GROUP BY source, outcome").bind(now - 90 * 86400).all<{ source: string; outcome: string; n: number }>();
    // Même définition que /api/stats : summarizeCounts (win_rate = TP1+ atteint).
    const tally = (src: string | null) => {
      const c: Record<string, number> = {};
      for (const r of outc.results) if (src === null || r.source === src) c[r.outcome] = (c[r.outcome] ?? 0) + r.n;
      return summarizeCounts(c);
    };
    const all = tally(null), viaRules = tally("auto"), viaAi = tally("ai");
    const by_plan: Record<string, number> = {};
    let active = 0;
    for (const r of byPlan.results) { by_plan[r.plan] = r.n; active += r.n; }
    return json({ users: users?.n ?? 0, active_subscribers: active, by_plan, signals_24h: s24?.n ?? 0, open_signals: openSig?.n ?? 0, win_rate: all.win_rate, wins: all.tp_hits, losses: all.losses, trades: all.trades, rules_rate: viaRules.win_rate, ai_rate: viaAi.win_rate });
  }

  // --- Utilisateurs ---
  if (pathname === "/api/admin/users" && m === "GET") {
    const q = new URL(req.url).searchParams.get("q") ?? "";
    const rows = await env.DB.prepare(
      `SELECT u.id, u.email, u.created_at,
        (SELECT plan FROM subscriptions s WHERE s.user_id = u.id AND s.${activeSub} ORDER BY s.created_at DESC LIMIT 1) AS plan,
        (SELECT current_period_end FROM subscriptions s WHERE s.user_id = u.id AND s.${activeSub} ORDER BY s.created_at DESC LIMIT 1) AS plan_end
       FROM users u WHERE u.email LIKE ? ORDER BY u.created_at DESC LIMIT 100`
    ).bind(`%${q}%`).all();
    return json(rows.results);
  }

  // --- Abonnements manuels ---
  if (pathname === "/api/admin/subscriptions" && m === "POST") {
    const { email, plan, days } = await req.json<{ email?: string; plan?: string; days?: number }>();
    const d = Number(days ?? 30);
    if (!email || !plan || !PLANS.includes(plan)) return err("Email et plan (starter | pro | elite) requis.");
    if (!(d >= 1 && d <= 3650)) return err("Durée invalide (1 à 3650 jours).");
    const target = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>();
    if (!target) return err("Aucun utilisateur avec cet email.", 404);
    await env.DB.prepare("UPDATE subscriptions SET status = 'canceled' WHERE user_id = ? AND status = 'active'").bind(target.id).run();
    await env.DB.prepare(
      "INSERT INTO subscriptions (id, user_id, plan, status, provider, provider_ref, current_period_end, created_at) VALUES (?, ?, ?, 'active', 'manual', NULL, ?, ?)"
    ).bind(newId(), target.id, plan, now + d * 86400, now).run();
    return json({ ok: true });
  }

  if (pathname === "/api/admin/subscriptions/revoke" && m === "POST") {
    const { email } = await req.json<{ email?: string }>();
    const target = email ? await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first<{ id: string }>() : null;
    if (!target) return err("Aucun utilisateur avec cet email.", 404);
    await env.DB.prepare("UPDATE subscriptions SET status = 'canceled' WHERE user_id = ? AND status = 'active'").bind(target.id).run();
    return json({ ok: true });
  }

  // --- Signaux ---
  if (pathname === "/api/admin/signals" && m === "GET") {
    const rows = await env.DB.prepare("SELECT * FROM signals ORDER BY created_at DESC LIMIT 100").all();
    return json(rows.results);
  }

  if (pathname === "/api/admin/signals" && m === "POST") {
    const b = await req.json<Record<string, unknown>>();
    const symbol = String(b.symbol ?? "").trim().toUpperCase();
    const direction = String(b.direction ?? "").toUpperCase();
    if (!symbol || !["BUY", "SELL"].includes(direction)) return err("Symbole et direction (BUY | SELL) requis.");
    const id = newId();
    try {
      await env.DB.prepare(
        `INSERT INTO signals (id, symbol, direction, entry, stop_loss, tp1, tp2, tp3, confidence, strategy, rr_ratio, source, user_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', NULL, 'published', ?)`
      ).bind(
        id, symbol, direction, num(b.entry), num(b.stop_loss), num(b.tp1), num(b.tp2), num(b.tp3),
        num(b.confidence), b.strategy ? String(b.strategy) : null, b.rr_ratio ? String(b.rr_ratio) : null, now
      ).run();
    } catch (e) {
      if (/UNIQUE constraint/i.test(String((e as Error).message))) return err(`Un trade est déjà ouvert sur ${symbol} : clôture-le d'abord (règle : 1 seul trade par actif).`, 409);
      throw e;
    }
    await env.CACHE.delete("signals:latest");
    await notify(env, await signalMessage(env, { symbol, direction, entry: num(b.entry), stop_loss: num(b.stop_loss), tp1: num(b.tp1), tp2: num(b.tp2), tp3: num(b.tp3), confidence: num(b.confidence), rr_ratio: b.rr_ratio ? String(b.rr_ratio) : null, strategy: b.strategy ? String(b.strategy) : null, source: "manual" }));
    return json({ ok: true, id }, 201);
  }

  const one = pathname.match(/^\/api\/admin\/signals\/([\w-]+)$/);
  if (one && m === "PATCH") {
    const body = await req.json<{ status?: string; outcome?: string }>();
    if (body.outcome === "closed") {
      // Clôture manuelle : libère l'actif pour un nouveau signal (le trade n'est compté ni gagnant ni perdant).
      const row = await env.DB.prepare("SELECT symbol, direction, outcome FROM signals WHERE id = ?").bind(one[1]).first<{ symbol: string; direction: string; outcome: string }>();
      await env.DB.prepare("UPDATE signals SET outcome = 'closed', closed_at = ? WHERE id = ? AND outcome = 'open'").bind(now, one[1]).run();
      if (row && row.outcome === "open") await notify(env, closedMessage(row.symbol, row.direction));
      await env.CACHE.delete("signals:latest");
      return json({ ok: true });
    }
    const status = body.status;
    if (!status || !["published", "hidden"].includes(status)) return err("status : published | hidden, ou outcome : closed.");
    await env.DB.prepare("UPDATE signals SET status = ? WHERE id = ?").bind(status, one[1]).run();
    await env.CACHE.delete("signals:latest");
    return json({ ok: true });
  }
  if (one && m === "DELETE") {
    await env.DB.prepare("DELETE FROM signals WHERE id = ?").bind(one[1]).run();
    await env.CACHE.delete("signals:latest");
    return json({ ok: true });
  }

  // --- Historique backtest : import CSV découpé et stocké dans D1 (aucun R2 requis) ---
  if (pathname === "/api/admin/backtest/data" && m === "GET") {
    const symbol = String(new URL(req.url).searchParams.get("symbol") ?? "XAU/USD").toUpperCase();
    const rows = await env.DB.prepare("SELECT timeframe, MIN(month) AS first_month, MAX(month) AS last_month, SUM(count) AS bars FROM backtest_candles WHERE symbol = ? GROUP BY timeframe ORDER BY timeframe").bind(symbol).all<{timeframe:string;first_month:string;last_month:string;bars:number}>();
    return json({ symbol, history: rows.results });
  }
  if (pathname === "/api/admin/backtest/data" && m === "POST") {
    const b = await req.json<{symbol?:string;timeframe?:string;bars?:Array<{t:number;o:number;h:number;l:number;c:number}>}>();
    const symbol = String(b.symbol ?? "").toUpperCase(), timeframe = String(b.timeframe ?? "").toUpperCase();
    if (!SYMBOLS.some(x => x.symbol === symbol)) return err("Marché non reconnu.");
    if (!["M15","1H","4H","1D"].includes(timeframe)) return err("Timeframe accepté : M15, 1H, 4H ou 1D.");
    if (!Array.isArray(b.bars) || !b.bars.length || b.bars.length > 5000) return err("Envoie entre 1 et 5 000 bougies par lot.");
    const valid = b.bars.filter(x => Number.isFinite(x.t) && x.t > 0 && [x.o,x.h,x.l,x.c].every(Number.isFinite) && x.h >= Math.max(x.o,x.c,x.l) && x.l <= Math.min(x.o,x.c));
    if (valid.length !== b.bars.length) return err("Certaines bougies OHLC sont invalides.");
    const groups = new Map<string, typeof valid>();
    for (const bar of valid) { const month = new Date(bar.t).toISOString().slice(0,7); const a = groups.get(month) ?? []; a.push(bar); groups.set(month,a); }
    for (const [month, incoming] of groups) {
      const old = await env.DB.prepare("SELECT bars FROM backtest_candles WHERE symbol = ? AND timeframe = ? AND month = ?").bind(symbol,timeframe,month).first<{bars:string}>();
      const map = new Map<number, typeof valid[number]>();
      if (old?.bars) for (const x of JSON.parse(old.bars) as typeof valid) map.set(x.t,x);
      for (const x of incoming) map.set(x.t,x);
      const merged = [...map.values()].sort((a,b)=>a.t-b.t);
      await env.DB.prepare("INSERT INTO backtest_candles(symbol,timeframe,month,bars,count,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(symbol,timeframe,month) DO UPDATE SET bars=excluded.bars,count=excluded.count,updated_at=excluded.updated_at").bind(symbol,timeframe,month,JSON.stringify(merged),merged.length,now).run();
    }
    return json({ok:true,symbol,timeframe,imported:valid.length,months:groups.size});
  }

  // --- Backtest historique admin : un actif par requête pour limiter le temps CPU Worker ---
  if (pathname === "/api/admin/backtest" && m === "POST") {
    type BtRequest = { symbol?: string; profile?: string; days?: number; costAtr?: number; mode?: string; cursor?: number; state?: { seq?: Array<{ t: number; outcome: string; costR: number }>; busyUntil?: number; decisions?: number; setups?: number; firstEval?: number; lastEval?: number; newsBlocked?: number; macroRejected?: number }; events?: Array<{ title?: string; country?: string; t?: number | string; impact?: string; forecast?: string; actual?: string; previous?: string; confidence?: string }> };
    const b = await req.json<BtRequest>().catch(() => ({} as BtRequest));
    const cfg = SYMBOLS.find((x) => x.symbol === String(b.symbol ?? "XAU/USD").toUpperCase());
    const profileName = String(b.profile ?? "adaptive");
    if (!cfg) return err("Actif inconnu.");
    if (!PROFILES[profileName]) return err("Profil invalide.");
    const days = Math.max(3, Math.min(730, Math.floor(Number(b.days ?? 7))));
    const costAtr = Math.max(0, Math.min(0.2, Number(b.costAtr ?? 0.04)));
    const mode = ["technical", "news_filter", "fundamental"].includes(String(b.mode)) ? String(b.mode) : "technical";
    const rawEvents = Array.isArray(b.events) ? b.events.slice(0, 2000) : [];
    const events: CalEvent[] = rawEvents.map((e) => ({
      title: String(e.title ?? "Publication économique").slice(0, 180),
      country: String(e.country ?? "").toUpperCase().slice(0, 3),
      t: typeof e.t === "string" ? Date.parse(e.t) : Number(e.t),
      impact: String(e.impact ?? "High").toLowerCase() === "high" ? "High" : String(e.impact ?? "").toLowerCase() === "medium" ? "Medium" : "Low",
      forecast: e.forecast == null ? undefined : String(e.forecast), actual: e.actual == null ? undefined : String(e.actual),
      previous: e.previous == null ? undefined : String(e.previous), confidence: e.confidence,
    })).filter((e) => !!e.country && Number.isFinite(e.t) && e.t > 0 && ["High", "Medium", "Low"].includes(e.impact));
    if (mode !== "technical" && !events.length) return err("Ajoute un historique d'annonces économiques valide pour activer le filtre fondamental.");
    const H = 3600000, D = 86400000, nowMs = Date.now();
    let h1: Candle[] = [], h4: Candle[] = [], d1: Candle[] = [], source = "";
    // La période doit être ancrée sur la dernière bougie H1 clôturée disponible,
    // pas sur Date.now(). Les imports historiques peuvent s'arrêter avant aujourd'hui.
    let from = nowMs - days * D;
    const fetcher = async (src: Src, iv: "1h" | "4h" | "1d", start: number) => src.p === "biquote" ? biquoteCandles(src, iv, start, nowMs) : yahooCandles(src, iv, start, nowMs);
    // Charger la période demandée + marge D1 pour le warm-up (205 bougies).
    // La marge évite de charger systématiquement 2 ans pour un test de 30 jours.
    const historyDays = Math.min(1000, days + 220);
    const stored = await env.DB.prepare("SELECT timeframe, bars FROM backtest_candles WHERE symbol = ? AND timeframe IN ('1H','4H','1D') AND month >= ? ORDER BY month").bind(cfg.symbol, new Date(nowMs - historyDays * D).toISOString().slice(0,7)).all<{timeframe:string;bars:string}>();
    // Les lots D1 sont déjà triés par mois et les bougies par timestamp à l'import.
    // Les concaténer dans l'ordre évite un tri CPU coûteux sur des milliers de bougies.
    const unpack = (tf:string) => stored.results.filter(x=>x.timeframe===tf).flatMap(x=>JSON.parse(x.bars) as Candle[]);
    const ih1=unpack("1H"), ih4=unpack("4H"), id1=unpack("1D");
    if (ih1.length >= 105 && ih4.length >= 105 && id1.length >= 205) { h1=ih1; h4=ih4; d1=id1; source="D1 importé"; }
    else {
      for (const src of cfg.sources) {
        try {
          const [a, c, d] = await Promise.all([fetcher(src, "1h", nowMs - 180 * H), fetcher(src, "4h", nowMs - 220 * 4 * H), fetcher(src, "1d", nowMs - 500 * D)]);
          if (a.length < 105 || c.length < 105 || d.length < 205) throw new Error(`Historique insuffisant (H1 ${a.length}, H4 ${c.length}, D1 ${d.length})`);
          h1 = a; h4 = c; d1 = d; source = src.p; break;
        } catch { /* essayer la source suivante */ }
      }
    }
    if (!source) return err("Aucune source ne fournit assez de bougies H1/H4/D1 pour ce test. Importe les historiques 1H, 4H et 1D en CSV.", 503);
    if (days > 7 && source !== "D1 importé") return err("Un historique long n'est pas disponible chez le fournisseur live. Importe les CSV H1, H4 et D1 pour ce marché avant de lancer un test long.", 422);
    // Fin effective du backtest : dernière bougie H1 clôturée réellement disponible.
    // Ainsi, une sélection de 30 jours parcourt 30 jours de données historiques,
    // même si l'import s'arrête plusieurs jours avant aujourd'hui.
    const lastClosedH1 = [...h1].reverse().find(x => Number.isFinite(x.t) && x.t + H <= nowMs);
    if (!lastClosedH1) return err("Aucune bougie H1 clôturée n'est disponible pour ce marché.", 422);
    const effectiveEnd = lastClosedH1.t + H;
    from = effectiveEnd - days * D;

    if (source === "D1 importé") {
      const minSpan = (days - 3) * D;
      const spans = { H1: h1.length ? h1[h1.length-1].t-h1[0].t : 0, H4: h4.length ? h4[h4.length-1].t-h4[0].t : 0, D1: d1.length ? d1[d1.length-1].t-d1[0].t : 0 };
      const missing = Object.entries(spans).filter(([,span]) => span < minSpan).map(([tf]) => tf);
      if (missing.length) return err(`Historique importé incomplet sur ${missing.join(", ")} : chaque timeframe doit couvrir environ ${days} jours. Importe les fichiers manquants.`, 422);
    }
    const m15Meta = await env.DB.prepare("SELECT MIN(month) AS first_month, MAX(month) AS last_month, SUM(count) AS bars FROM backtest_candles WHERE symbol = ? AND timeframe = 'M15'").bind(cfg.symbol).first<{first_month:string|null;last_month:string|null;bars:number|null}>();
    if (!m15Meta || !m15Meta.first_month || !m15Meta.last_month || Number(m15Meta.bars ?? 0) < days * 50) return err(`Historique M15 manquant ou insuffisant. Importe les bougies M15 couvrant toute la période demandée (${days} jours), puis relance le backtest.`, 422);
    const targetStartMonth = new Date(Math.max(from, h1[104].t + H) - 3 * D).toISOString().slice(0,7);
    const targetEndMonth = new Date(h1[h1.length-1].t).toISOString().slice(0,7);
    if (m15Meta.first_month > targetStartMonth || m15Meta.last_month < targetEndMonth) return err(`Historique M15 incomplet (${m15Meta.first_month} → ${m15Meta.last_month}). Il doit couvrir la période H1 du backtest (${targetStartMonth} → ${targetEndMonth}), avec marge de chauffe.`, 422);
    const saved = b.state && typeof b.state === "object" ? b.state : {};
    const seq: Array<{ t: number; outcome: string; costR: number }> = Array.isArray(saved.seq) ? saved.seq : [];
    let busyUntil = Number(saved.busyUntil ?? 0), decisions = Number(saved.decisions ?? 0), setups = Number(saved.setups ?? 0), firstEval = Number(saved.firstEval ?? 0), lastEval = Number(saved.lastEval ?? 0), newsBlocked = Number(saved.newsBlocked ?? 0), macroRejected = Number(saved.macroRejected ?? 0);
    const startMs = Math.max(from, h1[104].t + H);
    // Chaque requête ne simule que 12 bougies H1. Le navigateur enchaîne les blocs
    // pour rester sous la limite CPU de 10 ms des Workers Free.
    const requestedCursor = Number(b.cursor ?? 104);
    const cursor = Number.isFinite(requestedCursor) ? Math.max(104, Math.min(h1.length - 1, Math.floor(requestedCursor))) : 104;
    const chunkEnd = Math.min(h1.length - 1, cursor + 12);
    const m15FromMonth = new Date(h1[cursor].t - 3 * D).toISOString().slice(0,7);
    const m15ToMonth = new Date(h1[chunkEnd].t).toISOString().slice(0,7);
    const m15Rows = await env.DB.prepare("SELECT bars FROM backtest_candles WHERE symbol = ? AND timeframe = 'M15' AND month >= ? AND month <= ? ORDER BY month").bind(cfg.symbol, m15FromMonth, m15ToMonth).all<{bars:string}>();
    const m15Chunk = m15Rows.results.flatMap(x => JSON.parse(x.bars) as Candle[]);
    const upperClosed = (bars: Candle[], cutoff: number, duration: number) => {
      let lo = 0, hi = bars.length;
      while (lo < hi) { const mid = (lo + hi) >>> 1; if (bars[mid].t + duration <= cutoff) lo = mid + 1; else hi = mid; }
      return lo;
    };
    // Positionner les curseurs H4/D1 directement, puis avancer dans chaque bloc.
    let h4End = upperClosed(h4, h1[cursor].t + H, 4 * H), d1End = upperClosed(d1, h1[cursor].t + H, D), m15End = upperClosed(m15Chunk, h1[cursor].t + H, 15 * 60_000);
    for (let i = cursor; i < chunkEnd; i++) {
      const t = h1[i].t + H;
      while (h4End < h4.length && h4[h4End].t + 4 * H <= t) h4End++;
      while (d1End < d1.length && d1[d1End].t + D <= t) d1End++;
      while (m15End < m15Chunk.length && m15Chunk[m15End].t + 15 * 60_000 <= t) m15End++;
      if (t < startMs || !isMarketOpen(cfg, t)) continue;
      const hh = h4.slice(Math.max(0, h4End - 260), h4End);
      const dd = d1.slice(Math.max(0, d1End - 260), d1End);
      if (hh.length < 105 || dd.length < 205) continue;
      const m15 = m15Chunk.slice(Math.max(0, m15End - 192), m15End);
      if (m15.length < 40) return err(`Historique M15 absent ou incomplet autour du ${new Date(t).toISOString()}. Importe les M15 sur toute la période, puis relance.`, 422);
      // Ne pas accepter 40 anciennes bougies M15 si les données sont absentes
      // près de la date évaluée : cela pouvait masquer un trou d'import.
      const lastClosedM15 = m15[m15.length - 1];
      if (!lastClosedM15 || lastClosedM15.t + 15 * 60_000 < t - 60 * 60_000) {
        return err(`Données M15 trop anciennes ou trouées autour du ${new Date(t).toISOString()}. Vérifie l'import M15 pour cette période.`, 422);
      }
      decisions++; if (!firstEval) firstEval = t; lastEval = t;
      const an = buildAnalysis(cfg.symbol, h1.slice(Math.max(0, i - 167), i + 1), hh, dd, t, m15);
      const open = t < busyUntil;
      const currencies = cfg.currencies;
      const blocked = mode !== "technical" ? newsBlock(events, currencies, t, CFG.newsBeforeMin, CFG.newsAfterMin) : null;
      if (blocked) { newsBlocked++; continue; }
      const macro = mode === "fundamental" ? fundamentalBias(events, cfg.symbol, t) : { bias: 0, detail: "" };
      const evals = (["BUY", "SELL"] as Dir[]).map((dir) => evaluate(an, dir, { newsBlock: null, marketOpen: true, hasOpen: open, p: profileName === "adaptive" ? adaptiveProfile(an, dir, PROFILES.adaptive) : PROFILES[profileName] })).sort((x, y) => Number(y.passed) - Number(x.passed) || y.score - x.score);
      const best = evals[0];
      if (!best?.passed) continue;
      if (mode === "fundamental" && Math.abs(macro.bias) >= 0.2 && ((macro.bias > 0 && best.dir !== "BUY") || (macro.bias < 0 && best.dir !== "SELL"))) { macroRejected++; continue; }
      const sig: Sig = { id: "bt", symbol: cfg.symbol, direction: best.dir, entry: best.entry, stop_loss: best.sl, tp1: best.tps[0], tp2: best.tps[1], tp3: best.tps[2], tp_reached: 0, created_at: t / 1000 };
      const horizon = t + CFG.expiryHours * H;
      const futureLimit = Math.min(horizon, nowMs - H);
      // Les bougies H1 étant triées, commencer à i+1 et avancer jusqu'à la limite
      // évite un filtre complet de l'historique pour chaque trade.
      let futureStart = i + 1;
      while (futureStart < h1.length && h1[futureStart].t < t) futureStart++;
      let futureEnd = futureStart;
      while (futureEnd < h1.length && h1[futureEnd].t < futureLimit) futureEnd++;
      const future = h1.slice(futureStart, futureEnd);
      const out = evaluateOutcome(sig, future, nowMs / 1, H);
      busyUntil = out.at ? out.at + H : Math.min(horizon, nowMs);
      setups++;
      const risk = Math.abs(best.entry - best.sl) || 1e-9;
      seq.push({ t, outcome: out.outcome, costR: (costAtr * an.atr) / risk });
    }
    if (chunkEnd < h1.length - 1) {
      return json({ partial: true, cursor: chunkEnd, progress: Math.round(((chunkEnd - 104) / Math.max(1, h1.length - 1 - 104)) * 100), state: { seq, busyUntil, decisions, setups, firstEval, lastEval, newsBlocked, macroRejected } });
    }
    const metrics = summarize(seq);
    return json({ symbol: cfg.symbol, profile: profileName, mode, source, days, events_loaded: events.length, news_blocked_decisions: newsBlocked, macro_direction_rejections: macroRejected, coverage_start: firstEval ? new Date(firstEval).toISOString() : null, coverage_end: lastEval ? new Date(lastEval).toISOString() : null, requested_start: new Date(from).toISOString(), available_end: new Date(effectiveEnd).toISOString(), coverage_complete: !!firstEval && firstEval <= from + 3 * D && lastEval >= effectiveEnd - 3 * D, decisions, setups, cost_atr: costAtr, metrics, trades: seq.map((x) => ({ date: new Date(x.t).toISOString(), result: x.outcome, cost_r: Math.round(x.costR * 100) / 100 })), note: `${mode === "technical" ? "Mode technique seul : aucun événement économique historique n’est appliqué." : "Mode événementiel : seuls les événements fournis dans le fichier importé sont appliqués. Filtre High avant/après publication ; le mode fondamental ajoute un filtre directionnel sur les surprises actual/prévision disponibles dans les 6 heures. Couverture incomplète ou données manquantes = pas de biais inventé."} Confirmations M15, structure et displacement évalués avec les bougies M15 clôturées. Les sorties TP/SL restent rejouées en H1 pour conserver une comparaison homogène. Ce test ne reproduit pas les révisions de données ni l’exécution IA.` });
  }

  // --- Test des sources de données (BiQuote / Yahoo) ---
  if (pathname === "/api/admin/datatest" && m === "POST") {
    const b = await req.json<{ symbol?: string }>().catch(() => ({} as { symbol?: string }));
    const cfg = SYMBOLS.find((x) => x.symbol === b.symbol) ?? SYMBOLS[0];
    return json({ symbol: cfg.symbol, sources: [...(await probeSources(env, cfg)), ...(await probeIntermarket(env))] });
  }

  // --- Test de la connexion Telegram ---
  if (pathname === "/api/admin/telegram/test" && m === "POST") {
    const r = await tgSend(env, "✅ <b>Lucide</b> : la connexion Telegram fonctionne. Les signaux et leurs résultats arriveront ici.");
    return r.ok ? json({ ok: true, sent: r.sent }) : err(r.errors.join(" | "), 502);
  }

  // --- Lancer le moteur IA à la demande ---
  if (pathname === "/api/admin/run-signals" && m === "POST") {
    const b = await req.json<{ symbol?: string }>().catch(() => ({} as { symbol?: string }));
    // Exécution synchrone (un actif à la fois) : l'analyse + les IA peuvent prendre 1 à 2 minutes.
    const results = await runAutoSignals(env, { force: true, symbol: b.symbol });
    return json({ results });
  }

  // --- Apprentissage V1 : rapport en lecture seule, mode observation ---
  if (pathname === "/api/admin/learning" && m === "GET") {
    return json(await learningReport(env));
  }

  // V2 shadow : performances des signaux virtuels, isolées des résultats Origin.
  if (pathname === "/api/admin/learning/v2" && m === "GET") {
    return json(await shadowReport(env));
  }
  if (pathname === "/api/admin/learning/v2/recommendations" && m === "GET") {
    return json(await learningV2Report(env));
  }

  if (pathname === "/api/admin/learning/control" && m === "GET") {
    const control = await env.DB.prepare("SELECT active_engine, updated_at, updated_by, reason FROM engine_control WHERE id=1").first();
    const pending = await env.DB.prepare("SELECT COUNT(*) n FROM learning_recommendations WHERE status='pending'").first<{n:number}>();
    return json({ control: {...(control as Record<string,unknown> ?? {}), active_engine:"origin"}, pending: pending?.n ?? 0, engines: [{id:"origin",label:"Moteur historique ICT/SMC/CRT",available:true,mode:"production"},{id:"v2",label:"Lucide V2 Liquidity Intelligence",available:true,mode:"shadow_only"}], fallback_available: true, note: "Origin publie les signaux réels. V2 analyse en parallèle et suit des signaux virtuels ; aucune publication, notification ou modification des paramètres live." });
  }
  if (pathname === "/api/admin/learning/engine" && m === "POST") {
    const body = await req.json<{engine?:string;note?:string}>().catch(() => ({} as {engine?:string;note?:string}));
    if (body.engine !== "origin") return err("V2 fonctionne uniquement en shadow. Son activation en production est verrouillée jusqu'à validation statistique et hors-échantillon.", 409);
    const reason = (body.note || "Confirmation du moteur historique Origin en production").slice(0,500);
    await env.DB.prepare("UPDATE engine_control SET active_engine='origin',updated_at=?,updated_by=?,reason=? WHERE id=1").bind(now,user.email,reason).run();
    return json({ok:true,active_engine:"origin",message:"Origin reste le seul moteur de production ; V2 continue son observation parallèle."});
  }
  if (pathname === "/api/admin/learning/recommendations/generate" && m === "POST") {
    const report = await learningV2Report(env); let created = 0;
    for (const r of report.recommendations) {
      if (r.status === "insufficient_data" || r.status === "neutral") continue;
      const strategy = r.strategy ?? "Non classé";
      const existing = await env.DB.prepare("SELECT id FROM learning_recommendations WHERE symbol=? AND strategy=? AND status='pending'").bind(r.symbol,strategy).first();
      if (existing) continue;
      const id = newId();
      const recommendation = r.status === "promising" ? "Étudier un profil de validation dédié ; conserver les paramètres actuels jusqu'à validation hors-échantillon." : "Réexaminer cette configuration en backtest séparé ; ne pas la désactiver automatiquement.";
      await env.DB.prepare("INSERT INTO learning_recommendations (id,symbol,strategy,recommendation,evidence_json,status,created_at) VALUES (?,?,?,?,?,'pending',?)").bind(id,r.symbol,strategy,recommendation,JSON.stringify(r),now).run(); created++;
    }
    return json({created,message:"Propositions enregistrées. Le moteur live reste inchangé."});
  }
  if (pathname === "/api/admin/learning/recommendations" && m === "GET") {
    const rows = await env.DB.prepare("SELECT id,symbol,strategy,recommendation,evidence_json,status,created_at,decided_at,decision_note FROM learning_recommendations ORDER BY created_at DESC LIMIT 100").all();
    return json(rows.results.map((r: any) => ({...r,evidence:JSON.parse(r.evidence_json)})));
  }
  const decisionRoute = pathname.match(/^\/api\/admin\/learning\/recommendations\/([\w-]+)\/(approve|reject)$/);
  if (decisionRoute && m === "POST") {
    const body = await req.json<{note?:string}>().catch(() => ({})); const status = decisionRoute[2] === "approve" ? "approved" : "rejected";
    const result = await env.DB.prepare("UPDATE learning_recommendations SET status=?,decided_at=?,decided_by=?,decision_note=? WHERE id=? AND status='pending'").bind(status,now,user.email,(body.note??"").slice(0,500),decisionRoute[1]).run();
    if (!result.meta.changes) return err("Proposition introuvable ou déjà traitée.",404);
    return json({ok:true,status,applied_to_live_engine:false,message:status === "approved" ? "Recommandation approuvée et archivée ; non appliquée au moteur live." : "Recommandation refusée."});
  }
  if (pathname === "/api/admin/learning/rollback" && m === "POST") {
    await env.DB.prepare("UPDATE engine_control SET active_engine='origin',updated_at=?,updated_by=?,reason=? WHERE id=1").bind(now,user.email,"Retour manuel demandé par l'administrateur").run();
    return json({ok:true,active_engine:"origin",message:"Moteur d'origine défini comme moteur actif."});
  }

  // --- Journal d'analyse : pourquoi un signal a (ou n'a pas) été émis ---
  if (pathname === "/api/admin/analysis" && m === "GET") {
    const rows = await env.DB.prepare(
      "SELECT symbol, ts, status, dir, score, gates, ai, note FROM analysis_log WHERE id IN (SELECT MAX(id) FROM analysis_log GROUP BY symbol) ORDER BY symbol"
    ).all<{ gates: string | null; ai: string | null }>();
    return json(rows.results.map((r) => ({ ...r, gates: r.gates ? JSON.parse(r.gates) : [], ai: r.ai ? JSON.parse(r.ai) : null })));
  }

  return err("Not found", 404);
}
