import { Candle, Dir, Evaluation, Gate, PatternInfo, Pivot, Structure, Sweep, WyckoffInfo, Zone } from "./types";
import { atr, lastOf, rsi, sma } from "./indicators";
import { findPivots, marketStructure } from "./structure";
import { detectFVG, detectOB, detectSweeps, detectPoolSweeps, equalLevels, premiumDiscount } from "./smc";
import { detectSD } from "./zones";
import { detectBreakerBlocks, detectCRT, getKillzone, CRTSetup, KillzoneInfo } from "./ictcrt";
import { detectWyckoff } from "./wyckoff";
import { detectPatterns } from "./patterns";
import { CFG, Profile } from "./config";

export interface TfStat { close: number; sma50: number; smaSlow: number; slowPeriod: 100 | 200; trend: "up" | "down" | "mixed"; rsi: number; atr: number }
export interface Analysis {
  symbol: string; price: number; atr: number; time: number;
  h1: TfStat; h4: TfStat; d1: TfStat;
  structure: Structure; zones: Zone[]; htfZones: Zone[]; sweeps: Sweep[]; wyckoff: WyckoffInfo; patterns: PatternInfo[];
  pd: { hi: number; lo: number; eq: number; pos: number }; eq: { highs: number[]; lows: number[] };
  crt: CRTSetup | null; killzone: KillzoneInfo;
  pivotsH4: Pivot[]; rejection: Dir | null; lastCandles: Candle[];
}
export interface EvalCtx { newsBlock: string | null; marketOpen: boolean; hasOpen: boolean; p: Profile; inter?: number } // inter : biais intermarchés (−1 … +1, > 0 = favorable à une hausse de l'actif)

export function tfStat(c: Candle[], slowPeriod: 100 | 200): TfStat {
  const cl = c.map((x) => x.c);
  const close = lastOf(cl), s50 = lastOf(sma(cl, 50)), slow = lastOf(sma(cl, slowPeriod));
  const trend = close > s50 && s50 > slow ? "up" : close < s50 && s50 < slow ? "down" : "mixed";
  return { close, sma50: s50, smaSlow: slow, slowPeriod, trend, rsi: lastOf(rsi(cl)), atr: lastOf(atr(c)) };
}

function rejectionCandle(c: Candle[]): Dir | null {
  for (const k of [1, 2]) {
    const x = c[c.length - k], p = c[c.length - k - 1];
    if (!x || !p) continue;
    const body = Math.abs(x.c - x.o) || 1e-9, range = x.h - x.l;
    if (range <= 0) continue;
    const lw = Math.min(x.o, x.c) - x.l, uw = x.h - Math.max(x.o, x.c);
    if ((lw >= 1.5 * body && lw >= 0.5 * range && x.c >= x.o) || (x.c > x.o && p.c < p.o && x.c > p.o && x.o <= p.c)) return "BUY";
    if ((uw >= 1.5 * body && uw >= 0.5 * range && x.c <= x.o) || (x.c < x.o && p.c > p.o && x.c < p.o && x.o >= p.c)) return "SELL";
  }
  return null;
}

export function buildAnalysis(symbol: string, h1: Candle[], h4: Candle[], d1: Candle[], now = lastOf(h1).t): Analysis {
  if (h1.length < 105 || h4.length < 105 || d1.length < 205) throw new Error(`Pas assez de bougies (H1 ${h1.length}/105 pour MM100, H4 ${h4.length}/105 pour MM100, D1 ${d1.length}/205 pour MM200)`);
  const a1 = atr(h1), a4 = atr(h4);
  const piv1 = findPivots(h1, 3), piv4 = findPivots(h4, 3);
  const A = lastOf(a1);
  return {
    symbol, price: lastOf(h1).c, atr: A, time: lastOf(h1).t,
    h1: tfStat(h1, 100), h4: tfStat(h4, 100), d1: tfStat(d1, 200),
    structure: marketStructure(h1, piv1, 3, 12),
    zones: [...detectOB(h1, a1, "H1"), ...detectFVG(h1, a1, "H1"), ...detectSD(h1, a1, "H1"), ...detectBreakerBlocks(h1, a1, "H1")],
    htfZones: [...detectOB(h4, a4, "H4"), ...detectSD(h4, a4, "H4"), ...detectBreakerBlocks(h4, a4, "H4")],
    sweeps: [...detectSweeps(h1, a1, piv1, 10, 3), ...detectPoolSweeps(h1, a1, piv1, 10)].sort((x, y) => x.barsAgo - y.barsAgo),
    wyckoff: detectWyckoff(h1, a1),
    patterns: detectPatterns(h1, a1, piv1),
    pd: premiumDiscount(h1, 60), eq: equalLevels(piv1, A), crt: detectCRT(h1), killzone: getKillzone(now),
    pivotsH4: piv4, rejection: rejectionCandle(h1), lastCandles: h1.slice(-12),
  };
}

export const roundP = (x: number, ref: number) => Number(x.toFixed(ref >= 10 ? (ref >= 1000 ? 2 : 3) : 5));

/** Choisit l'invalidation structurelle valide la plus proche du prix, puis ajoute un buffer ATR.
 * Les zones du mauvais côté du prix sont ignorées ; le sweep n'élargit le stop que s'il est cohérent.
 */
export function structuralStop(price: number, atrNow: number, dir: Dir, zones: Zone[], sweep: Sweep | undefined) {
  const buy = dir === "BUY";
  const levels = zones
    .filter((z) => z.dir === dir)
    .map((z) => buy ? z.bottom : z.top)
    .filter((level) => Number.isFinite(level) && (buy ? level < price : level > price));
  const nearest = levels.length ? (buy ? Math.max(...levels) : Math.min(...levels)) : (buy ? price - 1.2 * atrNow : price + 1.2 * atrNow);
  const validSweep = sweep && (buy ? sweep.wick < price : sweep.wick > price) ? sweep.wick : null;
  const invalidation = validSweep === null ? nearest : (buy ? Math.min(nearest, validSweep) : Math.max(nearest, validSweep));
  const sl = buy ? invalidation - 0.25 * atrNow : invalidation + 0.25 * atrNow;
  return { sl, riskAtr: Math.abs(price - sl) / atrNow, reference: invalidation };
}

// Évalue un sens (BUY/SELL) : conditions obligatoires (gates) + score de confluence.
export function evaluate(an: Analysis, dir: Dir, ctx: EvalCtx): Evaluation {
  const buy = dir === "BUY", sg = buy ? 1 : -1, A = an.atr, P = an.price;
  const upT = buy ? "up" : "down", oppT = buy ? "down" : "up";
  const reasons: string[] = [], tags = new Set<string>(["MM50/MM100 H1-H4 + MM200 D1"]), gates: Gate[] = [];
  let score = 0;
  const gate = (name: string, ok: boolean, detail: string) => gates.push({ name, ok, detail });
  const dirFr = buy ? "haussier" : "baissier";

  // 1. Tendance multi-timeframe : MM50/MM100 sur H1-H4 ; MM50/MM200 sur D1
  const part = (s: { close: number; smaSlow: number }) => (buy ? s.close > s.smaSlow : s.close < s.smaSlow);
  const h4Full = an.h4.trend === upT, d1Full = an.d1.trend === upT;
  score += h4Full ? 12 : part(an.h4) ? 4 : 0;
  score += d1Full ? 8 : part(an.d1) ? 3 : 0;
  if (h4Full) reasons.push(`H4 ${dirFr} (prix ${buy ? ">" : "<"} MM50 ${buy ? ">" : "<"} MM${an.h4.slowPeriod})`);
  if (d1Full) reasons.push(`D1 ${dirFr} (MM50/MM200 alignées)`);
  if (an.h1.trend === upT) { score += 8; reasons.push(`H1 aligné sur les MM50/100`); }
  else if (part(an.h1)) score += 3;
  if (Math.abs(P - an.h1.sma50) <= A) { score += 2; reasons.push("pullback sur la MM50 H1"); }

  // 2. Structure de marché
  const ev = an.structure.event, evAligned = !!ev && ev.dir === dir;
  if (an.structure.trend === upT) score += 6;
  if (evAligned) { score += 8; tags.add("SMC"); reasons.push(`${ev!.type} ${dirFr} il y a ${ev!.barsAgo} bougies (niveau ${roundP(ev!.level, P)})`); }
  // H4 aligné, ou D1 aligné avec H4 neutre (profils équilibré/actif) ou avec H4 neutre + cassure H1 alignée (profil strict)
  const htfOk = (h4Full || (d1Full && an.h4.trend === "mixed" && (evAligned || ctx.p.htfD1Only))) && an.d1.trend !== oppT;
  gate("Tendance HTF", htfOk, `H4 ${an.h4.trend}, D1 ${an.d1.trend} (requis : H4 ${upT}, ou D1 ${upT} avec H4 neutre${ctx.p.htfD1Only ? "" : " + cassure H1 alignée"})`);

  // 3. Zones d'intérêt (POI) à proximité du prix
  const tol = ctx.p.poiTolAtr * A;
  // Zone « au prix » : le prix est dedans/à proximité, ou la zone vient d'être touchée (dernières bougies) et le prix réagit sans s'en être éloigné de plus de 1 ATR
  const recent = an.lastCandles.slice(-Math.max(1, ctx.p.poiRecentBars));
  const near = (z: Zone) => z.dir === dir && ((P <= z.top + tol && P >= z.bottom - tol) ||
    (ctx.p.poiRecentBars > 0 && recent.some((k) => k.l <= z.top && k.h >= z.bottom) && (buy ? P <= z.top + A && P >= z.bottom - tol : P >= z.bottom - A && P <= z.top + tol)));
  const poi = an.zones.filter(near), htfPoi = an.htfZones.filter(near);
  let poiScore = 0;
  for (const k of ["OB", "SD", "FVG", "BREAKER"] as const) {
    const z = poi.find((x) => x.kind === k);
    if (!z) continue;
    poiScore += k === "FVG" ? 5 : 8;
    tags.add(k === "SD" ? "Offre/Demande" : "SMC");
    const nm = k === "OB" ? "Order Block" : k === "FVG" ? "FVG" : k === "BREAKER" ? "Breaker Block" : buy ? "Zone de demande" : "Zone d'offre";
    reasons.push(`${nm} ${dirFr} ${roundP(z.bottom, P)}–${roundP(z.top, P)} (${z.touches} test${z.touches > 1 ? "s" : ""})`);
  }
  if (htfPoi.length) { poiScore += 4; tags.add("Offre/Demande"); reasons.push(`zone H4 confluente (${htfPoi[0].kind})`); }
  score += Math.min(poiScore, 20);
  gate("Zone d'intérêt", poi.length + htfPoi.length > 0, poi.length + htfPoi.length > 0 ? `${poi.length} zone(s) H1, ${htfPoi.length} zone(s) H4 au prix` : "prix hors de toute zone OB/FVG/Breaker/offre-demande non mitigée");

  // 4. Déclencheurs
  const sweep = an.sweeps.find((s) => s.dir === dir);
  if (sweep) { score += 10; tags.add("SMC"); reasons.push(`liquidity sweep ${buy ? "des creux" : "des sommets"} ${roundP(sweep.level, P)} (il y a ${sweep.barsAgo} bougies)`); }
  const bslLevel = an.eq.highs.length ? [...an.eq.highs].sort((x, y) => Math.abs(x - P) - Math.abs(y - P))[0] : null;
  const sslLevel = an.eq.lows.length ? [...an.eq.lows].sort((x, y) => Math.abs(x - P) - Math.abs(y - P))[0] : null;
  if (bslLevel !== null || sslLevel !== null) {
    tags.add("BSL/SSL");
    if (bslLevel !== null) reasons.push(`BSL (buy-side liquidity) : égalités de sommets les plus proches vers ${roundP(bslLevel, P)}`);
    if (sslLevel !== null) reasons.push(`SSL (sell-side liquidity) : égalités de creux les plus proches vers ${roundP(sslLevel, P)}`);
  }
  const wy = an.wyckoff.bias === dir ? an.wyckoff : null;
  if (wy) { score += 8; tags.add("Wyckoff"); reasons.push(`Wyckoff : ${wy.event} (${wy.phase})`); }
  const pat = an.patterns.find((p) => p.dir === dir && p.confirmed);
  const patPending = an.patterns.find((p) => p.dir === dir && !p.confirmed);
  if (pat) { score += 8; tags.add("Figure"); reasons.push(`figure : ${pat.name} confirmé(e) (niveau ${roundP(pat.level, P)})`); }
  else if (patPending) { score += 2; reasons.push(`figure en formation : ${patPending.name}`); }
  const rej = an.rejection === dir;
  if (rej) { score += 3; reasons.push("bougie de rejet sur la zone"); }
  const crtAligned = an.crt?.dir === dir;
  if (crtAligned) { score += 10; tags.add("CRT"); reasons.push(`CRT ${dirFr} : sweep puis réintégration de la range ${roundP(an.crt!.low, P)}–${roundP(an.crt!.high, P)} (bougie de référence)`); }
  if (an.killzone.active) { score += 2; tags.add(`ICT Killzone ${an.killzone.name}`); reasons.push(`ICT Kill Zone ${an.killzone.name} active (${an.killzone.localTime})`); }
  const trig = !!sweep || evAligned || !!wy || !!pat || rej || crtAligned;
  gate("Déclencheur", trig, trig ? "au moins une confirmation (sweep, BOS/CHoCH/MSS, CRT, Wyckoff, figure ou rejet)" : "aucune confirmation (sweep, BOS/CHoCH/MSS, CRT, Wyckoff, figure, rejet)");

  // 5. Premium / discount, RSI
  const inGood = buy ? an.pd.pos <= 0.5 : an.pd.pos >= 0.5;
  if (inGood) { score += 4; tags.add("Premium/Discount"); reasons.push(`${buy ? "discount" : "premium"} (${Math.round(an.pd.pos * 100)} % du dealing range ; EQ ${roundP(an.pd.eq, P)})`); }
  else if (buy ? an.pd.pos > 0.7 : an.pd.pos < 0.3) score -= 4;
  if (buy ? an.h1.rsi > 75 : an.h1.rsi < 25) { score -= 8; reasons.push(`RSI H1 extrême (${an.h1.rsi.toFixed(0)}) : risque de poursuite`); }

  // 6. Niveaux : SL structurel, TP en multiples de R
  const allPoi = [...poi, ...htfPoi];
  const stop = structuralStop(P, A, dir, allPoi, sweep);
  const sl = roundP(stop.sl, P);
  const risk = Math.abs(P - sl);
  gate("Risque / SL", stop.riskAtr <= CFG.maxRiskAtr, `SL structurel à ${stop.riskAtr.toFixed(2)} ATR (max ${CFG.maxRiskAtr}) ; buffer 0,25 ATR ; aucune extension artificielle à 0,8 ATR`);
  const tps = CFG.tpRR.map((r) => roundP(P + sg * risk * r, P)) as [number, number, number];

  // 7. Espace libre vers l'obstacle (pivots H4 + zones opposées)
  const obst: number[] = [];
  for (const p of an.pivotsH4) if (buy ? p.isHigh && p.price > P : !p.isHigh && p.price < P) obst.push(p.price);
  for (const z of an.htfZones) if (z.dir !== dir && (buy ? z.bottom > P : z.top < P)) obst.push(buy ? z.bottom : z.top); // obstacles = H4 uniquement (les zones H1 proches servent de cibles, pas de blocage)
  const nearest = obst.length ? (buy ? Math.min(...obst) : Math.max(...obst)) : null;
  const room = nearest === null ? Infinity : Math.abs(nearest - P) / risk;
  gate(`Espace ≥ ${ctx.p.minRoomR}R`, room >= ctx.p.minRoomR, nearest === null ? "aucun obstacle H4 en vue" : `obstacle à ${roundP(nearest, P)} = ${room.toFixed(1)}R`);

  // 8. Contexte
  gate("Actualités", ctx.newsBlock === null, ctx.newsBlock ?? "aucune news à fort impact proche");
  gate("Marché ouvert", ctx.marketOpen, ctx.marketOpen ? "ok" : "marché fermé");
  gate("Pas de signal ouvert", !ctx.hasOpen, ctx.hasOpen ? "un signal est déjà ouvert sur cet actif" : "ok");

  // Intermarchés (proxy EUR/USD pour le dollar + surprises macro) : ajustement de score de ± 6 points au plus.
  if (ctx.inter) {
    const adj = Math.round(ctx.inter * sg * 6);
    if (adj !== 0) { score += adj; if (Math.abs(adj) >= 2) { tags.add("Intermarchés"); reasons.push(`intermarchés ${adj > 0 ? "favorables" : "défavorables"} (${adj > 0 ? "+" : ""}${adj} pts : proxy USD et surprises macro récentes)`); } }
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  gate(`Score ≥ ${ctx.p.minScore}`, score >= ctx.p.minScore, `score ${score}`);
  return { dir, gates, score, reasons, tags: [...tags], entry: roundP(P, P), sl: roundP(sl, P), tps, rr: `1:${CFG.tpRR[1]}`, passed: gates.every((g) => g.ok) };
}
