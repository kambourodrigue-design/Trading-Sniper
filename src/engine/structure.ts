import { Candle, Pivot, Structure, StructureEvent } from "./types";

// Pivots (swing highs/lows) confirmés par `w` bougies de chaque côté, puis forcés à alterner haut/bas.
export function findPivots(c: Candle[], w = 3): Pivot[] {
  const raw: Pivot[] = [];
  for (let i = w; i < c.length - w; i++) {
    let hi = true, lo = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (c[j].h >= c[i].h) hi = false;
      if (c[j].l <= c[i].l) lo = false;
    }
    if (hi) raw.push({ i, t: c[i].t, price: c[i].h, isHigh: true });
    if (lo) raw.push({ i, t: c[i].t, price: c[i].l, isHigh: false });
  }
  const out: Pivot[] = [];
  for (const p of raw) {
    const prev = out[out.length - 1];
    if (prev && prev.isHigh === p.isHigh) {
      if ((p.isHigh && p.price > prev.price) || (!p.isHigh && p.price < prev.price)) out[out.length - 1] = p;
    } else out.push(p);
  }
  return out;
}

function trendOf(piv: Pivot[]): Structure["trend"] {
  const hs = piv.filter((p) => p.isHigh), ls = piv.filter((p) => !p.isHigh);
  if (hs.length < 2 || ls.length < 2) return "range";
  const hh = hs[hs.length - 1].price > hs[hs.length - 2].price;
  const hl = ls[ls.length - 1].price > ls[ls.length - 2].price;
  if (hh && hl) return "up";
  if (!hh && !hl) return "down";
  return "range";
}

function brokeBetween(c: Candle[], from: number, to: number, level: number, up: boolean): boolean {
  for (let j = from; j <= to; j++) if (up ? c[j].c > level : c[j].c < level) return true;
  return false;
}

// Structure de marché + dernier BOS (continuation) / CHoCH (renversement) dans les `recent` dernières bougies.
export function marketStructure(c: Candle[], piv: Pivot[], w = 3, recent = 12): Structure {
  let event: StructureEvent | null = null;
  for (let k = c.length - 1; k >= Math.max(1, c.length - recent); k--) {
    const known = piv.filter((p) => p.i + w <= k - 1);
    const prevTrend = trendOf(known);
    const ph = [...known].reverse().find((p) => p.isHigh);
    const pl = [...known].reverse().find((p) => !p.isHigh);
    if (ph && c[k].c > ph.price && !brokeBetween(c, ph.i + 1, k - 1, ph.price, true)) {
      event = { type: prevTrend === "down" ? "CHoCH" : "BOS", dir: "BUY", level: ph.price, barsAgo: c.length - 1 - k };
      break;
    }
    if (pl && c[k].c < pl.price && !brokeBetween(c, pl.i + 1, k - 1, pl.price, false)) {
      event = { type: prevTrend === "up" ? "CHoCH" : "BOS", dir: "SELL", level: pl.price, barsAgo: c.length - 1 - k };
      break;
    }
  }
  return { trend: trendOf(piv), event };
}
