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
}

export function signalMessage(s: SigInfo): string {
  const origin = s.source === "ai" ? "analyse IA indépendante" : s.source === "manual" ? "signal manuel" : "règles + validation IA";
  const head = `<b>${esc(s.direction)}</b>${s.confidence != null ? ` · confiance ${s.confidence} %` : ""}${s.rr_ratio ? ` · R/R ${esc(s.rr_ratio)}` : ""}`;
  const lines = [
    `🔮 <b>NOUVEAU SIGNAL — ${esc(s.symbol)}</b>`, head, "",
    `Entrée : <b>${n(s.entry)}</b>`, `Stop Loss : ${n(s.stop_loss)}`, `TP1 : ${n(s.tp1)} · TP2 : ${n(s.tp2)} · TP3 : ${n(s.tp3)}`,
  ];
  if (s.strategy) lines.push("", `Stratégie : ${esc(s.strategy)}`);
  if (s.reasoning) lines.push(`<i>${esc(s.reasoning.slice(0, 450))}</i>`);
  lines.push("", `Origine : ${origin}`, "", DISCLAIMER);
  return lines.join("\n");
}

// Message pour un changement de résultat ; null si rien à dire.
export function outcomeMessage(s: { symbol: string; direction: string; entry: number; tp1: number | null }, prevTp: number, r: { tp: number; outcome: string }): string | null {
  const who = `<b>${esc(s.symbol)} ${esc(s.direction)}</b>`;
  if (r.outcome === "sl") return `❌ ${who} — Stop Loss touché, trade clos.`;
  if (r.outcome === "tp3") return `🎯 ${who} — TP3 atteint, objectif complet. Trade clos.`;
  if (r.outcome === "expired") return `⏱ ${who} — expiré sans TP ni SL, trade clos (ni gagnant ni perdant).`;
  if (r.outcome.startsWith("tp")) return `↩️ ${who} — stop suiveur touché après TP${r.tp}, trade clos avec gain partiel.`;
  if (r.outcome === "open" && r.tp > prevTp) {
    const moved = r.tp === 1 ? `SL déplacé à l'entrée (${s.entry})` : `SL déplacé à TP1 (${n(s.tp1)})`;
    return `✅ ${who} — TP${r.tp} atteint. ${moved}.`;
  }
  return null;
}

export const closedMessage = (symbol: string, direction: string) => `🔒 <b>${esc(symbol)} ${esc(direction)}</b> — trade clôturé manuellement (ni gagnant ni perdant).`;
