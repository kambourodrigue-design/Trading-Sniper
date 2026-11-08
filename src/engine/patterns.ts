import { Candle, PatternInfo, Pivot } from "./types";

const minLow = (c: Candle[], from: number, to: number) => Math.min(...c.slice(from, to + 1).map((x) => x.l));
const maxHigh = (c: Candle[], from: number, to: number) => Math.max(...c.slice(from, to + 1).map((x) => x.h));

// Figures chartistes sur pivots : double top/bottom, tête-épaules (et inversée), triangles.
export function detectPatterns(c: Candle[], a: number[], piv: Pivot[]): PatternInfo[] {
  const n = c.length, A = a[n - 1], out: PatternInfo[] = [];
  if (!(A > 0)) return out;
  const hs = piv.filter((p) => p.isHigh).slice(-4), ls = piv.filter((p) => !p.isHigh).slice(-4);
  const closes = c.map((x) => x.c);
  const last = (k: number) => closes.slice(-k);

  // Double top / double bottom
  if (hs.length >= 2) {
    const [h1, h2] = hs.slice(-2);
    if (h2.i >= n - 60 && h2.i - h1.i >= 8 && Math.abs(h1.price - h2.price) <= 0.5 * A && maxHigh(c, h2.i, n - 1) <= h2.price + 0.3 * A) {
      const neck = minLow(c, h1.i, h2.i);
      if (Math.min(h1.price, h2.price) - neck >= 1.0 * A) out.push({ name: "Double top", dir: "SELL", confirmed: last(5).some((x) => x < neck - 0.1 * A), level: neck });
    }
  }
  if (ls.length >= 2) {
    const [l1, l2] = ls.slice(-2);
    if (l2.i >= n - 60 && l2.i - l1.i >= 8 && Math.abs(l1.price - l2.price) <= 0.5 * A && minLow(c, l2.i, n - 1) >= l2.price - 0.3 * A) {
      const neck = maxHigh(c, l1.i, l2.i);
      if (neck - Math.max(l1.price, l2.price) >= 1.0 * A) out.push({ name: "Double bottom", dir: "BUY", confirmed: last(5).some((x) => x > neck + 0.1 * A), level: neck });
    }
  }

  // Tête-épaules / inversée
  if (hs.length >= 3) {
    const [s1, hd, s2] = hs.slice(-3);
    if (s2.i >= n - 80 && hd.price > s1.price + 0.5 * A && hd.price > s2.price + 0.5 * A && Math.abs(s1.price - s2.price) <= 0.8 * A) {
      const neck = (minLow(c, s1.i, hd.i) + minLow(c, hd.i, s2.i)) / 2;
      out.push({ name: "Tête-épaules", dir: "SELL", confirmed: last(6).some((x) => x < neck - 0.1 * A), level: neck });
    }
  }
  if (ls.length >= 3) {
    const [s1, hd, s2] = ls.slice(-3);
    if (s2.i >= n - 80 && hd.price < s1.price - 0.5 * A && hd.price < s2.price - 0.5 * A && Math.abs(s1.price - s2.price) <= 0.8 * A) {
      const neck = (maxHigh(c, s1.i, hd.i) + maxHigh(c, hd.i, s2.i)) / 2;
      out.push({ name: "Tête-épaules inversée", dir: "BUY", confirmed: last(6).some((x) => x > neck + 0.1 * A), level: neck });
    }
  }

  // Triangles (pente des 2 derniers pivots de chaque côté, sur 50 bougies)
  const rh = hs.filter((p) => p.i >= n - 50), rl = ls.filter((p) => p.i >= n - 50);
  if (rh.length >= 2 && rl.length >= 2) {
    const [h1, h2] = rh.slice(-2), [l1, l2] = rl.slice(-2);
    const sH = (h2.price - h1.price) / (h2.i - h1.i), sL = (l2.price - l1.price) / (l2.i - l1.i);
    const flat = 0.03 * A;
    const upper = h2.price + sH * (n - 1 - h2.i), lower = l2.price + sL * (n - 1 - l2.i);
    const px = c[n - 1].c;
    if (upper > lower) {
      if (Math.abs(sH) <= flat && sL > flat) out.push({ name: "Triangle ascendant", dir: "BUY", confirmed: px > upper + 0.1 * A, level: upper });
      else if (Math.abs(sL) <= flat && sH < -flat) out.push({ name: "Triangle descendant", dir: "SELL", confirmed: px < lower - 0.1 * A, level: lower });
      else if (sH < -flat && sL > flat) {
        if (px > upper + 0.1 * A) out.push({ name: "Triangle symétrique", dir: "BUY", confirmed: true, level: upper });
        else if (px < lower - 0.1 * A) out.push({ name: "Triangle symétrique", dir: "SELL", confirmed: true, level: lower });
      }
    }
  }
  return out;
}
