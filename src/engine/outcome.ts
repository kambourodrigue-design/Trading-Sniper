import { Candle } from "./types";
import { CFG } from "./config";

export interface Sig { id: string; symbol: string; direction: string; entry: number; stop_loss: number; tp1: number | null; tp2: number | null; tp3: number | null; tp_reached: number; created_at: number; progress_at?: number | null }
// progress_at = début (ms) de la bougie M15/H1 où le dernier palier (TP1/TP2) a été atteint ; null = aucun palier ou ancienne ligne.

// Résultat d'un trade à partir des bougies courtes.
//   at         = début de la bougie qui a clos le trade (backtest) ;
//   progressAt = début de la bougie du dernier palier atteint (à stocker : le prochain passage repart APRÈS cette bougie,
//                sinon un repli vers l'entrée survenu avant TP1 déclencherait à tort le stop suiveur).
export function evaluateOutcome(s: Sig, c15: Candle[], now: number, candleMs = 900_000): { tp: number; outcome: string; at?: number; progressAt?: number } {
  const buy = s.direction === "BUY", lv = [s.tp1, s.tp2, s.tp3];
  let tp = s.tp_reached;
  // Après TP1 le SL passe à l'entrée, après TP2 il passe à TP1.
  let sl = tp === 0 ? s.stop_loss : tp === 1 ? s.entry : (lv[tp - 2] as number);
  let progressAt = s.progress_at ?? undefined;
  const from = Math.max(s.created_at * 1000, s.progress_at != null ? s.progress_at + candleMs : 0);
  for (const k of c15) {
    if (k.t < from) continue;
    if (k.t + candleMs > now) break;
    if (buy ? k.l <= sl : k.h >= sl) return { tp, outcome: tp === 0 ? "sl" : `tp${tp}`, at: k.t }; // ordre pessimiste : le stop est testé en premier
    for (;;) {
      const next = lv[tp];
      if (next == null || !(buy ? k.h >= next : k.l <= next)) break;
      tp++; progressAt = k.t;
      if (tp === 3) return { tp, outcome: "tp3", at: k.t, progressAt };
      sl = tp === 1 ? s.entry : (lv[tp - 2] as number);
    }
  }
  if (now - s.created_at * 1000 > CFG.expiryHours * 3_600_000) return { tp, outcome: tp === 0 ? "expired" : `tp${tp}`, progressAt };
  return { tp, outcome: "open", progressAt };
}
