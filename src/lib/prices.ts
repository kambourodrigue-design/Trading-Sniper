import { Candle } from "../engine/types";
import { SymbolCfg } from "../engine/config";
import { cacheGet, cacheSet } from "./cache";

// TwelveData — plan gratuit : 800 crédits/jour, 8 requêtes/minute → espacement automatique.
export const INTERVAL_MS: Record<string, number> = { "15min": 900_000, "1h": 3_600_000, "4h": 14_400_000, "1day": 86_400_000 };

let lastCall = 0;
async function throttle(): Promise<void> {
  const wait = lastCall + 7_600 - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

const parseT = (dt: string) => Date.parse(dt.length === 10 ? `${dt}T00:00:00Z` : `${dt.replace(" ", "T")}Z`);

export async function fetchSeries(env: Env, tdSymbol: string, interval: string, size: number): Promise<Candle[]> {
  await throttle();
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(tdSymbol)}&interval=${interval}&outputsize=${size}&timezone=UTC&order=ASC&apikey=${env.TWELVEDATA_API_KEY}`;
  const res = await fetch(url);
  const data = await res.json<{ values?: Array<{ datetime: string; open: string; high: string; low: string; close: string }>; message?: string }>();
  if (!data.values) throw new Error(`TwelveData ${tdSymbol} ${interval}: ${data.message ?? "réponse vide"}`);
  return data.values.map((v) => ({ t: parseT(v.datetime), o: +v.open, h: +v.high, l: +v.low, c: +v.close })).sort((a, b) => a.t - b.t);
}

// Bougies CLÔTURÉES uniquement, mises en cache jusqu'à la clôture de la bougie suivante.
// Si maxAgeMs est fourni et que la dernière bougie est trop ancienne (données pas encore publiées, marché fermé),
// le résultat n'est PAS mis en cache : le prochain passage du cron réessaie.
export async function getCandles(env: Env, s: SymbolCfg, interval: string, size: number, now: number, maxAgeMs?: number): Promise<Candle[]> {
  const ms = INTERVAL_MS[interval];
  const key = `c:${s.td}:${interval}:${Math.floor(now / ms)}`;
  const hit = await cacheGet(env, key);
  if (hit) return (JSON.parse(hit) as number[][]).map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
  const closed = (await fetchSeries(env, s.td, interval, size)).filter((k) => k.t + ms <= now);
  const stale = maxAgeMs !== undefined && (closed.length === 0 || now - closed[closed.length - 1].t > maxAgeMs);
  if (!stale) await cacheSet(env, key, JSON.stringify(closed.map((k) => [k.t, k.o, k.h, k.l, k.c])), Math.ceil((ms * 2) / 1000));
  return closed;
}
