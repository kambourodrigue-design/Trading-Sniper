// Notifications Telegram (usage personnel) : nouveaux signaux + résultats (TP1/TP2/TP3/SL/clôture).
// Secrets : TELEGRAM_BOT_TOKEN (de @BotFather) et TELEGRAM_CHAT_ID (ton chat ou canal ; plusieurs possibles, séparés par des virgules).

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const n = (x: number | null | undefined) => (x == null ? "—" : String(x));
import { getFxUsdRates } from "./prices";
import { summarizeCounts } from "../engine/metrics";
import type { FxUsdRates } from "./prices";

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

export async function signalMessage(env: Env, s: SigInfo): Promise<string> {
  const rates = await getFxUsdRates(env);
  const head = `${directionEmoji(s.direction)} <b>${esc(s.direction)}</b>${s.confidence != null ? ` · confiance <b>${s.confidence}%</b>` : ""}${s.rr_ratio ? ` · R/R <b>${esc(s.rr_ratio)}</b>` : ""}`;
  const lines = [
    `🚨 <b>NOUVEAU SIGNAL — ${esc(s.symbol)}</b>`, head, "",
    `🎯 Entrée : <b>${n(s.entry)}</b>`, `🛡️ Stop Loss : <b>${n(s.stop_loss)}</b>`,
    `🏁 Objectifs : TP1 <b>${n(s.tp1)}</b> · TP2 <b>${n(s.tp2)}</b> · TP3 <b>${n(s.tp3)}</b>`,
  ];
  if (s.entry != null) {
    const levels = [["SL", s.stop_loss], ["TP1", s.tp1], ["TP2", s.tp2], ["TP3", s.tp3]] as const;
    lines.push("", `📐 <b>Estimation des résultats — ${REFERENCE_LOT.toFixed(2)} lot</b>`);
    for (const [label, level] of levels) if (level != null) {
      const result = formatMove(s.symbol, s.direction, s.entry, level, rates);
      lines.push(`${label === "SL" ? "🔻" : "🔹"} ${label} : ${result}`);
    }
  }
  if (s.strategy) lines.push("", `🧠 <b>Stratégie utilisée</b> : ${esc(s.strategy)}`);
  if (s.reasoning) lines.push(`📋 <b>Lecture du setup</b> : <i>${esc(s.reasoning.slice(0, 650))}</i>`);
  if (s.votes?.length) lines.push("", "🤖 <b>Validation des IA</b>", ...s.votes.map((v) => `• ${esc(AI_NAME[v.provider] ?? v.provider)} (${v.confidence}%)${v.reasoning ? ` : ${esc(v.reasoning.slice(0, 170))}` : ""}`));
  lines.push("", `⚙️ Origine : ${sourceLabel(s.source)}`, "📌 Suivi automatique des TP, du stop et de la clôture.", "", DISCLAIMER);
  return lines.join("\n");
}

// Convention d'estimation pour 0,01 lot : Forex standard (≈ 0,10 USD/pip),
// XAUUSD : contrat 100 oz/lot. BTC/USD : spécifications Exness fournies par l'utilisateur
// (contrat 1 BTC/lot, tick 0,001, valeur du tick 0,001 USD/lot).
// ETH/USD : spécifications Exness fournies (contrat 1 ETH/lot, tick 0,00001,
 // valeur du tick 0,00001 USD/lot). Le volume minimal Exness indiqué est 0,10 lot.
export const REFERENCE_LOT = 0.01;
const BTC_TICK_SIZE = 0.001;
const BTC_TICK_VALUE_PER_LOT = 0.001;
const ETH_TICK_SIZE = 0.00001;
const ETH_TICK_VALUE_PER_LOT = 0.00001;
const FOREX = new Set([
  "EUR/USD", "GBP/USD", "USD/JPY", "USD/CAD", "USD/CHF", "AUD/USD",
  "NZD/USD", "EUR/GBP", "EUR/JPY", "EUR/CAD", "GBP/JPY", "GBP/CAD",
]);
export const pipUnit = (symbol: string): number | null => {
  if (FOREX.has(symbol)) return symbol.endsWith("JPY") ? 0.01 : 0.0001;
  if (symbol === "BTC/USD") return 1; // convention lisible : 1 pip BTC = 1 USD de variation du cours
  if (symbol === "ETH/USD") return 1; // 1 pip = 1 USD de variation du cours ETH
  if (symbol === "XAU/USD") return 0.01; // 1 cent = 1 pip or
  return null;
};
const signed = (v: number, digits = 1) => `${v > 0 ? "+" : ""}${v.toFixed(digits)}`;
const priceMove = (direction: string, entry: number, exit: number) => (direction === "BUY" ? exit - entry : entry - exit);
export function estimatedUsd(symbol: string, move: number, rates: FxUsdRates = {}, entryPrice?: number): number | null {
  if (!Number.isFinite(move)) return null;
  if (FOREX.has(symbol)) {
    const pips = move / (symbol.endsWith("JPY") ? 0.01 : 0.0001);
    const quote = symbol.split("/")[1];
    let usdPerPip: number | null = null;
    if (quote === "USD") usdPerPip = 0.10;
    else if (quote === "JPY") {
      const rate = symbol === "USD/JPY" ? entryPrice : rates.USDJPY;
      // 0,01 lot génère 10 JPY/pip ; conversion JPY -> USD = 1 / USDJPY.
      if (rate && rate > 0) usdPerPip = 10 / rate;
    } else if (quote === "CAD") {
      const rate = symbol === "USD/CAD" ? entryPrice : rates.USDCAD;
      if (rate && rate > 0) usdPerPip = 0.1 / rate;
    } else if (quote === "CHF") {
      const rate = symbol === "USD/CHF" ? entryPrice : rates.USDCHF;
      if (rate && rate > 0) usdPerPip = 0.1 / rate;
    } else if (quote === "GBP") {
      if (rates.GBPUSD && rates.GBPUSD > 0) usdPerPip = 0.10 * rates.GBPUSD;
    }
    return usdPerPip == null ? null : pips * usdPerPip;
  }
  if (symbol === "XAU/USD") return move; // contrat 100 oz/lot : 0,01 lot = 1 once
  if (symbol === "BTC/USD") return (move / BTC_TICK_SIZE) * BTC_TICK_VALUE_PER_LOT * REFERENCE_LOT;
  if (symbol === "ETH/USD") return (move / ETH_TICK_SIZE) * ETH_TICK_VALUE_PER_LOT * REFERENCE_LOT;
  return null;
}
const formatMove = (symbol: string, direction: string, entry: number, exit: number, rates: FxUsdRates = {}) => {
  const move = priceMove(direction, entry, exit);
  const pip = pipUnit(symbol);
  const usd = estimatedUsd(symbol, move, rates, entry);
  const pips = pip == null ? null : move / pip;
  return `${pips == null ? `variation ${signed(move, 2)} $` : `${signed(pips)} pips`} · ${usd == null ? "P/L $ non estimé" : `${signed(usd, 2)} $ estimés (0,01 lot)`}`;
};

// Message envoyé à chaque changement d'étape ; les montants sont des estimations selon la convention 0,01 lot.
export async function outcomeMessage(
  env: Env, s: { symbol: string; direction: string; entry: number; stop_loss: number; tp1: number | null; tp2?: number | null; tp3?: number | null },
  prevTp: number,
  r: { tp: number; outcome: string },
): Promise<string | null> {
  const rates = await getFxUsdRates(env);
  const who = `<b>${esc(s.symbol)} ${esc(s.direction)}</b>`;
  const fmt = (exit: number | null | undefined) => exit == null ? "" : `\n📊 Résultat estimé : <b>${formatMove(s.symbol, s.direction, s.entry, exit, rates)}</b>`;
  if (r.outcome === "sl") return `🛑 ${who} — Stop Loss touché, position clôturée.${fmt(s.stop_loss)}`;
  if (r.outcome === "tp3") return `🏆 ${who} — TP3 atteint ! Objectif final réalisé, trade clôturé.${fmt(s.tp3)}`;
  if (r.outcome === "expired") return `⏳ ${who} — durée maximale atteinte sans TP3 ni SL final ; résultat classé neutre, trade clôturé.`;
  if (r.outcome.startsWith("tp")) {
    const exit = r.tp >= 2 ? s.tp1 : s.entry;
    return `🔐 ${who} — retour sur le stop suiveur après TP${r.tp}. Trade clôturé, gain sécurisé.${fmt(exit)}`;
  }
  if (r.outcome === "open" && r.tp > prevTp) {
    const target = r.tp === 1 ? s.tp1 : r.tp === 2 ? s.tp2 : s.tp3;
    const moved = r.tp === 1 ? `SL déplacé à l'entrée (${s.entry})` : `SL déplacé à TP1 (${n(s.tp1)})`;
    const progress = target == null ? "" : `\n🎯 Niveau TP${r.tp} : <b>${formatMove(s.symbol, s.direction, s.entry, target, rates)}</b>`;
    const secured = r.tp >= 2 && s.tp1 != null ? `\n🔒 Gain protégé au SL suiveur : <b>${formatMove(s.symbol, s.direction, s.entry, s.tp1, rates)}</b>` : "\n🔒 Protection au break-even : 0,00 $";
    return `✅ ${who} — TP${r.tp} atteint ! ${moved}.${progress}${secured}\n⏳ Position toujours suivie.`;
  }
  return null;
}

export const closedMessage = (symbol: string, direction: string) => `🔒 <b>${esc(symbol)} ${esc(direction)}</b> — trade clôturé manuellement. Résultat non comptabilisé faute de prix de sortie.`;

interface DailyTrade {
  symbol: string; direction: string; entry: number | null; stop_loss: number | null; tp1: number | null; tp2: number | null; tp3: number | null;
  outcome: string; source: string; strategy: string | null; created_at: number; closed_at: number | null;
}

/** Envoie une synthèse quotidienne UTC (Burkina Faso = UTC) une seule fois, sans migration D1. */
export async function sendDailySummary(env: Env, now = Date.now()): Promise<void> {
  if (!tgConfigured(env)) return;
  const d = new Date(now);
  // Le cron actuel passe toutes les 2 minutes : envoyer à 20:00 UTC (tolérance jusqu’à 20:02).
  // La clé quotidienne empêche tout doublon si le cron repasse pendant cette fenêtre.
  if (d.getUTCHours() !== 20 || d.getUTCMinutes() > 2) return;
  const rates = await getFxUsdRates(env, now);
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
    "SELECT symbol, direction, entry, stop_loss, tp1, tp2, tp3, outcome, source, strategy, created_at, closed_at FROM signals WHERE user_id IS NULL AND status = 'published' AND closed_at >= ? AND closed_at < ? ORDER BY closed_at DESC"
  ).bind(start, end).all<DailyTrade>()).results;

  const counts: Record<string, number> = {};
  let fxPips = 0, fxCount = 0, goldMove = 0, goldCount = 0, cryptoMove = 0, cryptoPips = 0, cryptoCount = 0, estimatedTotalUsd = 0, estimatedUsdCount = 0;
  let grossWinUsd = 0, grossLossUsd = 0, bestPips: number | null = null, worstPips: number | null = null;
  let measuredWins = 0, measuredLosses = 0, neutral = 0;
  const closedDetails: string[] = [];
  const perSymbol = new Map<string, { n: number; wins: number; losses: number; pips: number; measured: number; priceMove: number; priceCount: number; usd: number; usdCount: number }>();
  for (const t of rows) {
    counts[t.outcome] = (counts[t.outcome] ?? 0) + 1;
    if (t.outcome === "tp1" || t.outcome === "tp2" || t.outcome === "tp3") measuredWins++;
    else if (t.outcome === "sl") measuredLosses++;
    else neutral++;
    const stats = perSymbol.get(t.symbol) ?? { n: 0, wins: 0, losses: 0, pips: 0, measured: 0, priceMove: 0, priceCount: 0, usd: 0, usdCount: 0 };
    stats.n++;
    if (t.outcome === "tp1" || t.outcome === "tp2" || t.outcome === "tp3") stats.wins++;
    if (t.outcome === "sl") stats.losses++;
    let exit: number | null = null;
    if (t.outcome === "sl") exit = t.stop_loss;
    else if (t.outcome === "tp1") exit = t.entry; // TP1 puis stop au break-even
    else if (t.outcome === "tp2") exit = t.tp1; // TP2 puis stop suiveur à TP1
    else if (t.outcome === "tp3") exit = t.tp3;
    if (exit != null && t.entry != null) {
      const move = priceMove(t.direction, t.entry, exit);
      const usd = estimatedUsd(t.symbol, move, rates, t.entry ?? undefined);
      if (usd != null) { estimatedTotalUsd += usd; estimatedUsdCount++; stats.usd += usd; stats.usdCount++; }
      const pip = pipUnit(t.symbol);
      if (FOREX.has(t.symbol) && pip) {
        const p = move / pip; fxPips += p; fxCount++; stats.pips += p; stats.measured++;
        if (usd != null) { if (usd > 0) grossWinUsd += usd; else if (usd < 0) grossLossUsd += Math.abs(usd); }
        bestPips = bestPips == null ? p : Math.max(bestPips, p); worstPips = worstPips == null ? p : Math.min(worstPips, p);
      }
      else if (t.symbol === "XAU/USD") { goldMove += move; goldCount++; stats.priceMove += move; stats.priceCount++; }
      else if (t.symbol === "BTC/USD" || t.symbol === "ETH/USD") { cryptoMove += move; cryptoCount++; cryptoPips += move; stats.pips += move; stats.measured++; stats.priceMove += move; stats.priceCount++; }
    }
    perSymbol.set(t.symbol, stats);
    const icon = t.outcome === "sl" ? "🔴" : t.outcome === "tp3" ? "🏆" : t.outcome === "tp2" ? "🟢" : "🟡";
    const label = t.outcome === "sl" ? "SL" : t.outcome === "tp3" ? "TP3" : t.outcome === "tp2" ? "TP2 puis stop suiveur" : t.outcome === "tp1" ? "TP1 / break-even" : t.outcome === "expired" ? "Expiration" : "Clôture manuelle";
    let detail = `${icon} ${esc(t.symbol)} ${esc(t.direction)} — ${label}`;
    if (exit != null && t.entry != null) {
      const move = priceMove(t.direction, t.entry, exit);
      detail += ` : <b>${formatMove(t.symbol, t.direction, t.entry, exit, rates)}</b>`;
    }
    closedDetails.push(detail);
  }
  const closed = rows.length;
  const winRate = summarizeCounts(counts).win_rate; // définition unique du site (TP1+ atteint, break-even compté gagnant)
  const lines = [
    `📊 <b>BILAN TRADING DU ${day} (UTC)</b>`, "",
    `📨 Nouveaux signaux publiés : <b>${created?.n ?? 0}</b>`,
    `🔒 Positions clôturées aujourd'hui : <b>${closed}</b>`,
    `🟢 Gagnants (TP1/TP2/TP3) : <b>${measuredWins}</b>`,
    `🔴 Perdants (SL) : <b>${measuredLosses}</b>`,
    `🟡 Neutres (expiration ou clôture manuelle) : <b>${neutral}</b>`,
    `📈 Taux de réussite* : <b>${winRate == null ? "—" : `${winRate}%`}</b>`,
    `⏳ Positions encore ouvertes : <b>${open?.n ?? 0}</b>`,
    "", "<b>📏 PERFORMANCE MESURÉE</b>",
    `💵 P/L estimé total (0,01 lot) : <b>${estimatedUsdCount ? `${signed(estimatedTotalUsd, 2)} $` : "—"}</b>`,
    `💱 Forex : <b>${fxCount ? `${signed(fxPips)} pips` : "aucun trade clôturé avec sortie mesurable"}</b>`,
    `📐 Moyenne Forex/trade : <b>${fxCount ? `${signed(fxPips / fxCount)} pips` : "—"}</b>`,
    `⚖️ Profit factor Forex (USD estimés) : <b>${grossLossUsd > 0 ? (grossWinUsd / grossLossUsd).toFixed(2) : grossWinUsd > 0 ? "∞" : "—"}</b>`,
    `🥇 Meilleur / pire trade Forex : <b>${bestPips == null ? "—" : `${signed(bestPips)} / ${signed(worstPips ?? 0)} pips`}</b>`,
    `🥇 Or : <b>${goldCount ? `${signed(goldMove, 2)} $ de mouvement cumulé (${goldCount} trade(s))` : "—"}</b>`,
    `₿ Crypto : <b>${cryptoCount ? `${signed(cryptoPips)} pips · ${signed(cryptoMove, 2)} $ de variation (${cryptoCount} trade(s))` : "—"}</b>`,
  ];
  if (closedDetails.length) {
    lines.push("", "<b>🧾 DÉTAIL DES CLÔTURES</b>", ...closedDetails.slice(0, 10));
    if (closedDetails.length > 10) lines.push(`<i>… et ${closedDetails.length - 10} autre(s) clôture(s)</i>`);
  }
  if (perSymbol.size) {
    lines.push("", "<b>🔎 DÉTAIL PAR ACTIF</b>");
    for (const [symbol, st] of [...perSymbol.entries()].sort((a, b) => b[1].n - a[1].n)) {
      const unit = pipUnit(symbol);
      const performance = unit && st.measured ? ` · ${signed(st.pips)} pips` : st.priceCount ? ` · ${signed(st.priceMove, 2)} $ de mouvement` : "";
      const usdPerformance = st.usdCount ? ` · ${signed(st.usd, 2)} $ estimés` : "";
      lines.push(`• ${esc(symbol)} : ${st.n} clôture(s), ${st.wins} gagnant(s), ${st.losses} SL${performance}${usdPerformance}`);
    }
  }
  const strategies = [...new Set(rows.map((r) => r.strategy).filter((x): x is string => !!x))];
  lines.push("", "<b>🧠 STRATÉGIES UTILISÉES</b>", strategies.length ? strategies.slice(0, 6).map((x) => `• ${esc(x.slice(0, 120))}`).join("\n") : "Aucune position clôturée aujourd'hui.");
  lines.push("", "<i>*P/L estimé sur 0,01 lot. Les pips Forex sont convertis en USD avec les cours de conversion récents (cache 5 min) ; si un cours manque, le P/L USD correspondant est affiché non estimé. XAU/USD : contrat 100 oz/lot, soit 1 once à 0,01 lot. BTC/USD utilise les caractéristiques Exness fournies : contrat 1 BTC/lot, tick 0,001 et valeur du tick 0,001 USD/lot. Ainsi, 1 $ de variation du cours = 1 pip (convention d'affichage) = 0,01 $ de P/L à 0,01 lot ; 45 pips = 0,45 $. ETH/USD n'est pas valorisé faute de spécification Exness. Les pips Forex suivent la taille standard de 100 000 unités par lot. Frais, spread et slippage non déduits. Taux calculé sur TP2/TP3 contre SL.</i>", DISCLAIMER);
  const result = await tgSend(env, lines.join("\n"));
  if (result.ok) await env.CACHE.put(key, "sent", { expirationTtl: 3 * 86400 });
  else console.error("telegram daily summary", result.errors.join(" | "));
}
