import { CFG } from "./config";

// Résultat en multiples de R (risque initial) pour une position gérée comme le moteur : stop à l'entrée après TP1, à TP1 après TP2.
//   sl → −1 ; tp1 (puis stop à l'entrée) → 0 ; tp2 (puis stop à TP1) → +TP1 ; tp3 → +TP3 ; expired / closed / open → 0 (non réalisé, exclu des taux).
// `costR` = coût (spread + slippage) exprimé en R, retranché de chaque trade clos.
export function rOf(outcome: string, costR = 0): number {
  const base = outcome === "sl" ? -1 : outcome === "tp2" ? CFG.tpRR[0] : outcome === "tp3" ? CFG.tpRR[2] : 0;
  return base - (isClosed(outcome) ? costR : 0);
}
export const isClosed = (o: string) => o === "sl" || o === "tp1" || o === "tp2" || o === "tp3";

export interface Summary {
  trades: number; wins: number; breakeven: number; losses: number; unresolved: number;
  win_rate: number | null;        // % de trades clos avec R > 0 (le breakeven n'est PAS une victoire)
  tp1_touch_rate: number | null;  // % de trades clos ayant touché au moins TP1 (ancien « taux TP1 »)
  total_r: number; expectancy_r: number | null; profit_factor: number | null;
  avg_win_r: number | null; avg_loss_r: number | null;
  max_drawdown_r: number; max_loss_streak: number;
}
const r2 = (x: number) => Math.round(x * 100) / 100;

// Résumé à partir d'une suite ordonnée de {outcome, costR} (ordre chronologique : nécessaire pour le drawdown et les séries).
export function summarize(seq: Array<{ outcome: string; costR?: number }>): Summary {
  let wins = 0, be = 0, losses = 0, unresolved = 0, total = 0, gw = 0, gl = 0, peak = 0, dd = 0, streak = 0, maxStreak = 0, touched = 0;
  for (const t of seq) {
    if (!isClosed(t.outcome)) { unresolved++; continue; }
    const r = rOf(t.outcome, t.costR ?? 0);
    total += r;
    if (t.outcome !== "sl") touched++;
    if (r > 0) { wins++; gw += r; streak = 0; } else if (r < 0) { losses++; gl += -r; streak++; maxStreak = Math.max(maxStreak, streak); } else { be++; streak = 0; }
    peak = Math.max(peak, total); dd = Math.max(dd, peak - total);
  }
  const closed = wins + be + losses;
  return {
    trades: closed, wins, breakeven: be, losses, unresolved,
    win_rate: closed ? Math.round((100 * wins) / closed) : null,
    tp1_touch_rate: closed ? Math.round((100 * touched) / closed) : null,
    total_r: r2(total), expectancy_r: closed ? r2(total / closed) : null,
    profit_factor: gl > 0 ? r2(gw / gl) : gw > 0 ? null : null,
    avg_win_r: wins ? r2(gw / wins) : null, avg_loss_r: losses ? r2(-gl / losses) : null,
    max_drawdown_r: r2(dd), max_loss_streak: maxStreak,
  };
}

// Version à partir de simples comptages par résultat (sans ordre : pas de drawdown ni de série, l'espérance reste exacte).
export function summarizeCounts(c: Record<string, number>): Omit<Summary, "max_drawdown_r" | "max_loss_streak"> {
  const seq: Array<{ outcome: string }> = [];
  for (const [o, n] of Object.entries(c)) for (let i = 0; i < n; i++) seq.push({ outcome: o });
  const { max_drawdown_r: _a, max_loss_streak: _b, ...rest } = summarize(seq);
  return rest;
}
