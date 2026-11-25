import { hashPassword, verifyPassword, newId, createSession, bearerToken, getUser, isAdminEmail, getActivePlan } from "./lib/auth";
import { runAutoSignals } from "./scheduled";
import { handleAdmin } from "./admin";
import { CFG, SYMBOLS } from "./engine/config";
import { getBundle, chartPayload } from "./lib/prices";
import { ensureSchema } from "./lib/schema";
import { summarizeCounts } from "./engine/metrics";
import { sendDailySummary } from "./lib/telegram";

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
}
const err = (message: string, status = 400) => json({ error: message }, status);

interface SignalRow { symbol: string; entry: number | null; stop_loss: number | null; tp1: number | null; tp2: number | null; tp3: number | null; reasoning: string | null; ai_votes: string | null; [k: string]: unknown }

// Masque les niveaux selon l'abonnement : sans plan → verrouillé ; Starter → actifs limités ; Pro/Elite → tout + explication.
function applyAccess(rows: SignalRow[], plan: string | null): unknown[] {
  return rows.map((r) => {
    const allowed = plan === "pro" || plan === "elite" || (plan === "starter" && CFG.starterSymbols.includes(r.symbol));
    const full = plan === "pro" || plan === "elite";
    const base = { ...r, ai_votes: full && r.ai_votes ? JSON.parse(r.ai_votes) : null, reasoning: full ? r.reasoning : null };
    return allowed ? { ...base, locked: false } : { ...base, entry: null, stop_loss: null, tp1: null, tp2: null, tp3: null, locked: true };
  });
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    const { pathname } = url;

    if (req.method === "OPTIONS") {
      return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST,PATCH,DELETE,OPTIONS", "access-control-allow-headers": "content-type,authorization" } });
    }

    try {
      await ensureSchema(env); // crée les tables au tout premier appel

    // Diagnostic léger du backend : vérifie les dépendances sans exposer de secrets.
    if (pathname === "/api/health" && req.method === "GET") {
      const checks: Record<string, string> = { worker: "ok", d1: "error", kv: "error" };
      try { await env.DB.prepare("SELECT 1 AS ok").first(); checks.d1 = "ok"; } catch (e) { console.error("health D1", e); }
      try { await env.CACHE.get("__lucide_health_check__"); checks.kv = "ok"; } catch (e) { console.error("health KV", e); }
      const ok = checks.d1 === "ok" && checks.kv === "ok";
      return json({ status: ok ? "ok" : "degraded", checks, timestamp: new Date().toISOString() }, ok ? 200 : 503);
    }

    const adminRes = await handleAdmin(req, env, ctx, pathname);
    if (adminRes) return adminRes;

    // --- Auth ---
    if (pathname === "/api/auth/register" && req.method === "POST") {
      const { email, password } = await req.json<{ email?: string; password?: string }>();
      if (!email || !password || password.length < 8) return err("Email invalide ou mot de passe trop court (8 caractères min).");
      const existing = await env.DB.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
      if (existing) return err("Un compte existe déjà avec cet email.", 409);
      const { hash, salt } = await hashPassword(password);
      const userId = newId();
      await env.DB.prepare("INSERT INTO users (id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)").bind(userId, email, hash, salt, Math.floor(Date.now() / 1000)).run();
      return json({ token: await createSession(env.DB, userId), user: { id: userId, email } }, 201);
    }

    if (pathname === "/api/auth/login" && req.method === "POST") {
      const { email, password } = await req.json<{ email?: string; password?: string }>();
      if (!email || !password) return err("Email et mot de passe requis.");
      const user = await env.DB.prepare("SELECT id, password_hash, password_salt FROM users WHERE email = ?").bind(email).first<{ id: string; password_hash: string; password_salt: string }>();
      if (!user || !(await verifyPassword(password, user.password_hash, user.password_salt))) return err("Identifiants invalides.", 401);
      return json({ token: await createSession(env.DB, user.id), user: { id: user.id, email } });
    }

    // --- Profil courant ---
    if (pathname === "/api/me" && req.method === "GET") {
      const user = await getUser(env.DB, bearerToken(req));
      if (!user) return err("Non authentifié.", 401);
      const sub = await getActivePlan(env.DB, user.id);
      return json({ id: user.id, email: user.email, plan: sub?.plan ?? (isAdminEmail(env, user.email) ? "elite" : null), plan_end: sub?.current_period_end ?? null, is_admin: isAdminEmail(env, user.email) });
    }

    // --- Flux de signaux (public, mais niveaux verrouillés selon l'abonnement) ---
    if (pathname === "/api/signals/latest" && req.method === "GET") {
      let raw = await env.CACHE.get("signals:latest");
      if (!raw) {
        const rows = await env.DB.prepare(
          "SELECT id, symbol, direction, entry, stop_loss, tp1, tp2, tp3, confidence, strategy, rr_ratio, source, timeframe, score, reasoning, ai_votes, tp_reached, outcome, created_at FROM signals WHERE user_id IS NULL AND status = 'published' ORDER BY created_at DESC LIMIT 20"
        ).all();
        raw = JSON.stringify(rows.results);
        await env.CACHE.put("signals:latest", raw, { expirationTtl: 1800 }); // le cron invalide ce cache à chaque exécution
      }
      const user = await getUser(env.DB, bearerToken(req));
      // L'administrateur voit tout (accès complet sans abonnement)
      const plan = user ? (isAdminEmail(env, user.email) ? "elite" : (await getActivePlan(env.DB, user.id))?.plan ?? null) : null;
      return json(applyAccess(JSON.parse(raw) as SignalRow[], plan));
    }

    // --- Scanner IA : dernier signal publié par marché, directement issu du moteur existant ---
    if (pathname === "/api/scanner" && req.method === "GET") {
      const rows = await env.DB.prepare(
        `WITH ranked AS (
          SELECT id, symbol, direction, entry, stop_loss, tp1, tp2, tp3, confidence, strategy,
                 rr_ratio, source, timeframe, score, reasoning, ai_votes, tp_reached, outcome, created_at,
                 ROW_NUMBER() OVER (PARTITION BY symbol ORDER BY created_at DESC, id DESC) AS rn
          FROM signals
          WHERE user_id IS NULL AND status = 'published'
        )
        SELECT id, symbol, direction, entry, stop_loss, tp1, tp2, tp3, confidence, strategy,
               rr_ratio, source, timeframe, score, reasoning, ai_votes, tp_reached, outcome, created_at
        FROM ranked WHERE rn = 1`
      ).all<SignalRow>();
      const user = await getUser(env.DB, bearerToken(req));
      const plan = user ? (isAdminEmail(env, user.email) ? "elite" : (await getActivePlan(env.DB, user.id))?.plan ?? null) : null;
      const bySymbol = new Map<string, SignalRow>();
      for (const row of rows.results) bySymbol.set(row.symbol, row);
      const assets = SYMBOLS.map((cfg) => {
        const row = bySymbol.get(cfg.symbol);
        return { symbol: cfg.symbol, label: cfg.label, market: cfg.session === "crypto" ? "Crypto" : "Forex / Métaux", signal: row ? applyAccess([row], plan)[0] : null };
      });
      return json({ assets, total_markets: assets.length, updated_at: Math.floor(Date.now() / 1000) });
    }

    // --- Historique des signaux réellement publiés par le moteur ---
    if (pathname === "/api/history" && req.method === "GET") {
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 50) || 50));
      const rows = await env.DB.prepare(
        `SELECT id, symbol, direction, entry, stop_loss, tp1, tp2, tp3, confidence, strategy,
                rr_ratio, source, timeframe, score, reasoning, ai_votes, tp_reached, outcome, created_at, closed_at
         FROM signals WHERE user_id IS NULL AND status = 'published'
         ORDER BY created_at DESC LIMIT ?`
      ).bind(limit).all<SignalRow>();
      const user = await getUser(env.DB, bearerToken(req));
      const plan = user ? (isAdminEmail(env, user.email) ? "elite" : (await getActivePlan(env.DB, user.id))?.plan ?? null) : null;
      return json({ signals: applyAccess(rows.results, plan), count: rows.results.length, updated_at: Math.floor(Date.now() / 1000) });
    }

    // --- Bougies pour le graphique du dashboard (compte requis ; servi depuis le cache horaire du moteur) ---
    if (pathname === "/api/candles" && req.method === "GET") {
      if (!(await getUser(env.DB, bearerToken(req)))) return err("Non authentifié.", 401);
      const symbol = url.searchParams.get("symbol") ?? "", tf = (url.searchParams.get("tf") ?? "H1").toUpperCase();
      const cfg = SYMBOLS.find((s) => s.symbol === symbol);
      if (!cfg) return err("Actif inconnu.", 404);
      if (!["H1", "H4", "D1"].includes(tf)) return err("tf : H1 | H4 | D1.");
      try {
        const b = await getBundle(env, cfg, Date.now());
        return json({ symbol, tf, source: b.source, candles: chartPayload(b, tf) });
      } catch (e) { return err(`Données indisponibles : ${(e as Error).message.slice(0, 200)}`, 503); }
    }

    // --- Statistiques réelles (public) : suivi automatique des TP/SL, séparées par origine du signal ---
    if (pathname === "/api/stats" && req.method === "GET") {
      const since = Math.floor(Date.now() / 1000) - 90 * 86400;
      const rows = (await env.DB.prepare("SELECT source, outcome, COUNT(*) n FROM signals WHERE source IN ('auto', 'ai') AND status = 'published' AND created_at > ? GROUP BY source, outcome").bind(since).all<{ source: string; outcome: string; n: number }>()).results;
      const sum = (src: string | null) => {
        const c: Record<string, number> = {};
        for (const r of rows) if (src === null || r.source === src) c[r.outcome] = (c[r.outcome] ?? 0) + r.n;
        const win = (c.tp1 ?? 0) + (c.tp2 ?? 0) + (c.tp3 ?? 0), loss = c.sl ?? 0;
        // tp1_rate / reached_tp1_or_more / stopped_before_tp1 : anciens champs conservés (le breakeven y compte comme gagnant).
        // `performance` : mesure en R (breakeven séparé, espérance, profit factor), sans spread ni slippage.
        const perf = summarizeCounts(c);
        // TAUX UNIQUE DU SITE : `win_rate` = % de trades clos ayant atteint TP1, TP2 ou TP3 (break-even après TP1 compté gagnant). Toutes les pages le lisent ici.
        return { open: c.open ?? 0, expired: c.expired ?? 0, win_rate: perf.win_rate, wins: perf.tp_hits, losses: perf.losses, trades: perf.trades, reached_tp1_or_more: win, stopped_before_tp1: loss, tp1_rate: win + loss ? Math.round((100 * win) / (win + loss)) : null, performance: perf };
      };
      // auto = signaux des règles validés par les IA ; ai = analyses indépendantes des IA
      return json({ window_days: 90, ...sum(null), by_source: { auto: sum("auto"), ai: sum("ai") } });
    }

    // --- Webhooks de paiement (vérification de signature à ajouter avant la mise en production) ---
    if (pathname === "/api/webhooks/stripe" && req.method === "POST") return json({ received: true });
    if (pathname === "/api/webhooks/cinetpay" && req.method === "POST") return json({ received: true });

      return err("Not found", 404);
    } catch (e) {
      console.error("worker fetch error", pathname, e instanceof Error ? (e.stack || e.message) : e);
      // Garder une réponse JSON pour les routes API, même lorsqu'une exception survient.
      return json({ error: "Internal server error", path: pathname }, 500);
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(ensureSchema(env).then(async () => {
      try { await runAutoSignals(env); }
      catch (e) { console.error("scheduled engine", e); }
      await sendDailySummary(env, Date.now());
    }));
  },
};
