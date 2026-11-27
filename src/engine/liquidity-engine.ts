import type { Candle, Dir, Pivot } from "./types";
import type { SymbolCfg } from "./config";
import { getKillzone } from "./ictcrt";
import { detectRangeSetup } from "./range-engine";

export interface LiquiditySetup {
  dir: Dir;
  score: number;
  entry: number;
  sl: number;
  tps: [number, number, number];
  strategy: string;
  reasons: string[];
  passed: boolean;
  rejection: string;
}

type Bias = Dir | "NEUTRAL";

function atr(c: Candle[], period = 14): number {
  if (c.length < period + 1) return 0;
  const tr = c.map((x, i) => i === 0 ? x.h - x.l : Math.max(x.h - x.l, Math.abs(x.h - c[i - 1].c), Math.abs(x.l - c[i - 1].c)));
  let v = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  for (let i = period + 1; i < tr.length; i++) v = (v * (period - 1) + tr[i]) / period;
  return v;
}

function smaClose(c: Candle[], period: number): number {
  if (c.length < period) return NaN;
  return c.slice(-period).reduce((sum, x) => sum + x.c, 0) / period;
}

function pivots(c: Candle[], w = 2): Pivot[] {
  const out: Pivot[] = [];
  for (let i = w; i < c.length - w; i++) {
    let high = true, low = true;
    for (let j = i - w; j <= i + w; j++) {
      if (j === i) continue;
      if (c[j].h >= c[i].h) high = false;
      if (c[j].l <= c[i].l) low = false;
    }
    if (high) out.push({ i, t: c[i].t, price: c[i].h, isHigh: true });
    if (low) out.push({ i, t: c[i].t, price: c[i].l, isHigh: false });
  }
  return out.sort((a, b) => a.i - b.i);
}

function structureBias(c: Candle[]): Bias {
  const p = pivots(c, 3);
  const highs = p.filter(x => x.isHigh), lows = p.filter(x => !x.isHigh);
  if (highs.length < 2 || lows.length < 2) return "NEUTRAL";
  const up = highs[highs.length - 1].price > highs[highs.length - 2].price && lows[lows.length - 1].price > lows[lows.length - 2].price;
  const down = highs[highs.length - 1].price < highs[highs.length - 2].price && lows[lows.length - 1].price < lows[lows.length - 2].price;
  const close = c[c.length - 1].c, ma = smaClose(c, 50);
  if (up && close > ma) return "BUY";
  if (down && close < ma) return "SELL";
  return "NEUTRAL";
}

function htfBias(h4: Candle[], d1: Candle[]): Bias {
  const a = structureBias(h4), b = structureBias(d1);
  if (a !== "NEUTRAL" && b !== "NEUTRAL") return a === b ? a : "NEUTRAL";
  return a !== "NEUTRAL" ? a : b;
}

function latestSweep(c: Candle[], p: Pivot[], a: number): { dir: Dir; level: number; wick: number; index: number } | null {
  const start = Math.max(1, c.length - 8);
  for (let k = c.length - 1; k >= start; k--) {
    const known = p.filter(x => x.i + 2 <= k && x.i < k - 1);
    const highs = known.filter(x => x.isHigh);
    const lows = known.filter(x => !x.isHigh);
    const high = highs[highs.length - 1], low = lows[lows.length - 1];
    const lowIntact = low && !c.slice(low.i + 1, k).some(x => x.l < low.price);
    const highIntact = high && !c.slice(high.i + 1, k).some(x => x.h > high.price);
    if (low && lowIntact && c[k].l < low.price - 0.04 * a && c[k].c > low.price) {
      return { dir: "BUY", level: low.price, wick: c[k].l, index: k };
    }
    if (high && highIntact && c[k].h > high.price + 0.04 * a && c[k].c < high.price) {
      return { dir: "SELL", level: high.price, wick: c[k].h, index: k };
    }
  }
  return null;
}

function mssAfterSweep(c: Candle[], p: Pivot[], sweep: { dir: Dir; index: number }): { ok: boolean; level: number | null } {
  const dir = sweep.dir;
  for (let k = c.length - 1; k > sweep.index && k >= c.length - 6; k--) {
    const known = p.filter(x => x.i + 2 <= k - 1 && x.i > sweep.index && x.i < k);
    const opposing = known.filter(x => dir === "BUY" ? x.isHigh : !x.isHigh);
    const level = opposing[opposing.length - 1];
    if (!level) continue;
    const body = Math.abs(c[k].c - c[k].o);
    const avgRange = c.slice(Math.max(0, k - 10), k).reduce((s, x) => s + (x.h - x.l), 0) / Math.max(1, Math.min(10, k));
    const broke = dir === "BUY" ? c[k].c > level.price : c[k].c < level.price;
    if (broke && body >= 0.35 * avgRange) return { ok: true, level: level.price };
  }
  return { ok: false, level: null };
}

function displacement(c: Candle[], dir: Dir, after: number, a: number): boolean {
  for (let k = c.length - 1; k >= Math.max(after + 1, c.length - 3); k--) {
    const x = c[k], range = x.h - x.l, body = Math.abs(x.c - x.o);
    if (!(range > 0) || body < 0.60 * a || body / range < 0.62) continue;
    const aligned = dir === "BUY" ? x.c > x.o && (x.h - x.c) / range <= 0.22 : x.c < x.o && (x.c - x.l) / range <= 0.22;
    if (aligned) return true;
  }
  return false;
}

function fvgRetest(c: Candle[], dir: Dir, after: number, price: number, a: number): { ok: boolean; top: number; bottom: number } | null {
  for (let i = c.length - 2; i >= Math.max(2, c.length - 14); i--) {
    if (i < after) continue;
    const bull = dir === "BUY" && c[i + 1].l > c[i - 1].h;
    const bear = dir === "SELL" && c[i + 1].h < c[i - 1].l;
    if (!bull && !bear) continue;
    const bottom = bull ? c[i - 1].h : c[i + 1].h;
    const top = bull ? c[i + 1].l : c[i - 1].l;
    if (top - bottom < 0.12 * a) continue;
    const touched = price >= bottom - 0.20 * a && price <= top + 0.20 * a;
    if (touched) return { ok: true, top, bottom };
  }
  return null;
}

function roundLevel(price: number, atrH1: number): { level: number; step: number; near: boolean } {
  // Pas adaptatif à la volatilité et à l'ordre de grandeur : même règle pour FX, métaux et crypto.
  const step = Math.max(atrH1 * 2, Math.abs(price) * 0.005);
  const level = Math.round(price / step) * step;
  return { level, step, near: Math.abs(price - level) <= Math.max(atrH1 * 0.20, step * 0.12) };
}

function fmt(n: number, price: number): string {
  const digits = Math.abs(price) >= 1000 ? 2 : Math.abs(price) >= 10 ? 3 : 5;
  return n.toFixed(digits);
}

export function detectLiquiditySetup(
  cfg: SymbolCfg,
  m15: Candle[],
  h1: Candle[],
  h4: Candle[],
  d1: Candle[],
  now: number,
  context: { newsBlocked: boolean; marketOpen: boolean; hasOpen: boolean }
): LiquiditySetup {
  const price = m15[m15.length - 1]?.c ?? h1[h1.length - 1]?.c ?? 0;
  const fail = (dir: Dir, score: number, reasons: string[], rejection: string): LiquiditySetup => ({
    dir, score, entry: price, sl: 0, tps: [0, 0, 0], strategy: "V2 Liquidity Intelligence",
    reasons, passed: false, rejection
  });
  if (m15.length < 50 || h1.length < 60 || h4.length < 60 || d1.length < 60) {
    return fail("BUY", 0, [], "Historique insuffisant (M15/H1/H4/D1).");
  }
  const a15 = atr(m15), aH1 = atr(h1);
  if (!(a15 > 0) || !(aH1 > 0) || !(price > 0)) return fail("BUY", 0, [], "ATR ou prix invalide.");

  // Le régime de range est évalué avant le détecteur trend/sweep.
  // Si un range est confirmé, V2 utilise exclusivement ses règles range/fakeout/breakout.
  const rangeSetup = detectRangeSetup(cfg, m15, h1, now, context);
  if (rangeSetup) return rangeSetup;

  const bias = htfBias(h4, d1);
  const p15 = pivots(m15, 2);
  const sweep = latestSweep(m15, p15, a15);
  if (!sweep) return fail(bias === "SELL" ? "SELL" : "BUY", 0, ["Aucun sweep récent confirmé."], "Sweep de liquidité absent.");
  const dir = sweep.dir;
  const reasons: string[] = [];
  let score = 0;

  if (bias === dir) { score += 15; reasons.push(`Biais H4/D1 aligné ${dir}`); }
  else if (bias === "NEUTRAL") { score += 7; reasons.push("Biais HTF neutre : setup de retournement surveillé"); }
  else reasons.push(`Biais HTF opposé (${bias})`);

  score += 20;
  reasons.push(`Sweep ${dir === "BUY" ? "SSL / creux" : "BSL / sommets"} à ${fmt(sweep.level, price)} ; mèche ${fmt(sweep.wick, price)} et clôture de réintégration`);

  const mss = mssAfterSweep(m15, p15, sweep);
  if (mss.ok) { score += 15; reasons.push(`MSS confirmé après le sweep au niveau ${fmt(mss.level!, price)}`); }
  const disp = displacement(m15, dir, sweep.index, a15);
  if (disp) { score += 15; reasons.push("Displacement M15 : corps impulsif et clôture proche de l'extrême"); }

  const fvg = fvgRetest(m15, dir, sweep.index, price, a15);
  if (fvg) { score += 15; reasons.push(`Retour dans FVG ${dir} ${fmt(fvg.bottom, price)}–${fmt(fvg.top, price)}`); }

  const range = h1.slice(-48);
  const hi = Math.max(...range.map(x => x.h)), lo = Math.min(...range.map(x => x.l));
  const pos = hi > lo ? (price - lo) / (hi - lo) : 0.5;
  const pdOk = dir === "BUY" ? pos <= 0.5 : pos >= 0.5;
  if (pdOk) { score += 5; reasons.push(`${dir === "BUY" ? "Discount" : "Premium"} du dealing range H1 (${Math.round(pos * 100)} %)`); }

  const kz = getKillzone(now);
  const sessionOk = cfg.session === "crypto" ? kz.active : kz.active;
  if (sessionOk) { score += 5; reasons.push(`Fenêtre de liquidité ${kz.name} active`); }

  const rn = roundLevel(price, aH1);
  if (rn.near) { score += 5; reasons.push(`Confluence chiffre psychologique ${fmt(rn.level, price)} (pas ${fmt(rn.step, price)})`); }

  // SL derrière l'extrême du sweep, avec marge de volatilité.
  const sl = dir === "BUY" ? sweep.wick - 0.20 * a15 : sweep.wick + 0.20 * a15;
  const risk = Math.abs(price - sl);
  const riskAtr = risk / a15;
  if (riskAtr >= 0.40 && riskAtr <= 2.50) reasons.push(`Risque maîtrisé : ${riskAtr.toFixed(2)} ATR M15`);
  else return fail(dir, score, reasons, `Distance SL invalide (${riskAtr.toFixed(2)} ATR M15).`);

  const sg = dir === "BUY" ? 1 : -1;
  const obstacles: number[] = [];
  for (const p of [...p15, ...pivots(h1, 3)]) {
    if (dir === "BUY" ? p.isHigh && p.price > price : !p.isHigh && p.price < price) obstacles.push(p.price);
  }
  const nearest = obstacles.length ? (dir === "BUY" ? Math.min(...obstacles) : Math.max(...obstacles)) : null;
  const roomR = nearest === null ? Infinity : Math.abs(nearest - price) / risk;
  if (roomR >= 2) { score += 5; reasons.push(nearest === null ? "Aucun obstacle structurel proche" : `Espace libre jusqu'à ${fmt(nearest, price)} (${roomR.toFixed(1)}R)`); }
  else reasons.push(`Liquidité opposée trop proche (${roomR.toFixed(1)}R)`);

  const gates = [
    { ok: mss.ok, label: "MSS après sweep" },
    { ok: disp, label: "Displacement M15" },
    { ok: !!fvg, label: "FVG retest" },
    { ok: riskAtr >= 0.40 && riskAtr <= 2.50, label: "SL/risque" },
    { ok: roomR >= 2, label: "espace libre ≥ 2R" },
    { ok: !context.newsBlocked, label: "actualité" },
    { ok: context.marketOpen, label: "marché ouvert" },
    { ok: !context.hasOpen, label: "aucun shadow trade ouvert" },
    { ok: bias !== (dir === "BUY" ? "SELL" : "BUY"), label: "biais HTF non contradictoire" },
    { ok: score >= 75, label: "score ≥ 75/100" },
  ];
  if (context.newsBlocked) reasons.push("Entrée suspendue : fenêtre de news à fort impact.");
  if (!context.marketOpen) reasons.push("Marché fermé.");
  if (context.hasOpen) reasons.push("Un trade virtuel V2 est déjà ouvert sur cet actif.");
  const rejection = gates.filter(g => !g.ok).map(g => g.label).join(", ");
  const tps = [1.5, 2.5, 4].map(r => Number((price + sg * risk * r).toFixed(Math.abs(price) >= 1000 ? 2 : Math.abs(price) >= 10 ? 3 : 5))) as [number, number, number];
  return {
    dir, score: Math.min(100, score), entry: price, sl: Number(sl.toFixed(Math.abs(price) >= 1000 ? 2 : Math.abs(price) >= 10 ? 3 : 5)),
    tps, strategy: "Liquidity Sweep + MSS + Displacement + FVG Retest",
    reasons, passed: gates.every(g => g.ok), rejection: rejection || "Setup V2 validé."
  };
}
