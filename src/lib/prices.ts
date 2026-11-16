import { Candle } from "../engine/types";
import { SymbolCfg, Src } from "../engine/config";
import { cacheGet, cacheSet } from "./cache";

// Données de marché : LSE Data (London Strategic Edge) uniquement — API REST, clé gratuite (secret LSE_API_KEY).
// Plan gratuit : 60 appels/minute ; forex, crypto, matières premières… ; bougies M15, H1, H4 et D1 natives.
// Les données ne doivent pas être redistribuées à des tiers (voir les conditions de LSE : londonstrategicedge.com/terms).
const H = 3_600_000, D = 86_400_000;
export type Iv = "15m" | "1h" | "4h" | "1d";
const LSE_URL = "https://download.londonstrategicedge.com";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Espacement minimal entre deux appels (LSE gratuit : 60 appels/minute)
const SPACING: Record<string, number> = { lse: 1100, binance: 120, kraken: 1100, deriv: 0 };
const lastCall: Record<string, number> = {};
async function throttle(p: string): Promise<void> {
  const wait = (lastCall[p] ?? 0) + (SPACING[p] ?? 0) - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall[p] = Date.now();
}

// ---------- LSE Data ----------
// Bougies : GET /v3/export?market=…&symbol=…&data=candles&timeframe=…&from=…&to=…&format=csv (clé dans l'en-tête X-API-Key).
// Colonnes : time (UTC), open, high, low, close, volume, trades.
export function parseLseCsv(text: string): Candle[] {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const head = lines[0].split(",").map((x) => x.replace(/"/g, "").trim().toLowerCase());
  const [it, io, ih, il, ic] = ["time", "open", "high", "low", "close"].map((k) => head.indexOf(k));
  if ([it, io, ih, il, ic].some((i) => i < 0)) throw new Error(`LSE : colonnes inattendues (${lines[0].slice(0, 80)})`);
  const out: Candle[] = [];
  for (const line of lines.slice(1)) {
    const c = line.split(",").map((x) => x.replace(/"/g, "").trim());
    const t = Date.parse(`${c[it].replace(" ", "T").replace(/Z$/, "")}Z`);
    const o = +c[io], h = +c[ih], l = +c[il], cl = +c[ic];
    if (!Number.isFinite(t) || ![o, h, l, cl].every(Number.isFinite)) continue;
    out.push({ t, o, h, l, c: cl });
  }
  return out.sort((a, b) => a.t - b.t);
}
const fmtTs = (ms: number) => new Date(ms).toISOString().slice(0, 19).replace("T", " ");

export async function lseCandles(env: Env, src: Src, iv: Iv, fromMs: number, toMs: number): Promise<Candle[]> {
  if (!env.LSE_API_KEY) throw new Error("LSE_API_KEY absent");
  const daily = iv === "1d"; // D1 : dates (jours inclus) ; autres échelles : horodatages UTC (borne haute exclue)
  const qs = new URLSearchParams({
    market: src.market, symbol: src.id, data: "candles", timeframe: iv, format: "csv", adjusted: "0",
    from: daily ? fmtTs(fromMs).slice(0, 10) : fmtTs(fromMs), to: daily ? fmtTs(toMs).slice(0, 10) : fmtTs(toMs),
  });
  let last = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    await throttle("lse");
    const res = await fetch(`${LSE_URL}/v3/export?${qs}`, { headers: { "X-API-Key": env.LSE_API_KEY, Accept: "text/csv" } });
    if (res.status === 429 && attempt === 0) { await sleep(Math.min(Number(res.headers.get("Retry-After")) || 5, 20) * 1000); continue; }
    if (res.status === 202) throw new Error(`LSE ${src.id} ${iv} : export préparé en tâche (fenêtre trop large)`);
    if (!res.ok) {
      const j = (await res.json().catch(() => ({}))) as { code?: string; message?: string };
      last = `LSE ${src.market}/${src.id} ${iv} HTTP ${res.status}${j.code ? ` ${j.code}` : ""}${j.message ? ` : ${j.message}` : ""}`;
      break;
    }
    return parseLseCsv(await res.text());
  }
  throw new Error(last || `LSE ${src.market}/${src.id} ${iv} : trop d'appels (429)`);
}

// Appel JSON générique (séries macro, catalogue…).
export async function lseJson(env: Env, path: string, params: Record<string, string>): Promise<unknown> {
  if (!env.LSE_API_KEY) throw new Error("LSE_API_KEY absent");
  await throttle("lse");
  const res = await fetch(`${LSE_URL}${path}?${new URLSearchParams(params)}`, { headers: { "X-API-Key": env.LSE_API_KEY, Accept: "application/json" } });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) { const e = j as { code?: string; message?: string }; throw new Error(`LSE ${path} HTTP ${res.status}${e.code ? ` ${e.code}` : ""}${e.message ? ` : ${e.message}` : ""}`.slice(0, 200)); }
  return j;
}

// Aide au diagnostic : cherche des symboles proches dans le catalogue de LSE (utilisé quand un symbole est inconnu).
async function lseSearch(env: Env, src: Src): Promise<string> {
  const q = src.id.split("_")[0].replace(/USDT$/, "");
  try {
    await throttle("lse");
    const res = await fetch(`${LSE_URL}/v3/pairs?q=${encodeURIComponent(q)}&limit=12`, { headers: { "X-API-Key": env.LSE_API_KEY ?? "" } });
    const j = (await res.json()) as { pairs?: Array<{ folder?: string; symbol?: string }> };
    return (j.pairs ?? []).map((x) => `${x.folder}:${x.symbol}`).join(", ");
  } catch { return ""; }
}

// ---------- Binance (données publiques, sans clé) ----------
// GET /api/v3/klines : [openTime, o, h, l, c, volume, closeTime, …], 1000 bougies max par appel (pagination ci-dessous).
// data-api.binance.vision = miroir public « données de marché » (accessible depuis plus de pays) ; api.binance.com en repli.
const BINANCE_HOSTS = ["https://data-api.binance.vision", "https://api.binance.com"];
export async function binanceCandles(src: Src, iv: Iv, fromMs: number, toMs: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let start = fromMs, last = "";
  for (let page = 0; page < 200 && start < toMs; page++) {
    const qs = new URLSearchParams({ symbol: src.id, interval: iv, startTime: String(Math.floor(start)), endTime: String(Math.floor(toMs)), limit: "1000" });
    let rows: unknown[][] | null = null;
    for (const host of BINANCE_HOSTS) {
      await throttle("binance");
      try {
        const res = await fetch(`${host}/api/v3/klines?${qs}`, { headers: { Accept: "application/json" } });
        if (res.ok) { rows = (await res.json()) as unknown[][]; break; }
        last = `Binance ${src.id} ${iv} HTTP ${res.status} ${(await res.text()).slice(0, 120)}`;
      } catch (e) { last = `Binance ${src.id} ${iv} : ${(e as Error).message.slice(0, 120)}`; }
    }
    if (!rows) throw new Error(last || "Binance indisponible");
    for (const r of rows) {
      const t = Number(r[0]), o = +(r[1] as string), h = +(r[2] as string), l = +(r[3] as string), c = +(r[4] as string);
      if (Number.isFinite(t) && [o, h, l, c].every(Number.isFinite)) out.push({ t, o, h, l, c });
    }
    if (rows.length < 1000) break;
    start = Number(rows[rows.length - 1][0]) + 1;
  }
  return out.sort((a, b) => a.t - b.t);
}

// ---------- Kraken (données publiques, sans clé, BTC/USD réel) ----------
// GET /0/public/OHLC?pair=XBTUSD&interval=<minutes>&since=<s> : 720 bougies max par appel ET seules les 720 dernières bougies de chaque échelle
// sont disponibles (≈ 7,5 j en M15, 30 j en H1, 120 j en H4, 2 ans en D1) : suffisant pour le moteur live, pas pour le backtest.
const KRAKEN_IV: Record<Iv, number> = { "15m": 15, "1h": 60, "4h": 240, "1d": 1440 };
export async function krakenCandles(src: Src, iv: Iv, fromMs: number, toMs: number): Promise<Candle[]> {
  const out: Candle[] = [];
  let since = Math.floor(fromMs / 1000) - 1;
  for (let page = 0; page < 5; page++) {
    await throttle("kraken");
    const res = await fetch(`https://api.kraken.com/0/public/OHLC?${new URLSearchParams({ pair: src.id, interval: String(KRAKEN_IV[iv]), since: String(since) })}`, { headers: { Accept: "application/json" } });
    const txt = await res.text();
    let j: { error?: string[]; result?: Record<string, unknown> };
    try { j = JSON.parse(txt); } catch { throw new Error(`Kraken ${src.id} ${iv} HTTP ${res.status} ${txt.slice(0, 100)}`); }
    if (!res.ok || j.error?.length) throw new Error(`Kraken ${src.id} ${iv} HTTP ${res.status} ${(j.error ?? []).join(",").slice(0, 120)}`);
    const key = Object.keys(j.result ?? {}).find((k) => k !== "last");
    const rows = (key ? (j.result as Record<string, unknown[][]>)[key] : []) ?? [];
    for (const r of rows) {
      const t = Number(r[0]) * 1000, o = +(r[1] as string), h = +(r[2] as string), l = +(r[3] as string), c = +(r[4] as string);
      if (t <= toMs && Number.isFinite(t) && [o, h, l, c].every(Number.isFinite)) out.push({ t, o, h, l, c });
    }
    const next = Number((j.result as Record<string, unknown>)?.last);
    if (!rows.length || !Number.isFinite(next) || next <= since || next * 1000 >= toMs) break;
    since = next;
  }
  const seen = new Set<number>();
  return out.filter((k) => !seen.has(k.t) && seen.add(k.t)).sort((a, b) => a.t - b.t);
}

// ---------- Deriv (API WebSocket publique : données de marché sans jeton) ----------
// wss://ws.derivws.com/websockets/v3?app_id=… ; requête { ticks_history, style: "candles", granularity (s), start, end } → { candles: [{ epoch, open, high, low, close }] }.
// Symboles : frxXAUUSD (or), cryBTCUSD (Bitcoin), BOOM1000 / CRASH1000 / R_100… (indices synthétiques). Max 5000 bougies par requête.
// Dans un Worker, le WebSocket sortant passe par fetch() + en-tête Upgrade ; sous Node 22+ (backtest), par le WebSocket global.
const DERIV_GRAN: Record<Iv, number> = { "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };
interface DerivConn { call(req: Record<string, unknown>): Promise<{ candles?: Array<{ epoch: number; open: number; high: number; low: number; close: number }> }>; close(): void }
async function derivConnect(appId: string): Promise<DerivConn> {
  const url = `wss://ws.derivws.com/websockets/v3?app_id=${encodeURIComponent(appId)}`;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let ws: any;
  if (typeof (globalThis as { WebSocketPair?: unknown }).WebSocketPair !== "undefined") {
    const res = await fetch(url.replace("wss://", "https://"), { headers: { Upgrade: "websocket" } });
    ws = (res as unknown as { webSocket?: unknown }).webSocket;
    if (!ws) throw new Error(`Deriv : connexion WebSocket refusée (HTTP ${res.status})`);
    ws.accept();
  } else {
    const WS = (globalThis as unknown as { WebSocket?: new (u: string) => unknown }).WebSocket;
    if (!WS) throw new Error("Deriv : WebSocket indisponible (Node 22+ requis)");
    ws = new WS(url);
    await new Promise<void>((ok, ko) => { ws.addEventListener("open", () => ok()); ws.addEventListener("error", () => ko(new Error("Deriv : connexion impossible"))); });
  }
  const pending = new Map<number, { ok: (v: never) => void; ko: (e: Error) => void }>();
  let id = 0;
  ws.addEventListener("message", (ev: { data: unknown }) => {
    try {
      const j = JSON.parse(typeof ev.data === "string" ? ev.data : String(ev.data)) as { req_id?: number; error?: { code: string; message: string } };
      const p = j.req_id !== undefined ? pending.get(j.req_id) : undefined;
      if (!p) return;
      pending.delete(j.req_id as number);
      if (j.error) p.ko(new Error(`Deriv ${j.error.code} : ${j.error.message}`.slice(0, 200))); else p.ok(j as never);
    } catch { /* message non JSON : ignoré */ }
  });
  ws.addEventListener("close", () => { for (const p of pending.values()) p.ko(new Error("Deriv : connexion fermée")); pending.clear(); });
  return {
    call: (req) => new Promise((ok, ko) => {
      const rid = ++id;
      const timer = setTimeout(() => { pending.delete(rid); ko(new Error("Deriv : délai dépassé (20 s)")); }, 20_000);
      pending.set(rid, { ok: (v) => { clearTimeout(timer); ok(v); }, ko: (e) => { clearTimeout(timer); ko(e); } });
      ws.send(JSON.stringify({ ...req, req_id: rid }));
    }),
    close: () => { try { ws.close(); } catch { /* déjà fermé */ } },
  };
}

export async function derivCandles(src: Src, iv: Iv, fromMs: number, toMs: number, appId = "1089"): Promise<Candle[]> {
  const gran = DERIV_GRAN[iv], span = gran * 4500, nowS = Math.floor(Date.now() / 1000);
  const conn = await derivConnect(appId || "1089");
  const out: Candle[] = [];
  try {
    for (let a = Math.floor(fromMs / 1000); a < toMs / 1000; a += span) {
      const b = Math.min(Math.floor(toMs / 1000), a + span);
      const r = await conn.call({ ticks_history: src.id, style: "candles", granularity: gran, start: a, end: b >= nowS ? "latest" : b });
      for (const k of r.candles ?? []) {
        const t = Number(k.epoch) * 1000, o = +k.open, h = +k.high, l = +k.low, c = +k.close;
        if (Number.isFinite(t) && [o, h, l, c].every(Number.isFinite)) out.push({ t, o, h, l, c });
      }
    }
  } finally { conn.close(); }
  const seen = new Set<number>();
  return out.filter((k) => !seen.has(k.t) && seen.add(k.t)).sort((a, b) => a.t - b.t);
}

// ---------- Agrégation de bougies (utilisée par le backtest ; LSE fournit le H4 en natif) ----------
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
const usable = (env: Env, src: Src) => src.p === "binance" || src.p === "kraken" || src.p === "deriv" || (src.p === "lse" && !!env.LSE_API_KEY);

// Fenêtre demandée selon l'échelle (assez large pour les week-ends et jours fériés ; le moteur garde ensuite les dernières bougies).
const SPAN_DAYS: Record<Iv, number> = { "15m": 4, "1h": 21, "4h": 75, "1d": 420 };
async function rawSeries(env: Env, src: Src, iv: Iv, now: number, fromMs?: number): Promise<Candle[]> {
  const from = fromMs ?? now - SPAN_DAYS[iv] * D;
  return src.p === "deriv" ? derivCandles(src, iv, from, now + H, env.DERIV_APP_ID) : src.p === "kraken" ? krakenCandles(src, iv, from, now + H) : src.p === "binance" ? binanceCandles(src, iv, from, now + H) : lseCandles(env, src, iv, from, now + H);
}

async function bundleFrom(env: Env, s: SymbolCfg, src: Src, now: number, maxAgeMs?: number): Promise<Bundle> {
  const kh = `bh:${s.symbol}:${src.p}:${Math.floor(now / H)}`, kd = `bd:${s.symbol}:${src.p}:${Math.floor(now / D)}`;
  let h1: Candle[], h4: Candle[], d1: Candle[];
  const cachedH = await cacheGet(env, kh);
  if (cachedH) { const j = JSON.parse(cachedH) as { h1: string; h4: string }; h1 = dec(j.h1); h4 = dec(j.h4); }
  else {
    const raw = await rawSeries(env, src, "1h", now);
    h1 = closedOf(raw, H, now);
    h4 = closedOf(await rawSeries(env, src, "4h", now), 4 * H, now);
    h1 = h1.slice(-320); h4 = h4.slice(-260);
    const stale = maxAgeMs !== undefined && (h1.length === 0 || now - h1[h1.length - 1].t > maxAgeMs);
    if (!stale) await cacheSet(env, kh, JSON.stringify({ h1: enc(h1), h4: enc(h4) }), 2 * 3600);
  }
  const cachedD = await cacheGet(env, kd);
  if (cachedD) d1 = dec(cachedD);
  else {
    d1 = closedOf(await rawSeries(env, src, "1d", now), D, now).slice(-260);
    await cacheSet(env, kd, enc(d1), 2 * 86400);
  }
  return { h1, h4, d1, source: src.p };
}

// Première source qui répond : bougies H1, H4 et D1 clôturées.
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
    try { return await rawSeries(env, src, "15m", now, fromMs); } catch (e) { errs.push(`${src.p} : ${(e as Error).message}`); }
  }
  throw new Error(`Aucune source M15 — ${errs.join(" | ")}`);
}

// Diagnostic : teste chaque source d'un actif (utilisé par le bouton « Tester les données » de l'admin).
export async function probeSources(env: Env, s: SymbolCfg, now = Date.now()): Promise<Array<{ provider: string; id: string; ok: boolean; detail: string }>> {
  const out: Array<{ provider: string; id: string; ok: boolean; detail: string }> = [];
  for (const src of s.sources) {
    if (!usable(env, src)) { out.push({ provider: src.p, id: `${src.market}/${src.id}`, ok: false, detail: "LSE_API_KEY absent" }); continue; }
    try {
      const c = closedOf(await rawSeries(env, src, "1h", now), H, now);
      if (!c.length) throw new Error("aucune bougie");
      out.push({ provider: src.p, id: `${src.market}/${src.id}`, ok: true, detail: `${c.length} bougies H1, dernière il y a ${Math.round((now - c[c.length - 1].t) / 60000)} min` });
    } catch (e) {
      let detail = (e as Error).message.slice(0, 160);
      if (/symbol-unknown|pair-unknown|data-unavailable/.test(detail)) { const near = await lseSearch(env, src); if (near) detail += ` | symboles proches : ${near}`.slice(0, 260); }
      out.push({ provider: src.p, id: `${src.market}/${src.id}`, ok: false, detail });
    }
  }
  return out;
}

// Bougies pour le graphique du dashboard : [temps (s), ouverture, haut, bas, clôture], clôturées uniquement.
export function chartPayload(b: Bundle, tf: string): number[][] {
  const c = tf === "H4" ? b.h4.slice(-160) : tf === "D1" ? b.d1.slice(-120) : b.h1.slice(-200);
  return c.map((k) => [Math.floor(k.t / 1000), k.o, k.h, k.l, k.c]);
}
