import { Candle } from "../engine/types";
import { SymbolCfg } from "../engine/config";
import { sourceCandles } from "./prices";
import { cacheGet, cacheSet } from "./cache";

// Couche « intermarchés » : donnée CHIFFRÉE qui complète le contexte macro qualitatif (résumés de news) lu par les IA.
//   - Dollar : proxy EUR/USD en D1 (Deriv) : variation sur 10 séances + position par rapport à la MM50.
// Un dollar en hausse pèse sur l'or, le Bitcoin, l'EUR/USD et le GBP/USD ; en baisse, il les soutient. Le biais (−1 … +1) ajuste le score du moteur
// (± 6 points au maximum) et le texte chiffré est transmis aux IA. Si la donnée manque, le biais est 0 (neutre).
const D = 86_400_000;
export interface Inter { bias: number; text: string; ok: boolean }
export interface DollarStat { last: number; ret10: number; below50: boolean; score: number } // score > 0 : dollar plus fort

const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));

export function dollarStat(eurusd: Candle[]): DollarStat | null {
  if (eurusd.length < 51) return null;
  const last = eurusd[eurusd.length - 1].c, prev = eurusd[eurusd.length - 11].c;
  const sma50 = eurusd.slice(-50).reduce((a, k) => a + k.c, 0) / 50;
  const ret10 = last / prev - 1, below50 = last < sma50;
  return { last, ret10, below50, score: clamp(0.7 * clamp(-ret10 / 0.02) + 0.3 * (below50 ? 1 : -1)) }; // EUR/USD −2 % en 10 séances = dollar nettement plus fort
}
// Poids du dollar selon l'actif. Un poids négatif inverse le sens (USD/JPY monte avec le dollar). EUR/USD est lui-même le proxy du dollar : poids 0.
// Valeurs de départ à valider par backtest ; actif absent de la liste = 0.
const WEIGHTS: Record<string, number> = { "XAU/USD": 0.6, "BTC/USD": 0.6, "EUR/USD": 0, "GBP/USD": 0.6, "USD/JPY": -0.6, "US30": 0.15, "USTEC": 0.15 };
export function interBias(symbol: string, usd: DollarStat | null): number {
  const pressure = (WEIGHTS[symbol] ?? 0) * (usd?.score ?? 0); // > 0 : vents contraires pour l'actif
  return Number(clamp(-pressure).toFixed(2));
}

export function interText(symbol: string, usd: DollarStat | null, bias: number): string {
  if (!usd) return "INTERMARCHÉS (données chiffrées) : indisponibles — n'en déduis aucune information.";
  const dollar = `Dollar (proxy EUR/USD D1) : EUR/USD ${usd.last.toFixed(4)}, ${(usd.ret10 * 100).toFixed(2)} % sur 10 séances, ${usd.below50 ? "sous" : "au-dessus de"} sa MM50 → dollar ${usd.score > 0.2 ? "en hausse" : usd.score < -0.2 ? "en baisse" : "stable"}`;
  const reading = bias > 0.25 ? "plutôt favorable aux achats" : bias < -0.25 ? "plutôt favorable aux ventes" : "neutre";
  return `INTERMARCHÉS (données mesurées) : ${dollar} | Lecture pour ${symbol} : ${reading} (biais ${bias >= 0 ? "+" : ""}${bias.toFixed(2)} sur une échelle −1…+1).`;
}

async function fetchRaw(env: Env, now: number): Promise<{ usd: DollarStat | null; err: string }> {
  try {
    const c = await sourceCandles(env, { p: "deriv", id: "frxEURUSD" }, "1d", now - 120 * D, now + D);
    const usd = dollarStat(c.filter((k) => k.t + D <= now));
    return { usd, err: usd ? "" : "EUR/USD : historique insuffisant" };
  } catch (e) { return { usd: null, err: (e as Error).message.slice(0, 160) }; }
}

// Intermarchés pour un actif (donnée brute en cache 6 h, partagée par tous les actifs ; ne lève jamais d'erreur).
export async function getIntermarket(env: Env, s: SymbolCfg, now: number): Promise<Inter> {
  try {
    let usd: DollarStat | null;
    const hit = await cacheGet(env, "inter:raw");
    if (hit) usd = (JSON.parse(hit) as { usd: DollarStat | null }).usd;
    else {
      const r = await fetchRaw(env, now);
      usd = r.usd;
      if (r.err) console.error("intermarchés", r.err);
      await cacheSet(env, "inter:raw", JSON.stringify({ usd }), usd ? 6 * 3600 : 1800);
    }
    const bias = interBias(s.symbol, usd);
    return { bias, text: interText(s.symbol, usd, bias), ok: !!usd };
  } catch (e) {
    console.error("intermarchés", (e as Error).message);
    return { bias: 0, text: interText(s.symbol, null, 0), ok: false };
  }
}

// Diagnostic pour « Tester les données » (admin).
export async function probeIntermarket(env: Env, now = Date.now()): Promise<Array<{ provider: string; id: string; ok: boolean; detail: string }>> {
  const r = await fetchRaw(env, now);
  return [{ provider: "deriv", id: "frxEURUSD (dollar)", ok: !!r.usd, detail: r.usd ? `EUR/USD ${r.usd.last.toFixed(4)}, ${(r.usd.ret10 * 100).toFixed(2)} % sur 10 séances` : r.err }];
}
