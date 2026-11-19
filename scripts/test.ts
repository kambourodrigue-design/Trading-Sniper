// Tests unitaires légers (aucune dépendance) : npm test
import { evaluateOutcome, Sig } from "../src/engine/outcome";
import { summarize, rOf } from "../src/engine/metrics";
import { fundamentalBias, macroScoreText } from "../src/lib/macro";
import { SYMBOLS } from "../src/engine/config";
import { tfStat } from "../src/engine/analyze";
import { detectCRT, getKillzone, detectBreakerBlocks } from "../src/engine/ictcrt";
import { toFundVerdict, fundAlignment, fundSummary } from "../src/lib/ai";

const M = 900_000, t0 = 1_700_000_000_000;
const k = (i: number, l: number, h: number) => ({ t: t0 + i * M, o: 0, c: 0, l, h });
const base: Sig = { id: "x", symbol: "S", direction: "BUY", entry: 100, stop_loss: 98, tp1: 101.5, tp2: 102.5, tp3: 104, tp_reached: 0, created_at: t0 / 1000 };
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const assert = {
  strictEqual: (a: unknown, b: unknown) => { if (a !== b) throw new Error(`attendu ${JSON.stringify(b)}, obtenu ${JSON.stringify(a)}`); },
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
t("summarize : breakeven ≠ victoire, espérance, profit factor, drawdown, série", () => {
  const m = summarize([{ outcome: "tp3" }, { outcome: "sl" }, { outcome: "sl" }, { outcome: "tp1" }, { outcome: "tp2" }, { outcome: "expired" }]);
  assert.strictEqual(m.trades, 5); assert.strictEqual(m.wins, 2); assert.strictEqual(m.breakeven, 1); assert.strictEqual(m.losses, 2); assert.strictEqual(m.unresolved, 1);
  assert.strictEqual(m.win_rate, 40); assert.strictEqual(m.tp1_touch_rate, 60);
  assert.strictEqual(m.total_r, 3.5); assert.strictEqual(m.expectancy_r, 0.7); assert.strictEqual(m.profit_factor, 2.75);
  assert.strictEqual(m.max_drawdown_r, 2); assert.strictEqual(m.max_loss_streak, 2);
});
t("12 paires Forex + Gold + BTC/ETH configurés avec les seuls fournisseurs autorisés", () => {
  assert.strictEqual(SYMBOLS.length, 15);
  assert.strictEqual(SYMBOLS.filter((x) => x.currencies.length === 2 && x.session === "fx").length, 12);
  for (const item of SYMBOLS) for (const source of item.sources) {
    if (!(source.p === "biquote" || source.p === "binance" || source.p === "kraken")) throw new Error(`fournisseur interdit : ${source.p}`);
  }
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
t("Sol fondamental : lecture tolérante du JSON (biais invalide → neutre, confiance bornée, listes tronquées)", () => {
  const v = toFundVerdict("openai:gpt-6-sol", { bias: "HAUSSIER?", confidence: 250, drivers: ["a", "b", "c", "d", "e"], risks: "x", data_gaps: ["g"], reasoning: "ok" });
  assert.deepStrictEqual([v.bias, v.confidence, v.drivers.length, v.risks.length, v.gaps.length], ["neutral", 100, 4, 0, 1]);
  assert.strictEqual(toFundVerdict("p", { bias: "Bullish", confidence: "70" }).bias, "bullish");
});
t("Sol fondamental : alignement calculé par le code selon la direction du moteur", () => {
  assert.deepStrictEqual([fundAlignment("BUY", "bullish"), fundAlignment("BUY", "bearish"), fundAlignment("SELL", "bearish"), fundAlignment("SELL", "bullish"), fundAlignment("BUY", "neutral")], ["aligned", "against", "aligned", "against", "neutral"]);
});
t("Sol fondamental : résumé en français avec biais, alignement et facteurs", () => {
  const v = toFundVerdict("p", { bias: "bearish", confidence: 60, drivers: ["taux réels en hausse"], reasoning: "Dollar soutenu." });
  assert.strictEqual(fundSummary(v, "BUY"), "Biais fondamental baissier (contraire à l'achat). Facteurs : taux réels en hausse. Dollar soutenu.");
});
console.log(`\n${n} tests réussis`);
