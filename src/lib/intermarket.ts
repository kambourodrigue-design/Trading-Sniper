import { Candle } from "../engine/types";
import { SymbolCfg } from "../engine/config";
import { lseCandles, lseJson } from "./prices";
import { cacheGet, cacheSet } from "./cache";

// Couche « intermarchés » : données CHIFFRÉES qui complètent le contexte macro qualitatif (résumés de news) lu par les IA.
//   - Dollar : proxy EUR/USD en D1 (variation sur 10 séances + position par rapport à la MM50) ;
//   - Taux US 10 ans (LSE Data, série « US10Y ») : variation sur 10 séances.
// Dollar et taux en hausse pèsent sur l'or et le Bitcoin ; en baisse, ils les soutiennent. Le biais (−1 … +1) ajuste le score du moteur
// (± 6 points au maximum) et le texte chiffré est transmis aux IA. Chaque donnée est indépendante : si l'une manque, l'autre suffit ;
// si les deux manquent, le biais est 0 (neutre) et le moteur fonctionne comme avant.
const D = 86_400_000;
export interface Inter { bias: number; text: string; ok: boolean }
export interface DollarStat { last: number; ret10: number; below50: boolean; score: number } // score > 0 : dollar plus fort
export interface YieldStat { last: number; chg10: number; score: number }                    // score > 0 : taux en hausse

const clamp = (x: number, lo = -1, hi = 1) => Math.max(lo, Math.min(hi, x));

export function dollarStat(eurusd: Candle[]): DollarStat | null {
  if (eurusd.length < 51) return null;
  const last = eurusd[eurusd.length - 1].c, prev = eurusd[eurusd.length - 11].c;
  const sma50 = eurusd.slice(-50).reduce((a, k) => a + k.c, 0) / 50;
  const ret10 = last / prev - 1, below50 = last < sma50;
  return { last, ret10, below50, score: clamp(0.7 * clamp(-ret10 / 0.02) + 0.3 * (below50 ? 1 : -1)) }; // EUR/USD −2 % en 10 séances = dollar nettement plus fort
}
export function yieldStat(v: number[]): YieldStat | null {
  if (v.length < 11) return null;
  const last = v[v.length - 1], chg10 = last - v[v.length - 11];
  return { last, chg10, score: clamp(chg10 / 0.25) }; // +25 points de base en 10 séances = hausse nette
}

// Poids du dollar et des taux selon l'actif (somme = 1). Un composant manquant compte pour 0 (neutre).
const WEIGHTS: Record<string, { usd: number; yld: number }> = { "XAU/USD": { usd: 0.55, yld: 0.45 }, "BTC/USD": { usd: 0.6, yld: 0.4 } };
export function interBias(symbol: string, usd: DollarStat | null, y: YieldStat | null): number {
  const w = WEIGHTS[symbol] ?? { usd: 0.5, yld: 0.5 };
  const pressure = w.usd * (usd?.score ?? 0) + w.yld * (y?.score ?? 0); // > 0 : vents contraires pour l'actif
  return Number(clamp(-pressure).toFixed(2));
}

export function interText(symbol: string, usd: DollarStat | null, y: YieldStat | null, bias: number): string {
  if (!usd && !y) return "INTERMARCHÉS (données chiffrées) : indisponibles — n'en déduis aucune information.";
  const parts: string[] = [];
  if (usd) parts.push(`Dollar (proxy EUR/USD D1) : EUR/USD ${usd.last.toFixed(4)}, ${(usd.ret10 * 100).toFixed(2)} % sur 10 séances, ${usd.below50 ? "sous" : "au-dessus de"} sa MM50 → dollar ${usd.score > 0.2 ? "en hausse" : usd.score < -0.2 ? "en baisse" : "stable"}`);
  if (y) parts.push(`Taux US 10 ans : ${y.last.toFixed(2)} %, ${y.chg10 >= 0 ? "+" : ""}${(y.chg10 * 100).toFixed(0)} pb sur 10 séances → taux ${y.score > 0.2 ? "en hausse" : y.score < -0.2 ? "en baisse" : "stables"}`);
  const reading = bias > 0.25 ? "plutôt favorable aux achats" : bias < -0.25 ? "plutôt favorable aux ventes" : "neutre";
  return `INTERMARCHÉS (données mesurées) : ${parts.join(" | ")} | Lecture pour ${symbol} : ${reading} (biais ${bias >= 0 ? "+" : ""}${bias.toFixed(2)} sur une échelle −1…+1).`;
}

// Lecture de la série de taux renvoyée par LSE (/v3/macro/series) : tolère un tableau d'objets {day, close|value} ou de paires [jour, valeur].
export function parseSeries(j: unknown): number[] {
  const o = (j ?? {}) as Record<string, unknown>;
  const arr = (Array.isArray(j) ? j : ["rows", "series", "data", "values"].map((k) => o[k]).find(Array.isArray)) as unknown[] | undefined;
  if (!arr) return [];
  const rows = arr.map((r) => {
    if (Array.isArray(r)) return { day: String(r[0]), v: Number(r[1]) };
    const x = (r ?? {}) as Record<string, unknown>;
    return { day: String(x.day ?? x.date ?? ""), v: Number(x.close ?? x.value) };
  }).filter((r) => Number.isFinite(r.v));
  return rows.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)).map((r) => r.v);
}

const dayStr = (ms: number) => new Date(ms).toISOString().slice(0, 10);
async function fetchRaw(env: Env, now: number): Promise<{ usd: DollarStat | null; y: YieldStat | null; errs: string[] }> {
  const errs: string[] = [];
  let usd: DollarStat | null = null, y: YieldStat | null = null;
  try {
    const c = await lseCandles(env, { p: "lse", market: "forex", id: "EUR_USD" }, "1d", now - 120 * D, now + D);
    usd = dollarStat(c.filter((k) => k.t + D <= now));
    if (!usd) errs.push("EUR/USD : historique insuffisant");
  } catch (e) { errs.push((e as Error).message.slice(0, 160)); }
  try {
    const j = await lseJson(env, "/v3/macro/series", { kind: "yield", code: "US10Y", from: dayStr(now - 60 * D), to: dayStr(now) });
    y = yieldStat(parseSeries(j));
    if (!y) errs.push("US10Y : historique insuffisant ou format inattendu");
  } catch (e) { errs.push((e as Error).message.slice(0, 160)); }
  return { usd, y, errs };
}

// Intermarchés pour un actif (données brutes en cache 6 h, partagées par tous les actifs ; ne lève jamais d'erreur).
export async function getIntermarket(env: Env, s: SymbolCfg, now: number): Promise<Inter> {
  try {
    let raw: { usd: DollarStat | null; y: YieldStat | null } | null = null;
    const hit = await cacheGet(env, "inter:raw");
    if (hit) raw = JSON.parse(hit) as { usd: DollarStat | null; y: YieldStat | null };
    else {
      const r = await fetchRaw(env, now);
      raw = { usd: r.usd, y: r.y };
      if (r.errs.length) console.error("intermarchés", r.errs.join(" | "));
      await cacheSet(env, "inter:raw", JSON.stringify(raw), raw.usd || raw.y ? 6 * 3600 : 1800);
    }
    const bias = interBias(s.symbol, raw.usd, raw.y);
    return { bias, text: interText(s.symbol, raw.usd, raw.y, bias), ok: !!(raw.usd || raw.y) };
  } catch (e) {
    console.error("intermarchés", (e as Error).message);
    return { bias: 0, text: interText(s.symbol, null, null, 0), ok: false };
  }
}

// Diagnostic pour « Tester les données » (admin).
export async function probeIntermarket(env: Env, now = Date.now()): Promise<Array<{ provider: string; id: string; ok: boolean; detail: string }>> {
  if (!env.LSE_API_KEY) return [{ provider: "lse", id: "intermarchés", ok: false, detail: "LSE_API_KEY absent" }];
  const r = await fetchRaw(env, now);
  const miss = (k: string) => r.errs.find((e) => e.includes(k)) ?? "indisponible";
  return [
    { provider: "lse", id: "forex/EUR_USD (dollar)", ok: !!r.usd, detail: r.usd ? `EUR/USD ${r.usd.last.toFixed(4)}, ${(r.usd.ret10 * 100).toFixed(2)} % sur 10 séances` : miss("EUR") },
    { provider: "lse", id: "macro/US10Y (taux 10 ans)", ok: !!r.y, detail: r.y ? `${r.y.last.toFixed(2)} %, ${(r.y.chg10 * 100).toFixed(0)} pb sur 10 séances` : miss("macro") },
  ];
}
