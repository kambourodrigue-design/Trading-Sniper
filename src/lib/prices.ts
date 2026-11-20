import { Candle } from "../engine/types";
import { SymbolCfg, Src } from "../engine/config";
import { cacheGet, cacheSet } from "./cache";

const H = 3_600_000, D = 86_400_000;
export type Iv = "15m" | "1h" | "4h" | "1d";
const BIQUOTE_URL = "https://biquote.io";
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const SPACING: Record<string, number> = { biquote: 250, binance: 150, kraken: 1_100 };
const lastCall: Record<string, number> = {};
const cooldownUntil: Record<string, number> = {};
function assertProviderReady(provider: string): void {
  const until = cooldownUntil[provider] ?? 0;
  if (until > Date.now()) throw new Error(`${provider} en temporisation après erreur précédente (${Math.ceil((until - Date.now()) / 1000)} s)`);
}
function noteProviderFailure(provider: string, error: unknown): void {
  const msg = String((error as Error)?.message ?? error);
  const ms = /HTTP 451/.test(msg) ? 6 * 3600_000 : /HTTP 429/.test(msg) ? 60_000 : /HTTP 5\d\d/.test(msg) ? 30_000 : 0;
  if (ms) cooldownUntil[provider] = Date.now() + ms;
}

async function throttle(provider: string): Promise<void> {
  assertProviderReady(provider);
  const wait = (lastCall[provider] ?? 0) + (SPACING[provider] ?? 0) - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall[provider] = Date.now();
}

async function readJson(url: string, provider: string): Promise<any> {
  await throttle(provider);
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${provider} HTTP ${res.status}: ${JSON.stringify(body).slice(0, 180)}`);
  if (body && (body.status === "error" || body.code === 400 || body.code === 401 || body.code === 429)) {
    throw new Error(`${provider}: ${(body.message ?? JSON.stringify(body)).toString().slice(0, 180)}`);
  }
  return body;
}

function parseIso(value: unknown): number {
  const raw = String(value ?? "");
  if (!raw) return NaN;
  return Date.parse(raw.includes("T") ? raw : `${raw.replace(" ", "T")}Z`);
}

function toCandleRows(rows: any[], timeField: string): Candle[] {
  const out: Candle[] = [];
  for (const row of rows ?? []) {
    if (row?.isOpen === true) continue;
    const t = parseIso(row?.[timeField]);
    const o = Number(row?.open), h = Number(row?.high), l = Number(row?.low), c = Number(row?.close);
    if (Number.isFinite(t) && [o, h, l, c].every(Number.isFinite) && h >= l && h >= Math.max(o, c) && l <= Math.min(o, c)) out.push({ t, o, h, l, c });
  }
  const seen = new Set<number>();
  return out.filter((bar) => !seen.has(bar.t) && seen.add(bar.t)).sort((a, b) => a.t - b.t);
}

// biquote est le fournisseur de prix principal sans clé. Les séries sont glissantes : H1 168, H4 180, D1 500 barres max.
export async function biquoteCandles(src: Src, iv: Iv, fromMs?: number, toMs?: number): Promise<Candle[]> {
  const maxBars: Record<Iv, number> = { "15m": 192, "1h": 168, "4h": 180, "1d": 500 };
  const qs = new URLSearchParams({ interval: iv, limit: String(maxBars[iv]) });
  if (fromMs !== undefined) qs.set("from", new Date(fromMs).toISOString());
  if (toMs !== undefined) qs.set("to", new Date(toMs).toISOString());
  const url = `${BIQUOTE_URL}/api/${encodeURIComponent(src.id)}/ohlc?${qs}`;
  const body = await readJson(url, "biquote");
  if (!Array.isArray(body?.bars)) throw new Error(`biquote ${src.id}: réponse OHLC sans tableau bars`);
  return toCandleRows(body.bars, "openTime").filter((bar) => (fromMs === undefined || bar.t >= fromMs) && (toMs === undefined || bar.t <= toMs));
}

const BINANCE_HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];
export async function binanceCandles(src: Src, iv: Iv, fromMs: number, toMs: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let start = fromMs, last = "";
  for (let page = 0; page < 20 && start < toMs; page++) {
    const qs = new URLSearchParams({ symbol: src.id, interval: iv, startTime: String(Math.floor(start)), endTime: String(Math.floor(toMs)), limit: "1000" });
    let rows: unknown[][] | null = null;
    for (const host of BINANCE_HOSTS) {
      await throttle("binance");
      try {
        const res = await fetch(`${host}/api/v3/klines?${qs}`, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
        if (res.ok) { rows = await res.json() as unknown[][]; break; }
        last = `Binance ${src.id} ${iv} HTTP ${res.status}`;
      } catch (error) { last = `Binance : ${(error as Error).message.slice(0, 100)}`; }
    }
    if (!rows) throw new Error(last || "Binance indisponible");
    for (const row of rows) {
      const t = Number(row[0]), o = Number(row[1]), h = Number(row[2]), l = Number(row[3]), c = Number(row[4]);
      if (Number.isFinite(t) && [o, h, l, c].every(Number.isFinite)) out.push({ t, o, h, l, c });
    }
    if (rows.length < 1000) break;
    start = Number(rows[rows.length - 1][0]) + 1;
  }
  return out.filter((bar) => bar.t <= toMs).sort((a, b) => a.t - b.t);
}

const KRAKEN_IV: Record<Iv, number> = { "15m": 15, "1h": 60, "4h": 240, "1d": 1440 };
export async function krakenCandles(src: Src, iv: Iv, fromMs: number, toMs: number): Promise<Candle[]> {
  const qs = new URLSearchParams({ pair: src.id, interval: String(KRAKEN_IV[iv]), since: String(Math.max(0, Math.floor(fromMs / 1000) - 1)) });
  const body = await readJson(`https://api.kraken.com/0/public/OHLC?${qs}`, "kraken");
  if (Array.isArray(body.error) && body.error.length) throw new Error(`Kraken : ${body.error.join(", ")}`);
  const key = Object.keys(body.result ?? {}).find((name) => name !== "last");
  const rows = key ? body.result[key] as unknown[][] : [];
  return rows.map((row) => ({ t: Number(row[0]) * 1000, o: Number(row[1]), h: Number(row[2]), l: Number(row[3]), c: Number(row[4]) }))
    .filter((bar) => bar.t <= toMs && Number.isFinite(bar.t) && [bar.o, bar.h, bar.l, bar.c].every(Number.isFinite)).sort((a, b) => a.t - b.t);
}

export function aggregate(h1: Candle[], ms: number, now: number): Candle[] {
  const out: Candle[] = [];
  let current: Candle | null = null, bucket = -1;
  for (const bar of h1) {
    const nextBucket = Math.floor(bar.t / ms);
    if (nextBucket !== bucket) { if (current) out.push(current); current = { t: nextBucket * ms, o: bar.o, h: bar.h, l: bar.l, c: bar.c }; bucket = nextBucket; }
    else if (current) { current.h = Math.max(current.h, bar.h); current.l = Math.min(current.l, bar.l); current.c = bar.c; }
  }
  if (current) out.push(current);
  return out.filter((bar) => bar.t + ms <= now);
}

export interface Bundle { h1: Candle[]; h4: Candle[]; d1: Candle[]; source: string }
const closedOf = (bars: Candle[], duration: number, now: number) => bars.filter((bar) => bar.t + duration <= now);
const encode = (bars: Candle[]) => JSON.stringify(bars.map((bar) => [bar.t, bar.o, bar.h, bar.l, bar.c]));
const decode = (raw: string): Candle[] => (JSON.parse(raw) as number[][]).map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
const HORIZON: Record<Iv, number> = { "15m": 3, "1h": 21, "4h": 75, "1d": 420 };

async function rawSeries(src: Src, iv: Iv, now: number, fromMs?: number): Promise<Candle[]> {
  const from = fromMs ?? now - HORIZON[iv] * D;
  if (src.p === "biquote") return biquoteCandles(src, iv, from, now + H);
  if (src.p === "kraken") return krakenCandles(src, iv, from, now + H);
  return binanceCandles(src, iv, from, now + H);
}

async function bundleFrom(env: Env, symbol: SymbolCfg, src: Src, now: number): Promise<Bundle> {
  const hourKey = `market:v2:h1h4:${symbol.symbol}:${src.p}:${Math.floor(now / H)}`;
  const dayKey = `market:v2:d1:${symbol.symbol}:${src.p}:${Math.floor(now / D)}`;
  let h1: Candle[], h4: Candle[], d1: Candle[];
  const cachedH = await cacheGet(env, hourKey);
  if (cachedH) { const data = JSON.parse(cachedH) as { h1: string; h4: string }; h1 = decode(data.h1); h4 = decode(data.h4); }
  else {
    h1 = closedOf(await rawSeries(src, "1h", now), H, now).slice(-168);
    h4 = closedOf(await rawSeries(src, "4h", now), 4 * H, now).slice(-180);
    if (h1.length < 105 || h4.length < 105) throw new Error(`historique insuffisant pour MM100 (H1 ${h1.length}/105, H4 ${h4.length}/105)`);
    await cacheSet(env, hourKey, JSON.stringify({ h1: encode(h1), h4: encode(h4) }), 2 * 3600);
  }
  const cachedD = await cacheGet(env, dayKey);
  if (cachedD) d1 = decode(cachedD);
  else {
    d1 = closedOf(await rawSeries(src, "1d", now), D, now).slice(-260);
    if (d1.length < 205) throw new Error(`historique D1 insuffisant pour MM200 (${d1.length}/205)`);
    await cacheSet(env, dayKey, encode(d1), 2 * 86400);
  }
  return { h1, h4, d1, source: src.p };
}

export async function getBundle(env: Env, symbol: SymbolCfg, now: number, maxAgeMs?: number): Promise<Bundle> {
  const errors: string[] = [];
  for (const src of symbol.sources) {
    try {
      const bundle = await bundleFrom(env, symbol, src, now);
      const last = bundle.h1[bundle.h1.length - 1]?.t ?? 0;
      if (maxAgeMs !== undefined && (!last || now - last > maxAgeMs)) throw new Error("dernière bougie H1 trop ancienne");
      return bundle;
    } catch (error) { noteProviderFailure(src.p, error); errors.push(`${src.p}/${src.id}: ${(error as Error).message}`); }
  }
  throw new Error(`Aucune source ne fournit assez de données : ${errors.join(" | ")}`);
}

// Utilise M15 pour les trades récents ; H1 pour les positions plus anciennes, car le flux biquote M15 est limité à 192 barres.
export async function getOutcomeCandles(env: Env, symbol: SymbolCfg, fromMs: number, now: number): Promise<{ candles: Candle[]; candleMs: number }> {
  const useM15 = fromMs >= now - 46 * H;
  const iv: Iv = useM15 ? "15m" : "1h";
  const duration = useM15 ? 15 * 60_000 : H;
  const errors: string[] = [];
  for (const src of symbol.sources) {
    try {
      const bars = closedOf(await rawSeries(src, iv, now, fromMs), duration, now);
      if (!bars.length) throw new Error(`aucune bougie ${iv} clôturée`);
      return { candles: bars, candleMs: duration };
    } catch (error) { noteProviderFailure(src.p, error); errors.push(`${src.p}: ${(error as Error).message}`); }
  }
  throw new Error(`Données de suivi indisponibles : ${errors.join(" | ")}`);
}

export async function probeSources(_env: Env, symbol: SymbolCfg, now = Date.now()): Promise<Array<{ provider: string; id: string; ok: boolean; detail: string }>> {
  const out: Array<{ provider: string; id: string; ok: boolean; detail: string }> = [];
  for (const src of symbol.sources) {
    try {
      const bars = closedOf(await rawSeries(src, "1h", now), H, now);
      if (!bars.length) throw new Error("aucune bougie H1 clôturée");
      const required = src.p === "biquote" ? 105 : 105;
      out.push({ provider: src.p, id: src.id, ok: true, detail: `${bars.length} bougies H1 ; dernière clôture il y a ${Math.round((now - bars[bars.length - 1].t) / 60_000)} min${bars.length < required ? ` ; historique insuffisant pour MM100 (${required} requis)` : ""}` });
    } catch (error) { noteProviderFailure(src.p, error); out.push({ provider: src.p, id: src.id, ok: false, detail: (error as Error).message.slice(0, 180) }); }
  }
  return out;
}

export function chartPayload(bundle: Bundle, timeframe: string): number[][] {
  const bars = timeframe === "H4" ? bundle.h4.slice(-160) : timeframe === "D1" ? bundle.d1.slice(-120) : bundle.h1.slice(-160);
  return bars.map((bar) => [Math.floor(bar.t / 1000), bar.o, bar.h, bar.l, bar.c]);
}
