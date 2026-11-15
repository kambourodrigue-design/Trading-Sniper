import { Candle } from "../engine/types";
import { SymbolCfg, Src } from "../engine/config";
import { cacheGet, cacheSet } from "./cache";

// Données de marché : Deriv uniquement (WebSocket public, sans clé ni compte) — bougies M15, H1, H4 et D1.
const H = 3_600_000, D = 86_400_000;
export type Iv = "15m" | "1h" | "4h" | "1d";
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Espacement minimal entre deux appels (Deriv)
const SPACING: Record<string, number> = { deriv: 250 };
const lastCall: Record<string, number> = {};
async function throttle(p: string): Promise<void> {
  const wait = (lastCall[p] ?? 0) + (SPACING[p] ?? 0) - Date.now();
  if (wait > 0) await sleep(wait);
  lastCall[p] = Date.now();
}

// ---------- Deriv (WebSocket public, aucune clé ni compte) ----------
// Requête : {ticks_history: symbole, style: "candles", granularity: secondes, start, end: "latest", count, adjust_start_time: 1}
// Réponse : {candles: [{epoch, open, high, low, close}]} (epoch = ouverture, en secondes UTC). La dernière bougie peut être en cours : le moteur ne garde que les clôturées.
// Adresse : nouvelle API publique (DERIV_WS_URL pour la changer) ; repli automatique sur l'ancienne API (app_id 1089 ou DERIV_APP_ID).
const DERIV_WS_NEW = "wss://api.derivws.com/trading/v1/options/ws/public";
const derivUrls = (env: Env) => env.DERIV_WS_URL
  ? [env.DERIV_WS_URL]
  : [DERIV_WS_NEW, `wss://ws.derivws.com/websockets/v3?app_id=${env.DERIV_APP_ID || "1089"}`];
const DERIV_GRAN: Record<Iv, number> = { "15m": 900, "1h": 3600, "4h": 14400, "1d": 86400 };

// Une requête/réponse sur une connexion WebSocket sortante (Workers : fetch + en-tête Upgrade).
async function derivCall(url: string, payload: Record<string, unknown>, timeoutMs = 9000): Promise<Record<string, unknown>> {
  const res = await fetch(url.replace(/^wss:/, "https:").replace(/^ws:/, "http:"), { headers: { Upgrade: "websocket" } });
  const ws = (res as unknown as { webSocket?: WebSocket }).webSocket;
  if (!ws) throw new Error(`connexion refusée (HTTP ${res.status})`);
  ws.accept();
  try {
    return await new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error("délai dépassé")), timeoutMs);
      ws.addEventListener("message", (ev: MessageEvent) => {
        try {
          const j = JSON.parse(String(ev.data)) as Record<string, unknown>;
          if (j.msg_type === "ping" || j.msg_type === "pong") return;
          clearTimeout(timer); resolve(j);
        } catch (e) { clearTimeout(timer); reject(e as Error); }
      });
      ws.addEventListener("error", () => { clearTimeout(timer); reject(new Error("erreur WebSocket")); });
      ws.addEventListener("close", () => { clearTimeout(timer); reject(new Error("connexion fermée avant la réponse")); });
      ws.send(JSON.stringify({ ...payload, req_id: 1 }));
    });
  } finally { try { ws.close(1000, "fin"); } catch { /* déjà fermé */ } }
}

export function parseDerivCandles(j: Record<string, unknown>): Candle[] {
  const e = j.error as { code?: string; message?: string } | undefined;
  if (e) throw new Error(`${e.code ?? "erreur"}${e.message ? ` : ${e.message}` : ""}`);
  const arr = j.candles as Array<{ epoch: number; open: number; high: number; low: number; close: number }> | undefined;
  if (!Array.isArray(arr)) throw new Error("réponse sans bougies");
  const out: Candle[] = [];
  for (const k of arr) {
    const t = Number(k.epoch) * 1000, o = Number(k.open), h = Number(k.high), l = Number(k.low), c = Number(k.close);
    if (!Number.isFinite(t) || ![o, h, l, c].every(Number.isFinite)) continue;
    out.push({ t, o, h, l, c });
  }
  return out.sort((a, b) => a.t - b.t);
}

export async function derivCandles(env: Env, src: Src, iv: Iv, fromMs: number, _toMs: number): Promise<Candle[]> {
  const payload = { ticks_history: src.id, style: "candles", granularity: DERIV_GRAN[iv], start: Math.floor(fromMs / 1000), end: "latest", count: 5000, adjust_start_time: 1 };
  const errs: string[] = [];
  for (const url of derivUrls(env)) {
    try {
      await throttle("deriv");
      return parseDerivCandles(await derivCall(url, payload));
    } catch (e) {
      const m = (e as Error).message;
      errs.push(`${new URL(url.replace(/^wss:/, "https:")).host} : ${m}`);
    }
  }
  throw new Error(`Deriv ${src.id} ${iv} — ${errs.join(" | ")}`.slice(0, 300));
}

// Aide au diagnostic : symboles proches dans le catalogue Deriv (active_symbols).
async function derivSearch(env: Env, src: Src): Promise<string> {
  const q = src.id.replace(/^(frx|cry|OTC_)/, "").toUpperCase().slice(0, 4);
  for (const url of derivUrls(env)) {
    try {
      const j = await derivCall(url, { active_symbols: "brief", product_type: "basic" });
      const list = (j.active_symbols as Array<{ symbol?: string; display_name?: string }> | undefined) ?? [];
      return list.filter((x) => `${x.symbol} ${x.display_name}`.toUpperCase().includes(q)).slice(0, 10).map((x) => `${x.symbol} (${x.display_name})`).join(", ");
    } catch { /* essai suivant */ }
  }
  return "";
}

export const sourceCandles = derivCandles;

// ---------- Agrégation de bougies (utilisée par le backtest ; Deriv fournit le H4 en natif) ----------
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
const usable = (_env: Env, src: Src) => src.p === "deriv"; // Deriv : aucune clé requise

// Fenêtre demandée selon l'échelle (assez large pour les week-ends et jours fériés ; le moteur garde ensuite les dernières bougies).
const SPAN_DAYS: Record<Iv, number> = { "15m": 4, "1h": 21, "4h": 75, "1d": 420 };
async function rawSeries(env: Env, src: Src, iv: Iv, now: number, fromMs?: number): Promise<Candle[]> {
  return sourceCandles(env, src, iv, fromMs ?? now - SPAN_DAYS[iv] * D, now + H);
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
    try {
      const c = closedOf(await rawSeries(env, src, "1h", now), H, now);
      if (!c.length) throw new Error("aucune bougie");
      out.push({ provider: src.p, id: src.id, ok: true, detail: `${c.length} bougies H1, dernière il y a ${Math.round((now - c[c.length - 1].t) / 60000)} min` });
    } catch (e) {
      let detail = (e as Error).message.slice(0, 160);
      if (/InvalidSymbol|symbol/i.test(detail)) { const near = await derivSearch(env, src); if (near) detail += ` | symboles proches : ${near}`.slice(0, 300); }
      out.push({ provider: src.p, id: src.id, ok: false, detail });
    }
  }
  return out;
}

// Bougies pour le graphique du dashboard : [temps (s), ouverture, haut, bas, clôture], clôturées uniquement.
export function chartPayload(b: Bundle, tf: string): number[][] {
  const c = tf === "H4" ? b.h4.slice(-160) : tf === "D1" ? b.d1.slice(-120) : b.h1.slice(-200);
  return c.map((k) => [Math.floor(k.t / 1000), k.o, k.h, k.l, k.c]);
}
