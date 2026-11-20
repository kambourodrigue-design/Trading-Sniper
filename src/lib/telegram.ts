// Notifications Telegram (usage personnel) : nouveaux signaux + résultats (TP1/TP2/TP3/SL/clôture).
// Secrets : TELEGRAM_BOT_TOKEN (de @BotFather) et TELEGRAM_CHAT_ID (ton chat ou canal ; plusieurs possibles, séparés par des virgules).

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (x: number | null | undefined) => (x == null ? "—" : String(x));
const DISCLAIMER = "⚠️ Aide à la décision, pas un conseil financier. Risque de perte en capital.";

export const tgConfigured = (env: Env) => !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID);

export async function tgSend(env: Env, html: string): Promise<{ ok: boolean; sent: number; errors: string[] }> {
  if (!tgConfigured(env)) return { ok: false, sent: 0, errors: ["TELEGRAM_BOT_TOKEN et TELEGRAM_CHAT_ID ne sont pas configurés"] };
  const errors: string[] = [];
  let sent = 0;
  for (const id of env.TELEGRAM_CHAT_ID!.split(",").map((x) => x.trim()).filter(Boolean)) {
    try {
      const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ chat_id: id, text: html.slice(0, 4000), parse_mode: "HTML", disable_web_page_preview: true, protect_content: true }),
        signal: AbortSignal.timeout(15_000),
      });
      const j = (await res.json()) as { ok?: boolean; description?: string };
      if (j.ok) sent++; else errors.push(`${id} : ${j.description ?? `HTTP ${res.status}`}`);
    } catch (e) { errors.push(`${id} : ${(e as Error).message}`); }
  }
  return { ok: sent > 0 && errors.length === 0, sent, errors };
}

// Ne lève jamais d'erreur : un souci Telegram ne doit jamais bloquer le moteur.
export async function notify(env: Env, html: string): Promise<void> {
  if (!tgConfigured(env)) return;
  try {
    const r = await tgSend(env, html);
    if (r.errors.length) console.error("telegram", r.errors.join(" | "));
  } catch (e) { console.error("telegram", (e as Error).message); }
}

export interface SigInfo {
  symbol: string; direction: string; entry: number | null; stop_loss: number | null; tp1: number | null; tp2: number | null; tp3: number | null;
  confidence?: number | null; rr_ratio?: string | null; strategy?: string | null; reasoning?: string | null; source?: string;
  votes?: Array<{ provider: string; confidence: number; reasoning?: string }>;
}
const AI_NAME: Record<string, string> = { openai: "GPT-6", deepseek: "DeepSeek", gemini: "Gemini", claude: "Claude" };
const directionEmoji = (direction: string) => direction === "BUY" ? "🟢📈" : direction === "SELL" ? "🔴📉" : "⚪";
const sourceLabel = (source?: string) => source === "ai" ? "Analyse IA indépendante" : source === "manual" ? "Signal manuel" : "Moteur autonome + validation IA";

export function signalMessage(s: SigInfo): string {
  const head = `${directionEmoji(s.direction)} <b>${esc(s.direction)}</b>${s.confidence != null ? ` · confiance <b>${s.confidence}%</b>` : ""}${s.rr_ratio ? ` · R/R <b>${esc(s.rr_ratio)}</b>` : ""}`;
  const lines = [
    `🚨 <b>NOUVEAU SIGNAL — ${esc(s.symbol)}</b>`, head, "",
    `🎯 Entrée : <b>${n(s.entry)}</b>`, `🛡️ Stop Loss : <b>${n(s.stop_loss)}</b>`,
    `🏁 Objectifs : TP1 <b>${n(s.tp1)}</b> · TP2 <b>${n(s.tp2)}</b> · TP3 <b>${n(s.tp3)}</b>`,
  ];
  if (s.strategy) lines.push("", `🧠 <b>Stratégie utilisée</b> : ${esc(s.strategy)}`);
  if (s.reasoning) lines.push(`📋 <b>Lecture du setup</b> : <i>${esc(s.reasoning.slice(0, 650))}</i>`);
  if (s.votes?.length) lines.push("", "🤖 <b>Validation des IA</b>", ...s.votes.map((v) => `• ${esc(AI_NAME[v.provider] ?? v.provider)} (${v.confidence}%)${v.reasoning ? ` : ${esc(v.reasoning.slice(0, 170))}` : ""}`));
  lines.push("", `⚙️ Origine : ${sourceLabel(s.source)}`, "📌 Suivi automatique des TP, du stop et de la clôture.", "", DISCLAIMER);
  return lines.join("\n");
}

const pipUnit = (symbol: string): number | null => {
  if (/^[A-Z]{3}\/[A-Z]{3}$/.test(symbol)) return symbol.endsWith("JPY") ? 0.01 : 0.0001;
  return null;
};
const signed = (v: number, digits = 1) => `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
const priceMove = (direction: string, entry: number, exit: number) => (direction === "BUY" ? exit - entry : entry - exit);

// Message envoyé à chaque changement d'étape ; les pips sont calculés sur le niveau de sortie réellement modélisé.
export function outcomeMessage(
  s: { symbol: string; direction: string; entry: number; stop_loss: number; tp1: number | null; tp2?: number | null; tp3?: number | null },
  prevTp: number,
  r: { tp: number; outcome: string },
): string | null {
  const who = `<b>${esc(s.symbol)} ${esc(s.direction)}</b>`;
  const unit = pipUnit(s.symbol);
  const fmtGain = (exit: number | null | undefined) => {
    if (exit == null) return "";
    const move = priceMove(s.direction, s.entry, exit);
    return unit ? ` · ${signed(move / unit)} pips` : s.symbol === "XAU/USD" ? ` · ${signed(move, 2)} $ de mouvement` : ` · variation ${signed(move, 2)} $`;
  };
  if (r.outcome === "sl") return `🛑 ${who} — Stop Loss touché, position clôturée.${fmtGain(s.stop_loss)}`;
  if (r.outcome === "tp3") return `🏆 ${who} — TP3 atteint ! Objectif final réalisé, trade clôturé.${fmtGain(s.tp3)}`;
  if (r.outcome === "expired") return `⏳ ${who} — durée maximale atteinte sans TP3 ni SL final ; résultat classé neutre, trade clôturé.`;
  if (r.outcome.startsWith("tp")) {
    const exit = r.tp >= 2 ? s.tp1 : s.entry;
    return `🔐 ${who} — retour sur le stop suiveur après TP${r.tp}. Trade clôturé, gain sécurisé.${fmtGain(exit)}`;
  }
  if (r.outcome === "open" && r.tp > prevTp) {
    const moved = r.tp === 1 ? `SL déplacé à l'entrée (${s.entry})` : `SL déplacé à TP1 (${n(s.tp1)})`;
    const locked = r.tp === 1 ? "0 pip sécurisé (protection au break-even)" : (unit && s.tp1 != null ? `${signed(priceMove(s.direction, s.entry, s.tp1) / unit)} pips sécurisés` : `niveau protégé : ${n(s.tp1)}`);
    return `✅ ${who} — TP${r.tp} atteint ! ${moved}. 🔒 ${locked}. Position toujours suivie.`;
  }
  return null;
}

export const closedMessage = (symbol: string, direction: string) => `🔒 <b>${esc(symbol)} ${esc(direction)}</b> — trade clôturé manuellement. Résultat non comptabilisé faute de prix de sortie.`;

interface DailyTrade {
  symbol: string; direction: string; entry: number | null; stop_loss: number | null; tp1: number | null; tp3: number | null;
  outcome: string; source: string; strategy: string | null; created_at: number; closed_at: number | null;
}

/** Envoie une synthèse quotidienne UTC (Burkina Faso = UTC) une seule fois, sans migration D1. */
export async function sendDailySummary(env: Env, now = Date.now()): Promise<void> {
  if (!tgConfigured(env)) return;
  const d = new Date(now);
  // Le cron actuel passe toutes les 2 minutes : envoyer à 20:00 UTC (tolérance jusqu’à 20:02).
  // La clé quotidienne empêche tout doublon si le cron repasse pendant cette fenêtre.
  if (d.getUTCHours() !== 20 || d.getUTCMinutes() > 2) return;
  const day = d.toISOString().slice(0, 10);
  const key = `telegram:daily:${day}`;
  if (await env.CACHE.get(key)) return;
  const start = Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / 1000);
  const end = start + 86400;
  const created = await env.DB.prepare(
    "SELECT COUNT(*) n FROM signals WHERE user_id IS NULL AND status = 'published' AND created_at >= ? AND created_at < ?"
  ).bind(start, end).first<{ n: number }>();
  const open = await env.DB.prepare(
    "SELECT COUNT(*) n FROM signals WHERE user_id IS NULL AND outcome = 'open' AND created_at < ?"
  ).bind(end).first<{ n: number }>();
  const rows = (await env.DB.prepare(
    "SELECT symbol, direction, entry, stop_loss, tp1, tp3, outcome, source, strategy, created_at, closed_at FROM signals WHERE user_id IS NULL AND status = 'published' AND closed_at >= ? AND closed_at < ? ORDER BY closed_at DESC"
  ).bind(start, end).all<DailyTrade>()).results;

  const counts: Record<string, number> = {};
  let fxPips = 0, fxCount = 0, goldMove = 0, goldCount = 0, cryptoMove = 0, cryptoCount = 0;
  let grossWinPips = 0, grossLossPips = 0, bestPips: number | null = null, worstPips: number | null = null;
  let measuredWins = 0, measuredLosses = 0, neutral = 0;
  const closedDetails: string[] = [];
  const perSymbol = new Map<string, { n: number; wins: number; losses: number; pips: number; measured: number }>();
  for (const t of rows) {
    counts[t.outcome] = (counts[t.outcome] ?? 0) + 1;
    if (t.outcome === "tp2" || t.outcome === "tp3") measuredWins++;
    else if (t.outcome === "sl") measuredLosses++;
    else neutral++;
    const stats = perSymbol.get(t.symbol) ?? { n: 0, wins: 0, losses: 0, pips: 0, measured: 0 };
    stats.n++;
    if (t.outcome === "tp2" || t.outcome === "tp3") stats.wins++;
    if (t.outcome === "sl") stats.losses++;
    let exit: number | null = null;
    if (t.outcome === "sl") exit = t.stop_loss;
    else if (t.outcome === "tp1") exit = t.entry; // TP1 puis stop au break-even
    else if (t.outcome === "tp2") exit = t.tp1; // TP2 puis stop suiveur à TP1
    else if (t.outcome === "tp3") exit = t.tp3;
    if (exit != null && t.entry != null) {
      const move = priceMove(t.direction, t.entry, exit);
      const pip = pipUnit(t.symbol);
      if (pip) { const p = move / pip; fxPips += p; fxCount++; stats.pips += p; stats.measured++; if (p > 0) grossWinPips += p; else if (p < 0) grossLossPips += Math.abs(p); bestPips = bestPips == null ? p : Math.max(bestPips, p); worstPips = worstPips == null ? p : Math.min(worstPips, p); }
      else if (t.symbol === "XAU/USD") { goldMove += move; goldCount++; }
      else if (t.symbol === "BTC/USD" || t.symbol === "ETH/USD") { cryptoMove += move; cryptoCount++; }
    }
    perSymbol.set(t.symbol, stats);
    const icon = t.outcome === "sl" ? "🔴" : t.outcome === "tp3" ? "🏆" : t.outcome === "tp2" ? "🟢" : "🟡";
    const label = t.outcome === "sl" ? "SL" : t.outcome === "tp3" ? "TP3" : t.outcome === "tp2" ? "TP2 puis stop suiveur" : t.outcome === "tp1" ? "TP1 / break-even" : t.outcome === "expired" ? "Expiration" : "Clôture manuelle";
    let detail = `${icon} ${esc(t.symbol)} ${esc(t.direction)} — ${label}`;
    if (exit != null && t.entry != null) {
      const pip = pipUnit(t.symbol);
      const move = priceMove(t.direction, t.entry, exit);
      if (pip) detail += ` : <b>${signed(move / pip)} pips</b>`;
      else if (t.symbol === "XAU/USD") detail += ` : <b>${signed(move, 2)} $</b>`;
      else detail += ` : <b>${signed(move, 2)} $</b>`;
    }
    closedDetails.push(detail);
  }
  const closed = rows.length;
  const decided = measuredWins + measuredLosses;
  const winRate = decided ? Math.round(measuredWins * 100 / decided) : null;
  const lines = [
    `📊 <b>BILAN TRADING DU ${day} (UTC)</b>`, "",
    `📨 Nouveaux signaux publiés : <b>${created?.n ?? 0}</b>`,
    `🔒 Positions clôturées aujourd'hui : <b>${closed}</b>`,
    `🟢 Gagnants (TP2/TP3) : <b>${measuredWins}</b>`,
    `🔴 Perdants (SL) : <b>${measuredLosses}</b>`,
    `🟡 Neutres (TP1/break-even, expiration ou clôture manuelle) : <b>${neutral}</b>`,
    `📈 Taux de réussite* : <b>${winRate == null ? "—" : `${winRate}%`}</b>`,
    `⏳ Positions encore ouvertes : <b>${open?.n ?? 0}</b>`,
    "", "<b>📏 PERFORMANCE MESURÉE</b>",
    `💱 Forex : <b>${fxCount ? `${signed(fxPips)} pips` : "aucun trade clôturé avec sortie mesurable"}</b>`,
    `📐 Moyenne Forex/trade : <b>${fxCount ? `${signed(fxPips / fxCount)} pips` : "—"}</b>`,
    `⚖️ Profit factor Forex (pips) : <b>${grossLossPips > 0 ? (grossWinPips / grossLossPips).toFixed(2) : grossWinPips > 0 ? "∞" : "—"}</b>`,
    `🥇 Meilleur / pire trade Forex : <b>${bestPips == null ? "—" : `${signed(bestPips)} / ${signed(worstPips ?? 0)} pips`}</b>`,
    `🥇 Or : <b>${goldCount ? `${signed(goldMove, 2)} $ de mouvement cumulé (${goldCount} trade(s))` : "—"}</b>`,
    `₿ Crypto : <b>${cryptoCount ? `${signed(cryptoMove, 2)} $ de mouvement cumulé (${cryptoCount} trade(s))` : "—"}</b>`,
  ];
  if (closedDetails.length) {
    lines.push("", "<b>🧾 DÉTAIL DES CLÔTURES</b>", ...closedDetails.slice(0, 10));
    if (closedDetails.length > 10) lines.push(`<i>… et ${closedDetails.length - 10} autre(s) clôture(s)</i>`);
  }
  if (perSymbol.size) {
    lines.push("", "<b>🔎 DÉTAIL PAR ACTIF</b>");
    for (const [symbol, st] of [...perSymbol.entries()].sort((a, b) => b[1].n - a[1].n)) {
      const pips = pipUnit(symbol) && st.measured ? ` · ${signed(st.pips)} pips` : "";
      lines.push(`• ${esc(symbol)} : ${st.n} clôture(s), ${st.wins} gagnant(s), ${st.losses} SL${pips}`);
    }
  }
  const strategies = [...new Set(rows.map((r) => r.strategy).filter((x): x is string => !!x))];
  lines.push("", "<b>🧠 STRATÉGIES UTILISÉES</b>", strategies.length ? strategies.slice(0, 6).map((x) => `• ${esc(x.slice(0, 120))}`).join("\n") : "Aucune position clôturée aujourd'hui.");
  lines.push("", "<i>*Taux calculé sur les trades TP2/TP3 contre SL ; TP1 au break-even, expirations et clôtures manuelles exclus. Les pips ne sont calculés que pour les paires Forex ; or et crypto sont exprimés en variation de prix. Spread, commissions et slippage non déduits.</i>", DISCLAIMER);
  const result = await tgSend(env, lines.join("\n"));
  if (result.ok) await env.CACHE.put(key, "sent", { expirationTtl: 3 * 86400 });
  else console.error("telegram daily summary", result.errors.join(" | "));
}
