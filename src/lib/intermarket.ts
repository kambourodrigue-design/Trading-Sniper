import { Candle } from "../engine/types";
import { SymbolCfg } from "../engine/config";
import { biquoteCandles } from "./prices";
import { cacheGet, cacheSet } from "./cache";

const D = 86_400_000;
export interface Inter { bias: number; text: string; ok: boolean }
export interface DollarStat { last: number; ret10: number; below50: boolean; score: number }
const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));

export function dollarStat(eurusd: Candle[]): DollarStat | null {
  if (eurusd.length < 51) return null;
  const last = eurusd[eurusd.length - 1].c, prev = eurusd[eurusd.length - 11].c;
  const sma50 = eurusd.slice(-50).reduce((a, k) => a + k.c, 0) / 50;
  const ret10 = last / prev - 1, below50 = last < sma50;
  return { last, ret10, below50, score: clamp(0.7 * clamp(-ret10 / 0.02) + 0.3 * (below50 ? 1 : -1)) };
}

const usdSensitive = new Set(["XAU/USD", "BTC/USD", "ETH/USD"]);
export function interBias(symbol: string, usd: DollarStat | null): number {
  if (!usdSensitive.has(symbol) || !usd) return 0;
  return Number(clamp(-usd.score).toFixed(2));
}

export function interText(symbol: string, usd: DollarStat | null, bias: number): string {
  if (!usd) return "INTERMARCHÉS : proxy EUR/USD D1 indisponible ; aucun biais USD appliqué.";
  const state = usd.score > 0.2 ? "USD plutôt fort" : usd.score < -0.2 ? "USD plutôt faible" : "USD neutre";
  const reading = bias > 0.25 ? "favorable à la hausse" : bias < -0.25 ? "favorable à la baisse" : "neutre";
  return `INTERMARCHÉS (proxy, non DXY officiel) : EUR/USD ${usd.last.toFixed(4)}, ${(usd.ret10 * 100).toFixed(2)} % sur 10 séances, ${usd.below50 ? "sous" : "au-dessus de"} sa MM50 ; ${state}. Lecture USD pour ${symbol} : ${reading} (biais ${bias >= 0 ? "+" : ""}${bias.toFixed(2)}). Les rendements US ne sont pas inclus dans cette version gratuite.`;
}

async function fetchDollar(_env: Env, now: number): Promise<DollarStat | null> {
  const src = { p: "biquote" as const, market: "forex", id: "EURUSD" };
  const candles = await biquoteCandles(src, "1d", now - 120 * D, now);
  return dollarStat(candles.filter((k) => k.t + D <= now));
}

export async function getIntermarket(env: Env, s: SymbolCfg, now: number): Promise<Inter> {
  try {
    let usd: DollarStat | null = null;
    const hit = await cacheGet(env, "inter:usd:v1");
    if (hit) usd = JSON.parse(hit) as DollarStat | null;
    else {
      usd = await fetchDollar(env, now);
      await cacheSet(env, "inter:usd:v1", JSON.stringify(usd), usd ? 6 * 3600 : 1800);
    }
    const bias = interBias(s.symbol, usd);
    return { bias, text: interText(s.symbol, usd, bias), ok: !!usd };
  } catch (e) {
    console.error("intermarchés", (e as Error).message);
    return { bias: 0, text: interText(s.symbol, null, 0), ok: false };
  }
}

export async function probeIntermarket(_env: Env, now = Date.now()): Promise<Array<{ provider: string; id: string; ok: boolean; detail: string }>> {
  try {
    const usd = await fetchDollar(_env, now);
    return [{ provider: "biquote", id: "EURUSD D1 (proxy USD)", ok: !!usd, detail: usd ? `EUR/USD ${usd.last.toFixed(4)}, ${(usd.ret10 * 100).toFixed(2)} % sur 10 séances` : "historique insuffisant" }];
  } catch (e) {
    return [{ provider: "biquote", id: "EURUSD D1 (proxy USD)", ok: false, detail: (e as Error).message.slice(0, 160) }];
  }
}
