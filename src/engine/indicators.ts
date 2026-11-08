import { Candle } from "./types";

export function sma(v: number[], p: number): number[] {
  const out: number[] = new Array(v.length).fill(NaN);
  let s = 0;
  for (let i = 0; i < v.length; i++) {
    s += v[i];
    if (i >= p) s -= v[i - p];
    if (i >= p - 1) out[i] = s / p;
  }
  return out;
}

export function atr(c: Candle[], p = 14): number[] {
  const out: number[] = new Array(c.length).fill(NaN);
  if (c.length <= p) return out;
  const tr = c.map((x, i) => (i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1].c), Math.abs(x.l - c[i - 1].c))));
  let a = 0;
  for (let i = 1; i <= p; i++) a += tr[i];
  a /= p;
  out[p] = a;
  for (let i = p + 1; i < c.length; i++) { a = (a * (p - 1) + tr[i]) / p; out[i] = a; }
  return out;
}

export function rsi(v: number[], p = 14): number[] {
  const out: number[] = new Array(v.length).fill(NaN);
  if (v.length <= p) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= p; i++) { const d = v[i] - v[i - 1]; if (d >= 0) g += d; else l -= d; }
  g /= p; l /= p;
  out[p] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  for (let i = p + 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    g = (g * (p - 1) + Math.max(d, 0)) / p;
    l = (l * (p - 1) + Math.max(-d, 0)) / p;
    out[i] = l === 0 ? 100 : 100 - 100 / (1 + g / l);
  }
  return out;
}

export const lastOf = <T>(a: T[]): T => a[a.length - 1];
