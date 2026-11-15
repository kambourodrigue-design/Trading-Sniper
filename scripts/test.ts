// Tests unitaires légers (aucune dépendance) : npm test
import { evaluateOutcome, Sig } from "../src/engine/outcome";
import { summarize, rOf } from "../src/engine/metrics";

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
console.log(`\n${n} tests réussis`);
