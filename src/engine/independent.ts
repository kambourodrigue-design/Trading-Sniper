import { CFG } from "./config";
import { Dir } from "./types";
import { roundP } from "./analyze";

export interface Levels { entry: number | null; sl: number | null; tp1: number | null; tp2: number | null; tp3: number | null }

// Garde-fous appliqués aux niveaux proposés par les IA : une IA peut se tromper de prix ou inventer des niveaux.
// L'entrée est toujours le prix actuel (ordre au marché) ; SL et TP doivent être cohérents avec l'ATR.
export function validateLevels(dir: Dir, price: number, atr: number, lv: Levels):
  { ok: boolean; reason: string; sl: number; tps: [number, number, number]; rr: string } {
  const sg = dir === "BUY" ? 1 : -1;
  const fail = (reason: string) => ({ ok: false, reason, sl: 0, tps: [0, 0, 0] as [number, number, number], rr: "" });
  if (lv.sl === null) return fail("SL manquant");
  if (lv.entry !== null && Math.abs(lv.entry - price) > 0.75 * atr) return fail("entrée trop éloignée du prix actuel (ordres limit non gérés)");
  const risk = (price - lv.sl) * sg;
  if (risk <= 0) return fail("SL du mauvais côté du prix");
  if (risk < 0.5 * atr) return fail(`SL trop serré (${(risk / atr).toFixed(2)} ATR)`);
  if (risk > CFG.maxRiskAtr * atr) return fail(`SL trop large (${(risk / atr).toFixed(2)} ATR)`);
  const tp1 = lv.tp1 ?? price + sg * risk * CFG.tpRR[0];
  const tp2 = lv.tp2 ?? price + sg * risk * CFG.tpRR[1];
  const tp3 = lv.tp3 ?? price + sg * risk * CFG.tpRR[2];
  const d1 = (tp1 - price) * sg, d2 = (tp2 - price) * sg, d3 = (tp3 - price) * sg;
  if (!(d1 > 0 && d2 > d1 && d3 > d2)) return fail("TP incohérents (doivent être croissants dans le sens du trade)");
  if (d1 < 0.8 * risk) return fail("TP1 trop proche (< 0.8R)");
  if (d2 < 1.5 * risk) return fail(`R/R insuffisant sur TP2 (${(d2 / risk).toFixed(1)})`);
  if (d3 > 10 * atr) return fail("TP3 irréaliste (> 10 ATR)");
  return { ok: true, reason: "ok", sl: roundP(lv.sl, price), tps: [roundP(tp1, price), roundP(tp2, price), roundP(tp3, price)], rr: `1:${(d2 / risk).toFixed(1)}` };
}
