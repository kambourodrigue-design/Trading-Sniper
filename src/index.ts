import { hashPassword, verifyPassword, newId, createSession, bearerToken, getUser, isAdminEmail, getActivePlan } from "./lib/auth";
import { runAutoSignals } from "./scheduled";
import { handleAdmin } from "./admin";
import { CFG } from "./engine/config";
import { ensureSchema } from "./lib/schema";

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

    await ensureSchema(env); // crée les tables au tout premier appel

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

    // --- Statistiques réelles (public) : suivi automatique des TP/SL, séparées par origine du signal ---
    if (pathname === "/api/stats" && req.method === "GET") {
      const since = Math.floor(Date.now() / 1000) - 90 * 86400;
      const rows = (await env.DB.prepare("SELECT source, outcome, COUNT(*) n FROM signals WHERE source IN ('auto', 'ai') AND status = 'published' AND created_at > ? GROUP BY source, outcome").bind(since).all<{ source: string; outcome: string; n: number }>()).results;
      const sum = (src: string | null) => {
        const c: Record<string, number> = {};
        for (const r of rows) if (src === null || r.source === src) c[r.outcome] = (c[r.outcome] ?? 0) + r.n;
        const win = (c.tp1 ?? 0) + (c.tp2 ?? 0) + (c.tp3 ?? 0), loss = c.sl ?? 0;
        return { open: c.open ?? 0, expired: c.expired ?? 0, reached_tp1_or_more: win, stopped_before_tp1: loss, tp1_rate: win + loss ? Math.round((100 * win) / (win + loss)) : null };
      };
      // auto = signaux des règles validés par les IA ; ai = analyses indépendantes des IA
      return json({ window_days: 90, ...sum(null), by_source: { auto: sum("auto"), ai: sum("ai") } });
    }

    // --- Webhooks de paiement (vérification de signature à ajouter avant la mise en production) ---
    if (pathname === "/api/webhooks/stripe" && req.method === "POST") return json({ received: true });
    if (pathname === "/api/webhooks/cinetpay" && req.method === "POST") return json({ received: true });

    return err("Not found", 404);
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(ensureSchema(env).then(() => runAutoSignals(env)));
  },
};
