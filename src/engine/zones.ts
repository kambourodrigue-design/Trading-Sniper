import { Candle, Zone } from "./types";

// Supply & Demand : base (1-4 petites bougies) suivie d'une impulsion franche qui la quitte. Zone fraîche = non invalidée.
export function detectSD(c: Candle[], a: number[], tf: string, maxAge = 100): Zone[] {
  const n = c.length, out: Zone[] = [];
  for (let i = Math.max(2, n - maxAge); i < n - 1; i++) {
    const A = a[i];
    if (!(A > 0)) continue;
    const body = Math.abs(c[i].c - c[i].o), range = c[i].h - c[i].l;
    if (range < 1.5 * A || body < 1.0 * A) continue;
    const up = c[i].c > c[i].o;
    let j = i - 1, len = 0;
    while (j >= 1 && len < 4 && Math.abs(c[j].c - c[j].o) <= 0.5 * A && c[j].h - c[j].l <= 1.0 * A) { j--; len++; }
    if (len === 0) continue;
    const base = c.slice(j + 1, i);
    const lo = Math.min(...base.map((x) => x.l)), hi = Math.max(...base.map((x) => x.h));
    const top = up ? Math.max(...base.map((x) => Math.max(x.o, x.c))) : hi;
    const bottom = up ? lo : Math.min(...base.map((x) => Math.min(x.o, x.c)));
    if (top - bottom > 2.5 * A || top <= bottom) continue;
    let ok = true, touches = 0;
    for (let k = i + 1; k < n; k++) {
      if (up ? c[k].c < bottom : c[k].c > top) { ok = false; break; }
      if (up ? c[k].l <= top : c[k].h >= bottom) touches++;
    }
    if (ok) out.push({ kind: "SD", dir: up ? "BUY" : "SELL", top, bottom, i, t: c[i].t, touches, tf });
  }
  return out;
}
