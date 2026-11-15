import { Candle } from "./types";
import { CFG } from "./config";

export interface Sig { id: string; symbol: string; direction: string; entry: number; stop_loss: number; tp1: number | null; tp2: number | null; tp3: number | null; tp_reached: number; created_at: number }

// Résultat d'un trade à partir des bougies courtes. `at` = début de la bougie qui a clos le trade (pour le backtest).
export function evaluateOutcome(s: Sig, c15: Candle[], now: number, candleMs = 900_000): { tp: number; outcome: string; at?: number } {
  const buy = s.direction === "BUY", lv = [s.tp1, s.tp2, s.tp3];
  let tp = s.tp_reached;
  // Après TP1 le SL passe à l'entrée, après TP2 il passe à TP1.
  let sl = tp === 0 ? s.stop_loss : tp === 1 ? s.entry : (lv[tp - 2] as number);
  for (const k of c15) {
    if (k.t < s.created_at * 1000) continue;
    if (k.t + candleMs > now) break;
    if (buy ? k.l <= sl : k.h >= sl) return { tp, outcome: tp === 0 ? "sl" : `tp${tp}`, at: k.t }; // ordre pessimiste : le stop est testé en premier
    for (;;) {
      const next = lv[tp];
      if (next == null || !(buy ? k.h >= next : k.l <= next)) break;
      tp++;
      if (tp === 3) return { tp, outcome: "tp3", at: k.t };
      sl = tp === 1 ? s.entry : (lv[tp - 2] as number);
    }
  }
  if (now - s.created_at * 1000 > CFG.expiryHours * 3_600_000) return { tp, outcome: tp === 0 ? "expired" : `tp${tp}` };
  return { tp, outcome: "open" };
}
