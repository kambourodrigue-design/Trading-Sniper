import { adaptiveLearningReport } from "./adaptive-learning";
/** Lucide Sniper V2 progressive: shadow recommendations only. */
export interface LearningV2Row {
  symbol: string; strategy: string | null; trades: number; wins: number;
  losses: number; avg_r: number | null; win_rate?: number | null;
}
export interface LearningV2Recommendation extends LearningV2Row {
  status: "insufficient_data" | "promising" | "underperforming" | "neutral";
  confidence: "low" | "medium" | "high";
  rationale: string;
}
const MIN_TRADES = 30;
function wilsonLower(wins: number, n: number): number {
  if (!n) return 0;
  const z = 1.96, p = wins / n, z2 = z * z;
  return (p + z2 / (2 * n) - z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n)) / (1 + z2 / n);
}
export async function learningV2Report(env: Env) {
  const result = await env.DB.prepare(`
    SELECT symbol, COALESCE(NULLIF(strategy,''),'Non classé') strategy,
      COUNT(*) trades,
      SUM(CASE WHEN outcome IN ('tp1','tp2','tp3') THEN 1 ELSE 0 END) wins,
      SUM(CASE WHEN outcome='sl' THEN 1 ELSE 0 END) losses,
      ROUND(AVG(r_multiple),3) avg_r
    FROM shadow_signals
    WHERE outcome IN ('tp1','tp2','tp3','sl') AND r_multiple IS NOT NULL
    GROUP BY symbol, COALESCE(NULLIF(strategy,''),'Non classé')
    ORDER BY symbol, trades DESC
  `).all<LearningV2Row>();
  const recommendations: LearningV2Recommendation[] = (result.results ?? []).map(row => {
    const n = Number(row.trades), wins = Number(row.wins), avgR = Number(row.avg_r ?? 0);
    const lower = wilsonLower(wins, n);
    let status: LearningV2Recommendation["status"] = "neutral";
    let rationale = "Échantillon suffisant, mais aucun avantage statistique clair n'est établi.";
    if (n < MIN_TRADES) {
      status = "insufficient_data";
      rationale = `Seulement ${n}/${MIN_TRADES} trades clôturés : continuer l'observation.`;
    } else if (avgR >= 0.15 && lower >= 0.35) {
      status = "promising";
      rationale = `Espérance moyenne positive (${avgR.toFixed(2)}R) et borne prudente du taux de réussite à ${(lower * 100).toFixed(1)}%.`;
    } else if (avgR <= -0.10) {
      status = "underperforming";
      rationale = `Espérance moyenne négative (${avgR.toFixed(2)}R) : configuration à surveiller, pas à supprimer automatiquement.`;
    }
    return { ...row, trades: n, wins, losses: Number(row.losses), avg_r: row.avg_r === null ? null : avgR,
      win_rate: n ? Math.round(wins / n * 1000) / 10 : null, status,
      confidence: n >= 100 ? "high" : n >= MIN_TRADES ? "medium" : "low", rationale };
  });
  const totals = await env.DB.prepare(`
    SELECT COUNT(*) trades,
      SUM(CASE WHEN outcome IN ('tp1','tp2','tp3') THEN 1 ELSE 0 END) wins,
      SUM(CASE WHEN outcome='sl' THEN 1 ELSE 0 END) losses,
      ROUND(AVG(r_multiple),3) avg_r
    FROM shadow_signals WHERE outcome IN ('tp1','tp2','tp3','sl') AND r_multiple IS NOT NULL
  `).first();
  const adaptive = await adaptiveLearningReport(env);
  return { version: 2, mode: "shadow_recommendation_only", live_parameters_modified: false, adaptive,
    minimum_trades_per_bucket: MIN_TRADES,
    safety: ["Aucun changement automatique des signaux", "Résultats clôturés uniquement",
      "Minimum de 30 trades par actif/configuration", "Validation hors-échantillon obligatoire avant activation"],
    totals, recommendations };
}
