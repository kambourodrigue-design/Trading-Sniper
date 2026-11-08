import { Candle, WyckoffInfo } from "./types";

const NONE: WyckoffInfo = { phase: "none", event: null, bias: null, top: null, bottom: null };

// Heuristique Wyckoff sur prix seul (pas de volume en forex) : range de consolidation, puis spring / upthrust / SOS / SOW.
export function detectWyckoff(c: Candle[], a: number[]): WyckoffInfo {
  const n = c.length, A = a[n - 1];
  if (!(A > 0) || n < 110) return NONE;
  for (const win of [60, 50, 40, 30]) {
    const seg = c.slice(n - win - 6, n - 6);
    const hi = Math.max(...seg.map((x) => x.h)), lo = Math.min(...seg.map((x) => x.l));
    if (hi - lo > 5 * A) continue;
    const topTouches = seg.filter((x) => x.h >= hi - 0.4 * A).length;
    const botTouches = seg.filter((x) => x.l <= lo + 0.4 * A).length;
    if (topTouches < 2 || botTouches < 2) continue;

    const prior = c[Math.max(0, n - win - 6 - 30)].c;
    const mid = (hi + lo) / 2;
    const accumulation = prior > mid; // le prix arrive d'une baisse
    const distribution = prior < mid; // le prix arrive d'une hausse
    const recent = c.slice(n - 6);

    for (const r of recent) {
      if (accumulation && r.l < lo - 0.1 * A && r.c > lo)
        return { phase: "accumulation", event: "spring", bias: "BUY", top: hi, bottom: lo };
      if (distribution && r.h > hi + 0.1 * A && r.c < hi)
        return { phase: "distribution", event: "upthrust", bias: "SELL", top: hi, bottom: lo };
    }
    const last3 = c.slice(n - 3);
    if (accumulation && last3.every((x) => x.c > hi + 0.2 * A)) return { phase: "markup", event: "SOS", bias: "BUY", top: hi, bottom: lo };
    if (distribution && last3.every((x) => x.c < lo - 0.2 * A)) return { phase: "markdown", event: "SOW", bias: "SELL", top: hi, bottom: lo };
    const inside = c[n - 1].c <= hi && c[n - 1].c >= lo;
    if (inside) return { phase: accumulation ? "accumulation" : "distribution", event: null, bias: null, top: hi, bottom: lo };
  }
  return NONE;
}
