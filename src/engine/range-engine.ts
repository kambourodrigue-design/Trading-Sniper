import type { Candle, Dir } from "./types";
import type { SymbolCfg } from "./config";
import { getAsianRange, getKillzone, sweptAsianRange } from "./ictcrt";

export interface RangeContext {
  newsBlocked: boolean;
  marketOpen: boolean;
  hasOpen: boolean;
}

export interface RangeSetup {
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

type Regime = "range" | "breakout" | "fakeout";

interface RangeBounds {
  high: number;
  low: number;
  atr: number;
  widthAtr: number;
  highTouches: number;
  lowTouches: number;
  compressed: boolean;
}

function atr(candles: Candle[], period = 14): number {
  if (candles.length < period + 1) return 0;
  const tr = candles.map((x, i) => i === 0 ? x.h - x.l :
    Math.max(x.h - x.l, Math.abs(x.h - candles[i - 1].c), Math.abs(x.l - candles[i - 1].c)));
  let value = tr.slice(1, period + 1).reduce((a, b) => a + b, 0) / period;
  for (let i = period + 1; i < tr.length; i++) value = (value * (period - 1) + tr[i]) / period;
  return value;
}

function meanRange(candles: Candle[]): number {
  return candles.length ? candles.reduce((sum, x) => sum + x.h - x.l, 0) / candles.length : 0;
}

function classifyRange(h1: Candle[]): RangeBounds | null {
  // Les bornes sont calculées sur les 24 bougies H1 précédentes, sans la dernière
  // bougie qui sert séparément à confirmer une éventuelle cassure.
  if (h1.length < 35) return null;
  const sample = h1.slice(-25, -1);
  const current = h1[h1.length - 1];
  const a = atr(h1.slice(-60), 14);
  if (!(a > 0)) return null;
  const high = Math.max(...sample.map(x => x.h));
  const low = Math.min(...sample.map(x => x.l));
  const width = high - low;
  const widthAtr = width / a;
  if (!(widthAtr >= 2.0 && widthAtr <= 8.5)) return null;

  const tolerance = Math.max(a * 0.28, width * 0.035);
  const highTouches = sample.filter(x => Math.abs(x.h - high) <= tolerance).length;
  const lowTouches = sample.filter(x => Math.abs(x.l - low) <= tolerance).length;
  if (highTouches < 2 || lowTouches < 2) return null;

  const firstMean = sample.slice(0, 8).reduce((sum, x) => sum + x.c, 0) / 8;
  const lastMean = sample.slice(-8).reduce((sum, x) => sum + x.c, 0) / 8;
  if (Math.abs(lastMean - firstMean) > 0.90 * a) return null; // évite de classer un canal directionnel comme range

  const recentVol = meanRange(sample.slice(-8));
  const olderVol = meanRange(sample.slice(0, 16));
  const compressed = olderVol > 0 && recentVol <= olderVol * 1.12;
  if (!compressed) return null;

  // Une bougie H1 de sortie impulsive n'est pas considérée comme un range encore actif.
  const body = Math.abs(current.c - current.o);
  const range = current.h - current.l;
  const breakoutUp = current.c > high + a * 0.08 && body >= a * 0.55 &&
    range > 0 && (current.h - current.c) / range <= 0.25;
  const breakoutDown = current.c < low - a * 0.08 && body >= a * 0.55 &&
    range > 0 && (current.c - current.l) / range <= 0.25;
  return { high, low, atr: a, widthAtr, highTouches, lowTouches, compressed,
    ...(breakoutUp ? { breakout: "BUY" as const } : breakoutDown ? { breakout: "SELL" as const } : {}) } as RangeBounds & { breakout?: Dir };
}

function fmt(value: number, price: number): string {
  const digits = Math.abs(price) >= 1000 ? 2 : Math.abs(price) >= 10 ? 3 : 5;
  return value.toFixed(digits);
}

function result(
  dir: Dir, score: number, entry: number, sl: number, tps: [number, number, number],
  strategy: string, reasons: string[], passed: boolean, rejection: string
): RangeSetup {
  return { dir, score: Math.min(100, score), entry, sl, tps, strategy, reasons, passed, rejection };
}

function buildRangeSetup(
  regime: Regime, cfg: SymbolCfg, m15: Candle[], h1: Candle[], bounds: RangeBounds,
  now: number, context: RangeContext
): RangeSetup {
  const price = m15[m15.length - 1].c;
  const last = m15[m15.length - 1];
  const a15 = atr(m15);
  const reasons = [
    `Range H1 confirmé : ${fmt(bounds.low, price)} – ${fmt(bounds.high, price)} (${bounds.widthAtr.toFixed(1)} ATR)`,
    `Bornes testées : résistance ${bounds.highTouches} fois, support ${bounds.lowTouches} fois`,
    "Compression de volatilité H1 confirmée"
  ];
  let dir: Dir | null = null;
  let strategy = "V2 Range";
  let wickExtreme = 0;
  let score = 30;

  const lowerFakeout = last.l < bounds.low - 0.10 * a15 && last.c > bounds.low &&
    last.c > last.o && (Math.min(last.o, last.c) - last.l) >= Math.abs(last.c - last.o) * 0.65;
  const upperFakeout = last.h > bounds.high + 0.10 * a15 && last.c < bounds.high &&
    last.c < last.o && (last.h - Math.max(last.o, last.c)) >= Math.abs(last.c - last.o) * 0.65;

  if (regime === "fakeout" || lowerFakeout || upperFakeout) {
    if (lowerFakeout) { dir = "BUY"; wickExtreme = last.l; }
    if (upperFakeout) { dir = "SELL"; wickExtreme = last.h; }
    strategy = "Range Fakeout + Sweep + Reclaim";
    if (dir) {
      score += 25;
      reasons.push(`Fausse cassure ${dir === "BUY" ? "sous le support" : "au-dessus de la résistance"} puis réintégration M15`);
    }
  } else if (regime === "breakout") {
    const h1Last = h1[h1.length - 1];
    const breakoutDir: Dir = h1Last.c > bounds.high ? "BUY" : "SELL";
    const level = breakoutDir === "BUY" ? bounds.high : bounds.low;
    // Anti-look-ahead : un retest n'est valide que sur des bougies M15 clôturées
    // après la clôture de la bougie H1 qui a confirmé la cassure.
    const breakoutClosedAt = h1Last.t + 60 * 60_000;
    const postBreakout = m15.filter(x => x.t >= breakoutClosedAt);
    const retestBars = postBreakout.slice(0, -1).slice(-4);
    const retest = postBreakout.length >= 2 && retestBars.some(x => breakoutDir === "BUY"
      ? x.l <= level + 0.18 * bounds.atr && x.c > level
      : x.h >= level - 0.18 * bounds.atr && x.c < level);
    const aligned = postBreakout.length >= 2 && (breakoutDir === "BUY" ? last.c > last.o : last.c < last.o);
    if (retest && aligned) {
      dir = breakoutDir;
      wickExtreme = breakoutDir === "BUY" ? Math.min(...postBreakout.slice(-4).map(x => x.l)) : Math.max(...postBreakout.slice(-4).map(x => x.h));
      strategy = "Range Breakout + Retest";
      score += 30;
      reasons.push(`Cassure H1 impulsive puis retest M15 de ${fmt(level, price)}`);
    }
  } else {
    const nearLow = last.l <= bounds.low + 0.22 * bounds.atr && last.c > bounds.low;
    const nearHigh = last.h >= bounds.high - 0.22 * bounds.atr && last.c < bounds.high;
    const bullishReject = nearLow && last.c > last.o &&
      (Math.min(last.o, last.c) - last.l) >= Math.abs(last.c - last.o) * 0.55;
    const bearishReject = nearHigh && last.c < last.o &&
      (last.h - Math.max(last.o, last.c)) >= Math.abs(last.c - last.o) * 0.55;
    if (bullishReject) { dir = "BUY"; wickExtreme = last.l; }
    if (bearishReject) { dir = "SELL"; wickExtreme = last.h; }
    strategy = "Range Boundary Rejection";
    if (dir) {
      score += 25;
      reasons.push(`Rejet M15 confirmé sur la ${dir === "BUY" ? "borne basse" : "borne haute"} du range`);
    }
  }

  if (!dir) {
    return result("BUY", 30, price, 0, [0, 0, 0], strategy, reasons, false,
      regime === "breakout" ? "Cassure détectée mais retest M15 non confirmé." :
      "Range détecté : attendre un rejet propre sur une borne ou une cassure confirmée.");
  }

  const riskBuffer = Math.max(a15 * 0.18, bounds.atr * 0.08);
  const sl = dir === "BUY" ? wickExtreme - riskBuffer : wickExtreme + riskBuffer;
  const risk = Math.abs(price - sl);
  const riskAtr = risk / a15;
  if (!(risk > 0) || riskAtr < 0.25 || riskAtr > 1.8) {
    return result(dir, score, price, sl, [0, 0, 0], strategy, reasons, false,
      `Risque invalide pour le setup de range (${riskAtr.toFixed(2)} ATR M15).`);
  }
  score += 15;
  reasons.push(`SL protégé derrière la mèche ; risque ${riskAtr.toFixed(2)} ATR M15`);

  const room = regime === "breakout" ? bounds.high - bounds.low : (dir === "BUY" ? bounds.high - price : price - bounds.low);
  const roomR = room / risk;
  if (roomR >= 1.5) {
    score += 10;
    reasons.push(regime === "breakout" ? `Projection minimale basée sur la hauteur du range : ${roomR.toFixed(2)}R` : `Espace jusqu'à l'autre borne : ${roomR.toFixed(2)}R`);
  } else reasons.push(`Espace restant dans le range insuffisant : ${roomR.toFixed(2)}R`);

  const kz = getKillzone(now);
  if (cfg.session === "crypto") {
    score += 5;
    reasons.push("Marché crypto ouvert en continu : bonus de disponibilité conservé");
  } else if (kz.active) {
    score += 5;
    reasons.push(`Contexte temporel favorable : Kill Zone ${kz.name}`);
  }
  const asia = getAsianRange(m15, now);
  if (sweptAsianRange(m15, asia, dir)) {
    score += 5;
    reasons.push(`Balayage de l'extrême asiatique puis réintégration (${dir})`);
  } else if (asia) {
    reasons.push(`Repères asiatiques : H ${asia.high.toFixed(5)} / B ${asia.low.toFixed(5)}`);
  }
  if (!context.newsBlocked) { score += 5; reasons.push("Aucune fenêtre de news bloquante"); }
  if (context.marketOpen) score += 5;
  if (!context.hasOpen) score += 5;

  // Profil sniper : aucun objectif ne doit être rapproché artificiellement.
  // Les trois TP sont fixés à 2R / 5R / 8R ; le setup est rejeté si la
  // structure du range ne laisse pas au moins 8,8R avant la borne opposée.
  const sg = dir === "BUY" ? 1 : -1;
  const tps = [2, 5, 8].map(r => Number((price + sg * risk * r).toFixed(
    Math.abs(price) >= 1000 ? 2 : Math.abs(price) >= 10 ? 3 : 5
  ))) as [number, number, number];

  const gates = [
    { ok: score >= 75, label: "score ≥ 75/100" },
    { ok: roomR >= 8.8, label: "espace libre suffisant pour TP3 ≥ 8R" },
    { ok: !context.newsBlocked, label: "actualité" },
    { ok: context.marketOpen, label: "marché ouvert" },
    { ok: !context.hasOpen, label: "aucun trade V2 ouvert" }
  ];
  const rejection = gates.filter(x => !x.ok).map(x => x.label).join(", ");
  return result(dir, score, price, Number(sl.toFixed(Math.abs(price) >= 1000 ? 2 : Math.abs(price) >= 10 ? 3 : 5)),
    tps, strategy, reasons, gates.every(x => x.ok), rejection || "Setup de range V2 validé.");
}

export function detectRangeSetup(
  cfg: SymbolCfg, m15: Candle[], h1: Candle[], now: number, context: RangeContext
): RangeSetup | null {
  if (m15.length < 20 || h1.length < 35) return null;
  const bounds = classifyRange(h1);
  if (!bounds) return null;
  const current = h1[h1.length - 1];
  const breakout = (bounds as RangeBounds & { breakout?: Dir }).breakout;
  const last = m15[m15.length - 1];
  const a15 = atr(m15);
  if (!(a15 > 0)) return null;

  if (breakout) {
    const setup = buildRangeSetup("breakout", cfg, m15, h1, bounds, now, context);
    // Si le prix a cassé H1, la logique de range/mean-reversion ne doit pas se déclencher.
    return setup;
  }
  const fakeout = last.l < bounds.low - 0.10 * a15 && last.c > bounds.low ||
    last.h > bounds.high + 0.10 * a15 && last.c < bounds.high;
  const inRange = current.c >= bounds.low && current.c <= bounds.high;
  if (fakeout) return buildRangeSetup("fakeout", cfg, m15, h1, bounds, now, context);
  if (inRange) return buildRangeSetup("range", cfg, m15, h1, bounds, now, context);
  return null;
}
