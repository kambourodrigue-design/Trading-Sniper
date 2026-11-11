import { bearerToken, getUser, isAdminEmail, newId } from "./lib/auth";
import { runAutoSignals } from "./scheduled";
import { tgSend, notify, signalMessage, closedMessage } from "./lib/telegram";
import { SYMBOLS } from "./engine/config";
import { probeSources } from "./lib/prices";

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
    const outc = await env.DB.prepare("SELECT source, outcome, COUNT(*) n FROM signals WHERE source IN ('auto', 'ai') AND created_at > ? GROUP BY source, outcome").bind(now - 90 * 86400).all<{ source: string; outcome: string; n: number }>();
    const tally = (src: string | null) => {
      let w = 0, l = 0;
      for (const r of outc.results) if (src === null || r.source === src) { if (r.outcome === "sl") l += r.n; else if (r.outcome.startsWith("tp")) w += r.n; }
      return { wins: w, losses: l, rate: w + l ? Math.round((100 * w) / (w + l)) : null };
    };
    const all = tally(null), viaRules = tally("auto"), viaAi = tally("ai");
    const wins = all.wins, losses = all.losses;
    const by_plan: Record<string, number> = {};
    let active = 0;
    for (const r of byPlan.results) { by_plan[r.plan] = r.n; active += r.n; }
    return json({ users: users?.n ?? 0, active_subscribers: active, by_plan, signals_24h: s24?.n ?? 0, open_signals: openSig?.n ?? 0, tp1_rate: all.rate, wins, losses, rules_rate: viaRules.rate, ai_rate: viaAi.rate });
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
    await notify(env, signalMessage({ symbol, direction, entry: num(b.entry), stop_loss: num(b.stop_loss), tp1: num(b.tp1), tp2: num(b.tp2), tp3: num(b.tp3), confidence: num(b.confidence), rr_ratio: b.rr_ratio ? String(b.rr_ratio) : null, strategy: b.strategy ? String(b.strategy) : null, source: "manual" }));
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

  // --- Test des sources de données (Yahoo / Binance / TwelveData) ---
  if (pathname === "/api/admin/datatest" && m === "POST") {
    const b = await req.json<{ symbol?: string }>().catch(() => ({} as { symbol?: string }));
    const cfg = SYMBOLS.find((x) => x.symbol === b.symbol) ?? SYMBOLS[0];
    return json({ symbol: cfg.symbol, sources: await probeSources(env, cfg) });
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

  // --- Journal d'analyse : pourquoi un signal a (ou n'a pas) été émis ---
  if (pathname === "/api/admin/analysis" && m === "GET") {
    const rows = await env.DB.prepare(
      "SELECT symbol, ts, status, dir, score, gates, ai, note FROM analysis_log WHERE id IN (SELECT MAX(id) FROM analysis_log GROUP BY symbol) ORDER BY symbol"
    ).all<{ gates: string | null; ai: string | null }>();
    return json(rows.results.map((r) => ({ ...r, gates: r.gates ? JSON.parse(r.gates) : [], ai: r.ai ? JSON.parse(r.ai) : null })));
  }

  return err("Not found", 404);
}
