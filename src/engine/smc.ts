import { Candle, Pivot, Sweep, Zone } from "./types";

// Fair Value Gap non comblé (imbalance à 3 bougies).
export function detectFVG(c: Candle[], a: number[], tf: string, maxAge = 80): Zone[] {
  const n = c.length, out: Zone[] = [];
  for (let i = Math.max(1, n - maxAge); i < n - 1; i++) {
    const A = a[i];
    if (!(A > 0)) continue;
    const bull = c[i + 1].l > c[i - 1].h, bear = c[i + 1].h < c[i - 1].l;
    if (!bull && !bear) continue;
    const bottom = bull ? c[i - 1].h : c[i + 1].h;
    const top = bull ? c[i + 1].l : c[i - 1].l;
    if (top - bottom < 0.2 * A) continue;
    let filled = false, touches = 0;
    for (let j = i + 2; j < n; j++) {
      if (bull) { if (c[j].l <= bottom) { filled = true; break; } if (c[j].l <= top) touches++; }
      else { if (c[j].h >= top) { filled = true; break; } if (c[j].h >= bottom) touches++; }
    }
    if (!filled) out.push({ kind: "FVG", dir: bull ? "BUY" : "SELL", top, bottom, i, t: c[i].t, touches, tf });
  }
  return out;
}

// Order Block : dernière bougie opposée avant un déplacement impulsif (>= 1.5 ATR) qui casse son extrême.
export function detectOB(c: Candle[], a: number[], tf: string, maxAge = 80): Zone[] {
  const n = c.length, out: Zone[] = [];
  for (let i = Math.max(1, n - maxAge); i < n - 3; i++) {
    const A = a[i];
    if (!(A > 0)) continue;
    const nxt = c.slice(i + 1, i + 4);
    const bear = c[i].c < c[i].o, bull = c[i].c > c[i].o;
    if (bear && !(c[i + 1].c < c[i + 1].o)) {
      const mx = Math.max(...nxt.map((x) => x.c));
      if (mx > c[i].h && mx - c[i].c >= 1.5 * A) {
        let ok = true, touches = 0;
        for (let j = i + 4; j < n; j++) { if (c[j].c < c[i].l) { ok = false; break; } if (c[j].l <= c[i].h) touches++; }
        if (ok) out.push({ kind: "OB", dir: "BUY", top: c[i].h, bottom: c[i].l, i, t: c[i].t, touches, tf });
      }
    }
    if (bull && !(c[i + 1].c > c[i + 1].o)) {
      const mn = Math.min(...nxt.map((x) => x.c));
      if (mn < c[i].l && c[i].c - mn >= 1.5 * A) {
        let ok = true, touches = 0;
        for (let j = i + 4; j < n; j++) { if (c[j].c > c[i].h) { ok = false; break; } if (c[j].h >= c[i].l) touches++; }
        if (ok) out.push({ kind: "OB", dir: "SELL", top: c[i].h, bottom: c[i].l, i, t: c[i].t, touches, tf });
      }
    }
  }
  return out;
}

// Liquidity sweep : mèche au-delà d'un pivot intact puis clôture à l'intérieur (piège).
export function detectSweeps(c: Candle[], a: number[], piv: Pivot[], recent = 10, w = 3): Sweep[] {
  const n = c.length, out: Sweep[] = [];
  for (let k = n - 1; k >= Math.max(1, n - recent); k--) {
    const A = a[k] > 0 ? a[k] : a[n - 1];
    if (!(A > 0)) continue;
    for (const p of piv) {
      if (p.i + w >= k || p.i < n - 90) continue;
      let intact = true;
      for (let j = p.i + 1; j < k; j++) { if (p.isHigh ? c[j].h > p.price : c[j].l < p.price) { intact = false; break; } }
      if (!intact) continue;
      if (p.isHigh && c[k].h > p.price + 0.05 * A && c[k].c < p.price) out.push({ dir: "SELL", level: p.price, wick: c[k].h, barsAgo: n - 1 - k });
      if (!p.isHigh && c[k].l < p.price - 0.05 * A && c[k].c > p.price) out.push({ dir: "BUY", level: p.price, wick: c[k].l, barsAgo: n - 1 - k });
    }
  }
  return out.sort((x, y) => x.barsAgo - y.barsAgo);
}

// Equal highs/lows (pools de liquidité) parmi les derniers pivots.
export function equalLevels(piv: Pivot[], atrNow: number): { highs: number[]; lows: number[] } {
  const tol = 0.15 * atrNow;
  const find = (ps: Pivot[]) => {
    const out: number[] = [];
    for (let i = 0; i < ps.length; i++) for (let j = i + 1; j < ps.length; j++)
      if (Math.abs(ps[i].price - ps[j].price) <= tol) out.push((ps[i].price + ps[j].price) / 2);
    return out;
  };
  return { highs: find(piv.filter((p) => p.isHigh).slice(-8)), lows: find(piv.filter((p) => !p.isHigh).slice(-8)) };
}

// Premium / discount du range récent (position 0 = bas, 1 = haut).
export function premiumDiscount(c: Candle[], n = 60): { hi: number; lo: number; eq: number; pos: number } {
  const seg = c.slice(-n);
  const hi = Math.max(...seg.map((x) => x.h)), lo = Math.min(...seg.map((x) => x.l));
  const price = c[c.length - 1].c;
  return { hi, lo, eq: (hi + lo) / 2, pos: hi > lo ? (price - lo) / (hi - lo) : 0.5 };
}
