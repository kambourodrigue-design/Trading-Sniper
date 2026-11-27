// Tests unitaires légers (aucune dépendance) : npm test
import { evaluateOutcome, Sig } from "../src/engine/outcome";
import { summarize, rOf } from "../src/engine/metrics";
import { fundamentalBias, macroScoreText } from "../src/lib/macro";
import { SYMBOLS } from "../src/engine/config";
import { tfStat, structuralStop } from "../src/engine/analyze";
import { adaptiveProfile } from "../src/engine/run";
import { PROFILES } from "../src/engine/config";
import { detectCRT, getKillzone, detectBreakerBlocks, getAsianRange, sweptAsianRange } from "../src/engine/ictcrt";
import { pipUnit, estimatedUsd } from "../src/lib/telegram";
import { detectPoolSweeps } from "../src/engine/smc";
import { detectLiquiditySetup } from "../src/engine/liquidity-engine";
import { detectRangeSetup } from "../src/engine/range-engine";
import { assessFundamentals } from "../src/engine/fundamental-engine";


const M = 900_000, t0 = 1_700_000_000_000;
const k = (i: number, l: number, h: number) => ({ t: t0 + i * M, o: 0, c: 0, l, h });
const base: Sig = { id: "x", symbol: "S", direction: "BUY", entry: 100, stop_loss: 98, tp1: 101.5, tp2: 102.5, tp3: 104, tp_reached: 0, created_at: t0 / 1000 };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const assert = {
  strictEqual: (a: unknown, b: unknown) => { if (typeof a === "number" && typeof b === "number" ? Math.abs(a - b) > 1e-9 : a !== b) throw new Error(`attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`); },
  deepStrictEqual: (a: unknown, b: unknown) => { if (!same(a, b)) throw new Error(`attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`); },
};
let n = 0; const t = (name: string, f: () => void) => { f(); n++; console.log(`ok  ${name}`); };

t("TP1 atteint : le trade reste ouvert et progress_at est renvoyé", () => {
  const r = evaluateOutcome(base, [k(0, 99.5, 100.2), k(1, 100.5, 101.6)], t0 + 2 * M);
  assert.deepStrictEqual([r.tp, r.outcome, r.progressAt], [1, "open", t0 + M]);
});
t("RÉGRESSION : un repli vers l'entrée AVANT TP1 ne ferme pas le trade au passage suivant", () => {
  const all = [k(0, 99.5, 100.2), k(1, 100.5, 101.6), k(2, 101.2, 102.6), k(3, 101.8, 104.5)];
  const r = evaluateOutcome({ ...base, tp_reached: 1, progress_at: t0 + M }, all, t0 + 10 * M);
  assert.strictEqual(r.outcome, "tp3");
});
t("stop suiveur : après TP1, retour à l'entrée = clôture « tp1 »", () => {
  const r = evaluateOutcome({ ...base, tp_reached: 1, progress_at: t0 + M }, [k(0, 99.5, 100.2), k(1, 100.5, 101.6), k(2, 99.9, 101)], t0 + 10 * M);
  assert.deepStrictEqual([r.outcome, r.at], ["tp1", t0 + 2 * M]);
});
t("SL touché avant tout palier", () => assert.strictEqual(evaluateOutcome(base, [k(0, 97.9, 100.5)], t0 + 5 * M).outcome, "sl"));
t("même bougie stop + TP : le stop passe en premier", () => assert.strictEqual(evaluateOutcome(base, [k(0, 97.9, 102)], t0 + 5 * M).outcome, "sl"));
t("TP1 et TP2 dans la même bougie", () => assert.strictEqual(evaluateOutcome(base, [k(0, 100.1, 102.6)], t0 + 5 * M).tp, 2));
t("SELL symétrique", () => {
  const s: Sig = { ...base, direction: "SELL", stop_loss: 102, tp1: 98.5, tp2: 97.5, tp3: 96 };
  assert.strictEqual(evaluateOutcome(s, [k(0, 96, 100.5)], t0 + 5 * M).outcome, "tp3");
});
t("R : sl −1, tp1 0, tp2 +1,5, tp3 +4, coût déduit des trades clos", () => {
  assert.deepStrictEqual(["sl", "tp1", "tp2", "tp3"].map((o) => rOf(o)), [-1, 0, 1.5, 4]);
  assert.strictEqual(rOf("sl", 0.1), -1.1); assert.strictEqual(rOf("expired", 0.1), 0);
});
t("summarize : TP1/TP2/TP3 = gagnants (même break-even), espérance, profit factor, drawdown, série", () => {
  const m = summarize([{ outcome: "tp3" }, { outcome: "sl" }, { outcome: "sl" }, { outcome: "tp1" }, { outcome: "tp2" }, { outcome: "expired" }]);
  assert.strictEqual(m.trades, 5); assert.strictEqual(m.wins, 2); assert.strictEqual(m.breakeven, 1); assert.strictEqual(m.losses, 2); assert.strictEqual(m.unresolved, 1);
  assert.strictEqual(m.tp_hits, 3); assert.strictEqual(m.win_rate, 60); assert.strictEqual(m.tp1_touch_rate, 60);
  assert.strictEqual(m.total_r, 3.5); assert.strictEqual(m.expectancy_r, 0.7); assert.strictEqual(m.profit_factor, 2.75);
  assert.strictEqual(m.max_drawdown_r, 2); assert.strictEqual(m.max_loss_streak, 2);
});
t("12 paires Forex + Gold + BTC/ETH configurés avec les seuls fournisseurs autorisés", () => {
  assert.strictEqual(SYMBOLS.length, 15);
  assert.strictEqual(SYMBOLS.filter((x) => x.currencies.length === 2 && x.session === "fx").length, 12);
  for (const item of SYMBOLS) for (const source of item.sources) {
    if (!(source.p === "biquote" || source.p === "yahoo")) throw new Error(`fournisseur interdit : ${source.p}`);
  }
  for (const item of SYMBOLS.filter((x) => x.session === "fx")) if (!item.sources.some((source) => source.p === "yahoo")) throw new Error(`repli Yahoo absent : ${item.symbol}`);
  const gold = SYMBOLS.find((x) => x.symbol === "XAU/USD");
  if (!gold?.sources.some((source) => source.p === "yahoo" && source.id === "GC=F" && source.market === "metals-futures-proxy")) throw new Error("repli Yahoo XAU/USD incorrect : attendu GC=F (futures proxy), pas XAUUSD=X");
});
t("biais macro : surprise USD positive pénalise EUR/USD et favorise USD/JPY", () => {
  const now = Date.UTC(2026, 10, 19, 12, 0);
  const events = [{ title: "US CPI", country: "USD", t: now - 60_000, impact: "High", forecast: "3.0%", actual: "3.2%" }];
  assert.strictEqual(fundamentalBias(events, "EUR/USD", now).bias, -1);
  assert.strictEqual(fundamentalBias(events, "USD/JPY", now).bias, 1);
});
t("score macro : couverture affichée, différentiels et biais marchés produits sans données inventées", () => {
  const now = Date.UTC(2026, 10, 19, 12, 0);
  const policy = ["USD (Fed) : 4.000 % au 2026-11-18", "EUR (BCE) : 2.000 % au 2026-11-18", "GBP (BoE) : 4.000 % au 2026-11-18", "JPY (BoJ) : 0.500 % au 2026-11-18", "CAD (BoC) : 2.250 % au 2026-11-18", "CHF (BNS) : 0.000 % au 2026-11-18", "AUD (RBA) : 3.600 % au 2026-11-18", "NZD (RBNZ) : 2.500 % au 2026-11-18"].join("\n");
  const score = macroScoreText([{ title: "US CPI", country: "USD", t: now - 60_000, impact: "High", forecast: "3.0%", actual: "3.2%" }], policy, "CFTC indisponible", { values: { DGS2_CHANGE_5D: 0.05, DFII10_CHANGE_5D: 0.03, DXY_CHANGE: 0.1, VIX: 22 } }, now);
  assert.strictEqual(score.includes("USD "), true);
  assert.strictEqual(score.includes("couverture"), true);
  assert.strictEqual(score.includes("EUR/USD :"), true);
  assert.strictEqual(score.includes("non encore calibré par backtest"), true);
});


t("profil adaptatif : assouplit uniquement quand H4 et D1 sont alignés", () => {
  const aligned = { atr: 1, h4: { trend: "down", atr: 2 }, d1: { trend: "down" } } as any;
  const conflict = { atr: 1, h4: { trend: "up", atr: 2 }, d1: { trend: "down" } } as any;
  const a = adaptiveProfile(aligned, "SELL", PROFILES.adaptive);
  const c = adaptiveProfile(conflict, "BUY", PROFILES.adaptive);
  assert.strictEqual(a.minScore, 46);
  assert.strictEqual(a.minRoomR, 1.4);
  assert.strictEqual(c.minScore, 64);
  assert.strictEqual(c.minRoomR, 2.0);
  const volatile = adaptiveProfile({ ...aligned, atr: 2 } as any, "SELL", PROFILES.adaptive);
  assert.strictEqual(volatile.minScore, 50);
  assert.strictEqual(volatile.minRoomR, 1.6);
});


t("SL BUY : retient la zone de demande valide la plus proche et ignore les zones au-dessus du prix", () => {
  const zones = [
    { kind: "OB", dir: "BUY", bottom: 96, top: 98, i: 1, t: 1, touches: 0, tf: "H1" },
    { kind: "FVG", dir: "BUY", bottom: 99, top: 101, i: 2, t: 2, touches: 0, tf: "H1" },
    { kind: "SD", dir: "BUY", bottom: 103, top: 104, i: 3, t: 3, touches: 0, tf: "H4" },
  ] as any;
  const r = structuralStop(100, 2, "BUY", zones, undefined);
  assert.strictEqual(r.sl, 98.5);
  assert.strictEqual(r.riskAtr, 0.75);
});
t("SL SELL : retient la zone d'offre valide la plus proche", () => {
  const zones = [
    { kind: "OB", dir: "SELL", bottom: 102, top: 104, i: 1, t: 1, touches: 0, tf: "H1" },
    { kind: "FVG", dir: "SELL", bottom: 99, top: 101, i: 2, t: 2, touches: 0, tf: "H1" },
  ] as any;
  const r = structuralStop(100, 2, "SELL", zones, undefined);
  assert.strictEqual(r.sl, 101.5);
  assert.strictEqual(r.riskAtr, 0.75);
});
t("SL BUY : un sweep cohérent sous le prix protège la mèche", () => {
  const zones = [{ kind: "OB", dir: "BUY", bottom: 98, top: 99, i: 1, t: 1, touches: 0, tf: "H1" }] as any;
  const r = structuralStop(100, 1, "BUY", zones, { dir: "BUY", level: 97, wick: 96.5, barsAgo: 0 });
  assert.strictEqual(r.sl, 96.25);
});

t("anti-look-ahead : un pool n'est utilisable qu'après confirmation des deux pivots", () => {
  const bars = Array.from({ length: 10 }, (_, i) => ({ t: i, o: 99.8, h: 100, l: 99, c: 99.8 }));
  bars[6] = { ...bars[6], h: 101, c: 99.9 }; // faux sweep avant confirmation du second pivot
  bars[8] = { ...bars[8], h: 100.2, c: 99.9 }; // sweep après confirmation
  const pivots = [
    { i: 2, t: 2, price: 100, isHigh: true },
    { i: 5, t: 5, price: 100.02, isHigh: true },
  ];
  const sweeps = detectPoolSweeps(bars, Array(10).fill(1), pivots, 4, 3);
  assert.deepStrictEqual(sweeps.map((x) => x.barsAgo), [1]);
});

t("CRT : sweep du low de la bougie de référence puis réintégration", () => {
  const bars = [
    { t: 0, o: 103, h: 105, l: 102, c: 104 },
    { t: 1, o: 105, h: 110, l: 100, c: 106 },
    { t: 2, o: 101, h: 108, l: 99, c: 104 },
    { t: 3, o: 104, h: 105, l: 101, c: 104 },
  ];
  const x = detectCRT(bars);
  assert.deepStrictEqual(x && [x.dir, x.high, x.low, x.sweepExtreme], ["BUY", 110, 100, 99]);
});
t("Kill Zone Londres détectée en heure locale", () => {
  const x = getKillzone(Date.UTC(2026, 10, 19, 8, 0));
  assert.deepStrictEqual([x.active, x.name, x.localTime], [true, "London", "08:00"]);
});
t("Session asiatique : calcule les extrêmes 20h–minuit en heure de New York", () => {
  const candles = [
    { t: Date.UTC(2026, 10, 18, 20, 0), o: 100, h: 102, l: 99, c: 101 }, // 15:00 NY, hors session
    { t: Date.UTC(2026, 10, 19, 1, 0), o: 100, h: 105, l: 98, c: 101 }, // 20:00 NY
    { t: Date.UTC(2026, 10, 19, 2, 0), o: 101, h: 104, l: 97, c: 100 }, // 21:00 NY
    { t: Date.UTC(2026, 10, 19, 3, 0), o: 100, h: 103, l: 98, c: 102 }, // 22:00 NY
  ];
  const range = getAsianRange(candles, Date.UTC(2026, 10, 19, 4, 0));
  assert.deepStrictEqual(range && [range.high, range.low, range.candles], [105, 97, 3]);
  assert.strictEqual(sweptAsianRange([{ t: 1, o: 97, h: 99, l: 96, c: 98 }], range, "BUY"), true);
  assert.strictEqual(sweptAsianRange([{ t: 1, o: 105, h: 106, l: 104, c: 104.5 }], range, "SELL"), true);
  assert.strictEqual(sweptAsianRange([{ t: 1, o: 100, h: 101, l: 99, c: 100 }], range, "BUY"), false);
});
t("Kill Zone inactive : l'état est simplement informatif", () => {
  const x = getKillzone(Date.UTC(2026, 10, 19, 16, 0));
  assert.strictEqual(x.active, false);
  assert.strictEqual(x.name, "none");
});
t("Breaker Block : ancien OB haussier invalidé puis retesté devient résistance", () => {
  const bars = [
    { t: 0, o: 10, h: 11, l: 9, c: 10 },
    { t: 1, o: 10, h: 11, l: 9, c: 9.5 },
    { t: 2, o: 9.5, h: 12, l: 9.2, c: 11.5 },
    { t: 3, o: 9.2, h: 9.4, l: 8.5, c: 8.8 },
    { t: 4, o: 9.0, h: 9.6, l: 8.7, c: 8.9 },
  ];
  const zones = detectBreakerBlocks(bars, [1, 1, 1, 1, 1], "H1");
  assert.strictEqual(zones.some(z => z.kind === "BREAKER" && z.dir === "SELL"), true);
});
t("MM100 sur H1/H4 et MM200 sur D1 sont paramétrables séparément", () => {
  const bars = Array.from({ length: 210 }, (_, i) => ({ t: t0 + i * M, o: 100 + i, h: 102 + i, l: 99 + i, c: 101 + i }));
  assert.strictEqual(tfStat(bars, 100).slowPeriod, 100);
  assert.strictEqual(tfStat(bars, 200).slowPeriod, 200);
});
t("classification des unités et estimation 0,01 lot : Forex, or et crypto", () => {
  assert.strictEqual(pipUnit("BTC/USD"), 1);
  assert.strictEqual(pipUnit("ETH/USD"), 1);
  assert.strictEqual(pipUnit("XAU/USD"), 0.01);
  assert.strictEqual(estimatedUsd("BTC/USD", 400), 4);
  assert.strictEqual(estimatedUsd("BTC/USD", -400), -4);
  assert.strictEqual(estimatedUsd("BTC/USD", 45), 0.45);
  assert.strictEqual(estimatedUsd("BTC/USD", -45), -0.45);
  // Exness ETHUSD : contrat 1 ETH/lot, tick 0,00001 et valeur 0,00001 USD/lot.
  // À 0,01 lot, 1 USD de variation du cours vaut 0,01 USD.
  assert.strictEqual(estimatedUsd("ETH/USD", 1), 0.01);
  assert.strictEqual(estimatedUsd("ETH/USD", 100), 1);
  assert.strictEqual(estimatedUsd("ETH/USD", -100), -1);
  assert.strictEqual(estimatedUsd("EUR/USD", 0.0045), 4.5);
  assert.strictEqual(estimatedUsd("USD/JPY", 0.01, {}, 150), 0.06666666666666667);
  assert.strictEqual(estimatedUsd("EUR/JPY", 0.01, { USDJPY: 150 }), 0.06666666666666667);
  assert.strictEqual(estimatedUsd("EUR/CAD", 0.0001, { USDCAD: 1.35 }), 0.07407407407407407);
  assert.strictEqual(estimatedUsd("USD/CAD", 0.0001, {}, 1.35), 0.07407407407407407);
  assert.strictEqual(estimatedUsd("USD/CHF", 0.0001, {}, 0.90), 0.11111111111111112);
  assert.strictEqual(estimatedUsd("EUR/GBP", 0.0001, { GBPUSD: 1.27 }), 0.127);
  assert.strictEqual(estimatedUsd("GBP/USD", 0.0001), 0.1);
  assert.strictEqual(estimatedUsd("XAU/USD", 4), 4);
  assert.strictEqual(pipUnit("EUR/USD"), 0.0001);
  assert.strictEqual(pipUnit("USD/JPY"), 0.01);
  assert.strictEqual(pipUnit("EUR/JPY"), 0.01);
  assert.strictEqual(pipUnit("ABC/DEF"), null);
});

t("V2 Liquidity Intelligence : les 15 actifs configurés sont traités par la même interface multi-actifs", () => {
  const candles = (count: number, step: number) => Array.from({ length: count }, (_, i) => {
    const o = 100 + i * step, c = o + step * 0.5;
    return { t: t0 + i * M, o, h: c + step * 0.5, l: o - step * 0.5, c };
  });
  const m15 = candles(80, 0.01), h1 = candles(100, 0.04), h4 = candles(100, 0.12), d1 = candles(100, 0.3);
  for (const cfg of SYMBOLS) {
    const result = detectLiquiditySetup(cfg, m15, h1, h4, d1, t0 + 100 * M, { newsBlocked: false, marketOpen: true, hasOpen: false });
    assert.strictEqual(result.passed, false); // une simple tendance sans sweep ne doit jamais créer de signal V2
    assert.strictEqual(result.rejection.includes("Sweep"), true);
  }
});
t("V2 Liquidity Intelligence : refuse un historique trop court sans produire de signal", () => {
  const cfg = SYMBOLS[0];
  const result = detectLiquiditySetup(cfg, [], [], [], [], t0, { newsBlocked: false, marketOpen: true, hasOpen: false });
  assert.strictEqual(result.passed, false);
  assert.strictEqual(result.rejection.includes("Historique insuffisant"), true);
});


t("V2 Range Intelligence : détecte un range multi-actifs et un rejet propre sur la borne basse", () => {
  const h1 = Array.from({ length: 60 }, (_, i) => {
    let o = 100, c = 100.1, h = 100.5, l = 99.5;
    if ([36, 42, 48].includes(i)) h = 105;
    if ([39, 45, 51].includes(i)) l = 95;
    if (i === 59) { o = 96; c = 96.2; h = 96.5; l = 95.5; }
    return { t: t0 + 15 * 3_600_000 + i * 3_600_000, o, h, l, c };
  });
  const m15 = Array.from({ length: 60 }, (_, i) => {
    let o = 96, c = 96.1, h = 96.4, l = 95.7;
    if (i === 59) { o = 95.7; c = 96.2; h = 96.4; l = 95.3; }
    return { t: t0 + 75 * 3_600_000 + i * M, o, h, l, c };
  });
  const setup = detectRangeSetup(SYMBOLS[1], m15, h1, t0 + 90 * 3_600_000,
    { newsBlocked: false, marketOpen: true, hasOpen: false });
  assert.strictEqual(setup?.strategy, "Range Boundary Rejection");
  assert.strictEqual(setup?.dir, "BUY");
  assert.strictEqual(setup?.passed, true);
});

t("V2 Range Intelligence : refuse un historique insuffisant", () => {
  const setup = detectRangeSetup(SYMBOLS[0], [], [], t0,
    { newsBlocked: false, marketOpen: true, hasOpen: false });
  assert.strictEqual(setup, null);
});



t("V2 Range Intelligence : attend une cassure H1 impulsive et un retest M15 avant le breakout", () => {
  const h1 = Array.from({ length: 60 }, (_, i) => {
    let o = 100, c = 100.1, h = 100.5, l = 99.5;
    if ([36, 42, 48].includes(i)) h = 105;
    if ([39, 45, 51].includes(i)) l = 95;
    if (i === 59) { o = 105; c = 106.5; h = 107; l = 104.8; }
    return { t: t0 + 15 * 3_600_000 + i * 3_600_000, o, h, l, c };
  });
  const m15 = Array.from({ length: 60 }, (_, i) => {
    let o = 105.2, c = 105.3, h = 105.6, l = 104.9;
    if (i === 59) { o = 105.1; c = 105.5; h = 105.7; l = 104.8; }
    return { t: t0 + 75 * 3_600_000 + i * M, o, h, l, c };
  });
  const setup = detectRangeSetup(SYMBOLS[1], m15, h1, t0 + 90 * 3_600_000,
    { newsBlocked: false, marketOpen: true, hasOpen: false });
  assert.strictEqual(setup?.strategy, "Range Breakout + Retest");
  assert.strictEqual(setup?.dir, "BUY");
  assert.strictEqual(setup?.passed, true);
});


t("V2 fondamental : ajoute une confluence lorsque le biais macro est aligné et suffisamment couvert", () => {
  const macro = "EUR 65/100 (couverture 80/100 ; 3 surprises macro sur 30 j)\nUSD 40/100 (couverture 80/100 ; 2 surprises macro sur 30 j)\nBIAIS RELATIFS INDICATIFS :\nEUR/USD : haussier (écart indicatif 25 points)";
  const a = assessFundamentals("EUR/USD", "BUY", macro);
  assert.strictEqual(a.bias, "BUY");
  assert.strictEqual(a.coverage, 80);
  assert.strictEqual(a.adjustment, 5);
  assert.strictEqual(a.veto, false);
});
t("V2 fondamental : bloque une contradiction forte avec une couverture élevée", () => {
  const macro = "EUR 35/100 (couverture 90/100 ; 3 surprises macro sur 30 j)\nUSD 70/100 (couverture 90/100 ; 2 surprises macro sur 30 j)\nBIAIS RELATIFS INDICATIFS :\nEUR/USD : baissier (écart indicatif -35 points)";
  const a = assessFundamentals("EUR/USD", "BUY", macro);
  assert.strictEqual(a.veto, true);
  assert.strictEqual(a.adjustment, -11);
});
t("V2 fondamental : données absentes = neutre, jamais inventées", () => {
  const a = assessFundamentals("EUR/USD", "BUY", "Données macro indisponibles");
  assert.strictEqual(a.bias, "NEUTRAL");
  assert.strictEqual(a.coverage, 0);
  assert.strictEqual(a.adjustment, 0);
  assert.strictEqual(a.veto, false);
});

console.log(`\n${n} tests réussis`);

