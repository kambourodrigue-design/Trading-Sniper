import { Candle } from "../engine/types";
import { SymbolCfg, Src } from "../engine/config";
import { cacheGet, cacheSet } from "./cache";

// Données de marché : Yahoo Finance (sans clé, non officiel), Binance (crypto, sans clé) et TwelveData (clé facultative).
// Chaque actif a une liste de sources essayées dans l'ordre (voir engine/config.ts) : si l'une échoue (429, blocage…), la suivante prend le relais.
const H = 3_600_000, D = 86_400_000;
export type Iv = "15m" | "1h" | "1d";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

// Espacement minimal entre deux appels d'un même fournisseur (TwelveData gratuit : 8 requêtes/minute)
const SPACING: Record<string, number> = { yahoo: 1500, binance: 300, twelvedata: 7600 };
const lastCall: Record<string, number> = {};
async function throttle(p: string): Promise<void> {
  const wait = (lastCall[p] ?? 0) + (SPACING[p] ?? 0) - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall[p] = Date.now();
}

// ---------- Yahoo ----------
interface YahooJson { chart?: { result?: Array<{ timestamp?: number[]; indicators?: { quote?: Array<{ open: Array<number | null>; high: Array<number | null>; low: Array<number | null>; close: Array<number | null> }> } }>; error?: { description?: string } } }
export function parseYahoo(j: unknown): Candle[] {
  const r = (j as YahooJson)?.chart?.result?.[0];
  const q = r?.indicators?.quote?.[0];
  if (!r?.timestamp || !q) throw new Error(`Yahoo : ${(j as YahooJson)?.chart?.error?.description ?? "réponse vide"}`);
  const out: Candle[] = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    const o = q.open[i], h = q.high[i], l = q.low[i], c = q.close[i];
    if (typeof o !== "number" || typeof h !== "number" || typeof l !== "number" || typeof c !== "number") continue; // bougies vides (pauses de cotation)
    out.push({ t: r.timestamp[i] * 1000, o, h, l, c });
  }
  return out;
}
async function yahoo(id: string, iv: Iv, s: SymbolCfg, fromMs?: number, now = Date.now()): Promise<Candle[]> {
  await throttle("yahoo");
  const interval = iv === "1h" ? "60m" : iv;
  const span = fromMs !== undefined ? `period1=${Math.floor(fromMs / 1000)}&period2=${Math.floor(now / 1000) + 3600}`
    : `range=${iv === "1h" ? (s.session === "us" ? "6mo" : "60d") : iv === "1d" ? "2y" : "5d"}`;
  const res = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(id)}?interval=${interval}&${span}&includePrePost=false`, { headers: { "User-Agent": UA, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Yahoo ${id} HTTP ${res.status}`);
  return parseYahoo(await res.json());
}

// ---------- Binance (hôte « données de marché » : sans clé) ----------
export function parseBinance(rows: unknown): Candle[] {
  if (!Array.isArray(rows)) throw new Error("Binance : réponse invalide");
  return rows.map((r) => ({ t: Number(r[0]), o: +r[1], h: +r[2], l: +r[3], c: +r[4] }));
}
async function binance(id: string, iv: Iv, fromMs?: number): Promise<Candle[]> {
  await throttle("binance");
  const res = await fetch(`https://data-api.binance.vision/api/v3/klines?symbol=${id}&interval=${iv}&limit=1000${fromMs !== undefined ? `&startTime=${fromMs}` : ""}`);
  if (!res.ok) throw new Error(`Binance ${id} HTTP ${res.status}${res.status === 451 ? " (région restreinte)" : ""}`);
  return parseBinance(await res.json());
}

// ---------- TwelveData (facultatif) ----------
export async function twelveSeries(env: Env, id: string, interval: string, size: number): Promise<Candle[]> {
  await throttle("twelvedata");
  const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(id)}&interval=${interval}&outputsize=${size}&timezone=UTC&order=ASC&apikey=${env.TWELVEDATA_API_KEY ?? ""}`;
  const data = await (await fetch(url)).json<{ values?: Array<{ datetime: string; open: string; high: string; low: string; close: string }>; message?: string }>();
  if (!data.values) throw new Error(`TwelveData ${id} ${interval}: ${data.message ?? "réponse vide"}`);
  const parseT = (dt: string) => Date.parse(dt.length === 10 ? `${dt}T00:00:00Z` : `${dt.replace(" ", "T")}Z`);
  return data.values.map((v) => ({ t: parseT(v.datetime), o: +v.open, h: +v.high, l: +v.low, c: +v.close })).sort((a, b) => a.t - b.t);
}

// ---------- Agrégation H1 → H4 (Yahoo/Binance ne fournissent pas de H4 fiable) ----------
export function aggregate(h1: Candle[], ms: number, now: number): Candle[] {
  const out: Candle[] = [];
  let cur: Candle | null = null, curB = -1;
  for (const k of h1) {
    const b = Math.floor(k.t / ms);
    if (b !== curB) { if (cur) out.push(cur); cur = { t: b * ms, o: k.o, h: k.h, l: k.l, c: k.c }; curB = b; }
    else if (cur) { cur.h = Math.max(cur.h, k.h); cur.l = Math.min(cur.l, k.l); cur.c = k.c; }
  }
  if (cur) out.push(cur);
  return out.filter((k) => k.t + ms <= now);
}

export interface Bundle { h1: Candle[]; h4: Candle[]; d1: Candle[]; source: string }
const closedOf = (c: Candle[], ms: number, now: number) => c.filter((k) => k.t + ms <= now);
const enc = (c: Candle[]) => JSON.stringify(c.map((k) => [k.t, k.o, k.h, k.l, k.c]));
const dec = (s: string): Candle[] => (JSON.parse(s) as number[][]).map(([t, o, h, l, c]) => ({ t, o, h, l, c }));
const usable = (env: Env, src: Src) => src.p !== "twelvedata" || !!env.TWELVEDATA_API_KEY;

async function rawSeries(env: Env, s: SymbolCfg, src: Src, iv: Iv, fromMs?: number, now = Date.now()): Promise<Candle[]> {
  if (src.p === "yahoo") return yahoo(src.id, iv, s, fromMs, now);
  if (src.p === "binance") return binance(src.id, iv, fromMs);
  const size = iv === "15m" ? 400 : iv === "1h" ? 300 : 260;
  return twelveSeries(env, src.id, iv === "15m" ? "15min" : iv === "1h" ? "1h" : "1day", size);
}

async function bundleFrom(env: Env, s: SymbolCfg, src: Src, now: number, maxAgeMs?: number): Promise<Bundle> {
  const kh = `bh:${s.symbol}:${src.p}:${Math.floor(now / H)}`, kd = `bd:${s.symbol}:${src.p}:${Math.floor(now / D)}`;
  let h1: Candle[], h4: Candle[], d1: Candle[];
  const cachedH = await cacheGet(env, kh);
  if (cachedH) { const j = JSON.parse(cachedH) as { h1: string; h4: string }; h1 = dec(j.h1); h4 = dec(j.h4); }
  else {
    const raw = await rawSeries(env, s, src, "1h");
    h1 = closedOf(raw, H, now);
    h4 = src.p === "twelvedata" ? closedOf(await twelveSeries(env, src.id, "4h", 260), 4 * H, now) : aggregate(raw, 4 * H, now);
    h1 = h1.slice(-320); h4 = h4.slice(-260);
    const stale = maxAgeMs !== undefined && (h1.length === 0 || now - h1[h1.length - 1].t > maxAgeMs);
    if (!stale) await cacheSet(env, kh, JSON.stringify({ h1: enc(h1), h4: enc(h4) }), 2 * 3600);
  }
  const cachedD = await cacheGet(env, kd);
  if (cachedD) d1 = dec(cachedD);
  else {
    d1 = closedOf(await rawSeries(env, s, src, "1d"), D, now).slice(-260);
    await cacheSet(env, kd, enc(d1), 2 * 86400);
  }
  return { h1, h4, d1, source: src.p };
}

// Première source qui répond : bougies H1, H4 (agrégées) et D1 clôturées.
export async function getBundle(env: Env, s: SymbolCfg, now: number, maxAgeMs?: number): Promise<Bundle> {
  const errs: string[] = [];
  for (const src of s.sources) {
    if (!usable(env, src)) continue;
    try { return await bundleFrom(env, s, src, now, maxAgeMs); } catch (e) { errs.push(`${src.p} : ${(e as Error).message}`); }
  }
  throw new Error(`Aucune source de données disponible — ${errs.join(" | ")}`);
}

// Bougies M15 depuis `fromMs` (suivi des TP/SL).
export async function getM15(env: Env, s: SymbolCfg, fromMs: number, now: number): Promise<Candle[]> {
  const errs: string[] = [];
  for (const src of s.sources) {
    if (!usable(env, src)) continue;
    try { return await rawSeries(env, s, src, "15m", fromMs, now); } catch (e) { errs.push(`${src.p} : ${(e as Error).message}`); }
  }
  throw new Error(`Aucune source M15 — ${errs.join(" | ")}`);
}

// Diagnostic : teste chaque source d'un actif (utilisé par le bouton « Tester les données » de l'admin).
export async function probeSources(env: Env, s: SymbolCfg, now = Date.now()): Promise<Array<{ provider: string; id: string; ok: boolean; detail: string }>> {
  const out: Array<{ provider: string; id: string; ok: boolean; detail: string }> = [];
  for (const src of s.sources) {
    if (!usable(env, src)) { out.push({ provider: src.p, id: src.id, ok: false, detail: "clé TWELVEDATA_API_KEY absente (facultatif)" }); continue; }
    try {
      const c = closedOf(await rawSeries(env, s, src, "1h"), H, now);
      if (!c.length) throw new Error("aucune bougie");
      out.push({ provider: src.p, id: src.id, ok: true, detail: `${c.length} bougies H1, dernière il y a ${Math.round((now - c[c.length - 1].t) / 60000)} min` });
    } catch (e) { out.push({ provider: src.p, id: src.id, ok: false, detail: (e as Error).message.slice(0, 160) }); }
  }
  return out;
}
