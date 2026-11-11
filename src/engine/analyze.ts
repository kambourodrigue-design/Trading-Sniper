import { Candle, Dir, Evaluation, Gate, PatternInfo, Pivot, Structure, Sweep, WyckoffInfo, Zone } from "./types";
import { atr, lastOf, rsi, sma } from "./indicators";
import { findPivots, marketStructure } from "./structure";
import { detectFVG, detectOB, detectSweeps, equalLevels, premiumDiscount } from "./smc";
import { detectSD } from "./zones";
import { detectWyckoff } from "./wyckoff";
import { detectPatterns } from "./patterns";
import { CFG, Profile } from "./config";

export interface TfStat { close: number; sma50: number; sma200: number; trend: "up" | "down" | "mixed"; rsi: number; atr: number }
export interface Analysis {
  symbol: string; price: number; atr: number; time: number;
  h1: TfStat; h4: TfStat; d1: TfStat;
  structure: Structure; zones: Zone[]; htfZones: Zone[]; sweeps: Sweep[]; wyckoff: WyckoffInfo; patterns: PatternInfo[];
  pd: { hi: number; lo: number; eq: number; pos: number }; eq: { highs: number[]; lows: number[] };
  pivotsH4: Pivot[]; rejection: Dir | null; lastCandles: Candle[];
}
export interface EvalCtx { newsBlock: string | null; marketOpen: boolean; hasOpen: boolean; p: Profile }

export function tfStat(c: Candle[]): TfStat {
  const cl = c.map((x) => x.c);
  const close = lastOf(cl), s50 = lastOf(sma(cl, 50)), s200 = lastOf(sma(cl, 200));
  const trend = close > s50 && s50 > s200 ? "up" : close < s50 && s50 < s200 ? "down" : "mixed";
  return { close, sma50: s50, sma200: s200, trend, rsi: lastOf(rsi(cl)), atr: lastOf(atr(c)) };
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

export function buildAnalysis(symbol: string, h1: Candle[], h4: Candle[], d1: Candle[]): Analysis {
  if (h1.length < 210 || h4.length < 210 || d1.length < 210) throw new Error(`Pas assez de bougies (H1 ${h1.length}, H4 ${h4.length}, D1 ${d1.length}; 210 requises)`);
  const a1 = atr(h1), a4 = atr(h4);
  const piv1 = findPivots(h1, 3), piv4 = findPivots(h4, 3);
  const A = lastOf(a1);
  return {
    symbol, price: lastOf(h1).c, atr: A, time: lastOf(h1).t,
    h1: tfStat(h1), h4: tfStat(h4), d1: tfStat(d1),
    structure: marketStructure(h1, piv1, 3, 12),
    zones: [...detectOB(h1, a1, "H1"), ...detectFVG(h1, a1, "H1"), ...detectSD(h1, a1, "H1")],
    htfZones: [...detectOB(h4, a4, "H4"), ...detectSD(h4, a4, "H4")],
    sweeps: detectSweeps(h1, a1, piv1, 10, 3),
    wyckoff: detectWyckoff(h1, a1),
    patterns: detectPatterns(h1, a1, piv1),
    pd: premiumDiscount(h1, 60), eq: equalLevels(piv1, A),
    pivotsH4: piv4, rejection: rejectionCandle(h1), lastCandles: h1.slice(-12),
  };
}

export const roundP = (x: number, ref: number) => Number(x.toFixed(ref >= 10 ? (ref >= 1000 ? 2 : 3) : 5));

// Évalue un sens (BUY/SELL) : conditions obligatoires (gates) + score de confluence.
export function evaluate(an: Analysis, dir: Dir, ctx: EvalCtx): Evaluation {
  const buy = dir === "BUY", sg = buy ? 1 : -1, A = an.atr, P = an.price;
  const upT = buy ? "up" : "down", oppT = buy ? "down" : "up";
  const reasons: string[] = [], tags = new Set<string>(["MM50/200"]), gates: Gate[] = [];
  let score = 0;
  const gate = (name: string, ok: boolean, detail: string) => gates.push({ name, ok, detail });
  const dirFr = buy ? "haussier" : "baissier";

  // 1. Tendance multi-timeframe (MM50 / MM200)
  const part = (s: { close: number; sma200: number }) => (buy ? s.close > s.sma200 : s.close < s.sma200);
  const h4Full = an.h4.trend === upT, d1Full = an.d1.trend === upT;
  score += h4Full ? 12 : part(an.h4) ? 4 : 0;
  score += d1Full ? 8 : part(an.d1) ? 3 : 0;
  if (h4Full) reasons.push(`H4 ${dirFr} (prix ${buy ? ">" : "<"} MM50 ${buy ? ">" : "<"} MM200)`);
  if (d1Full) reasons.push(`D1 ${dirFr} (MM50/200 alignées)`);
  if (an.h1.trend === upT) { score += 8; reasons.push(`H1 aligné sur les MM50/200`); }
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
  for (const k of ["OB", "SD", "FVG"] as const) {
    const z = poi.find((x) => x.kind === k);
    if (!z) continue;
    poiScore += k === "FVG" ? 5 : 8;
    tags.add(k === "SD" ? "Offre/Demande" : "SMC");
    const nm = k === "OB" ? "Order Block" : k === "FVG" ? "FVG" : buy ? "Zone de demande" : "Zone d'offre";
    reasons.push(`${nm} ${dirFr} ${roundP(z.bottom, P)}–${roundP(z.top, P)} (${z.touches} test${z.touches > 1 ? "s" : ""})`);
  }
  if (htfPoi.length) { poiScore += 4; tags.add("Offre/Demande"); reasons.push(`zone H4 confluente (${htfPoi[0].kind})`); }
  score += Math.min(poiScore, 20);
  gate("Zone d'intérêt", poi.length + htfPoi.length > 0, poi.length + htfPoi.length > 0 ? `${poi.length} zone(s) H1, ${htfPoi.length} zone(s) H4 au prix` : "prix hors de toute zone OB/FVG/offre-demande non mitigée");

  // 4. Déclencheurs
  const sweep = an.sweeps.find((s) => s.dir === dir);
  if (sweep) { score += 10; tags.add("SMC"); reasons.push(`liquidity sweep ${buy ? "des creux" : "des sommets"} ${roundP(sweep.level, P)} (il y a ${sweep.barsAgo} bougies)`); }
  const wy = an.wyckoff.bias === dir ? an.wyckoff : null;
  if (wy) { score += 8; tags.add("Wyckoff"); reasons.push(`Wyckoff : ${wy.event} (${wy.phase})`); }
  const pat = an.patterns.find((p) => p.dir === dir && p.confirmed);
  const patPending = an.patterns.find((p) => p.dir === dir && !p.confirmed);
  if (pat) { score += 8; tags.add("Figure"); reasons.push(`figure : ${pat.name} confirmé(e) (niveau ${roundP(pat.level, P)})`); }
  else if (patPending) { score += 2; reasons.push(`figure en formation : ${patPending.name}`); }
  const rej = an.rejection === dir;
  if (rej) { score += 3; reasons.push("bougie de rejet sur la zone"); }
  const trig = !!sweep || evAligned || !!wy || !!pat || rej;
  gate("Déclencheur", trig, trig ? "au moins une confirmation (sweep, BOS/CHoCH, Wyckoff, figure ou rejet)" : "aucune confirmation (sweep, BOS/CHoCH, Wyckoff, figure, rejet)");

  // 5. Premium / discount, RSI
  const inGood = buy ? an.pd.pos <= 0.5 : an.pd.pos >= 0.5;
  if (inGood) { score += 4; reasons.push(`${buy ? "discount" : "premium"} (${Math.round(an.pd.pos * 100)} % du range)`); }
  else if (buy ? an.pd.pos > 0.7 : an.pd.pos < 0.3) score -= 4;
  if (buy ? an.h1.rsi > 75 : an.h1.rsi < 25) { score -= 8; reasons.push(`RSI H1 extrême (${an.h1.rsi.toFixed(0)}) : risque de poursuite`); }

  // 6. Niveaux : SL structurel, TP en multiples de R
  const allPoi = [...poi, ...htfPoi];
  const zoneEdge = allPoi.length ? (buy ? Math.min(...allPoi.map((z) => z.bottom)) : Math.max(...allPoi.map((z) => z.top))) : (buy ? P - 1.2 * A : P + 1.2 * A);
  const edge = sweep ? (buy ? Math.min(zoneEdge, sweep.wick) : Math.max(zoneEdge, sweep.wick)) : zoneEdge;
  let sl = buy ? edge - 0.25 * A : edge + 0.25 * A;
  let risk = Math.abs(P - sl);
  if (risk < CFG.minRiskAtr * A) { risk = CFG.minRiskAtr * A; sl = P - sg * risk; }
  gate("Risque / SL", risk <= CFG.maxRiskAtr * A, `SL à ${(risk / A).toFixed(2)} ATR (max ${CFG.maxRiskAtr})`);
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

  score = Math.max(0, Math.min(100, Math.round(score)));
  gate(`Score ≥ ${ctx.p.minScore}`, score >= ctx.p.minScore, `score ${score}`);
  return { dir, gates, score, reasons, tags: [...tags], entry: roundP(P, P), sl: roundP(sl, P), tps, rr: `1:${CFG.tpRR[1]}`, passed: gates.every((g) => g.ok) };
}
