/**
 * Adaptive learning V2: chronological train/holdout diagnostics.
 * It learns from closed shadow outcomes and stores evidence-backed proposals only.
 * It deliberately never changes detector thresholds or Origin/live settings.
 */
export interface AdaptiveInsight {
  symbol: string; strategy: string; total_trades: number; train_trades: number;
  holdout_trades: number; train_avg_r: number | null; holdout_avg_r: number | null;
  status: "insufficient_data" | "stable_promising" | "degraded" | "inconclusive";
  recommendation: string;
}
const MIN_TOTAL = 30;
const MIN_HOLDOUT = 10;
export function evaluateAdaptiveBucket(rows: Array<{r_multiple:number; created_at:number}>, symbol:string, strategy:string): AdaptiveInsight {
  const sorted=[...rows].filter(x=>Number.isFinite(x.r_multiple) && Number.isFinite(x.created_at)).sort((a,b)=>a.created_at-b.created_at);
  const n=sorted.length;
  const split=Math.floor(n*0.7);
  const train=sorted.slice(0,split), hold=sorted.slice(split);
  const avg=(a:typeof sorted)=>a.length ? a.reduce((s,x)=>s+x.r_multiple,0)/a.length : null;
  const tr=avg(train), ho=avg(hold);
  let status:AdaptiveInsight["status"]="insufficient_data";
  let recommendation=`Échantillon insuffisant : ${n}/${MIN_TOTAL} trades clôturés requis, dont au moins ${MIN_HOLDOUT} en validation chronologique.`;
  if(n>=MIN_TOTAL && hold.length>=MIN_HOLDOUT && tr!==null && ho!==null){
    if(ho < 0 || ho < tr-0.20){ status="degraded"; recommendation=`Dégradation hors-échantillon (${ho.toFixed(2)}R contre ${tr.toFixed(2)}R en apprentissage). Tester un filtre plus strict en shadow, sans modifier les paramètres actifs.`; }
    else if(ho >= 0.15 && ho >= tr-0.10){ status="stable_promising"; recommendation=`Résultat hors-échantillon stable (${ho.toFixed(2)}R). Conserver la configuration candidate et poursuivre la validation sur une autre période.`; }
    else { status="inconclusive"; recommendation=`Résultat hors-échantillon non concluant (${ho.toFixed(2)}R). Ne pas ajuster les paramètres.`; }
  }
  return {symbol,strategy,total_trades:n,train_trades:train.length,holdout_trades:hold.length,
    train_avg_r:tr===null?null:Number(tr.toFixed(3)),holdout_avg_r:ho===null?null:Number(ho.toFixed(3)),status,recommendation};
}
export async function refreshAdaptiveLearning(env:Env){
  const q=await env.DB.prepare(`SELECT symbol,COALESCE(NULLIF(strategy,''),'Non classé') strategy,r_multiple,created_at
    FROM shadow_signals WHERE outcome IN ('tp1','tp2','tp3','sl') AND r_multiple IS NOT NULL
    ORDER BY symbol,strategy,created_at`).all<{symbol:string;strategy:string;r_multiple:number;created_at:number}>();
  const resultRows=q.results??[];
  const groups=new Map<string,typeof resultRows>();
  for(const row of resultRows{const key=row.symbol+'\u0000'+row.strategy;groups.set(key,[...(groups.get(key)??[]),row]);}
  const insights:AdaptiveInsight[]=[];
  for(const rows of groups.values()){
    const first=rows[0]; const insight=evaluateAdaptiveBucket(rows,first.symbol,first.strategy); insights.push(insight);
    await env.DB.prepare(`INSERT INTO v2_adaptive_insights(symbol,strategy,total_trades,train_trades,holdout_trades,train_avg_r,holdout_avg_r,status,recommendation,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(symbol,strategy) DO UPDATE SET total_trades=excluded.total_trades,train_trades=excluded.train_trades,holdout_trades=excluded.holdout_trades,train_avg_r=excluded.train_avg_r,holdout_avg_r=excluded.holdout_avg_r,status=excluded.status,recommendation=excluded.recommendation,updated_at=excluded.updated_at`)
      .bind(insight.symbol,insight.strategy,insight.total_trades,insight.train_trades,insight.holdout_trades,insight.train_avg_r,insight.holdout_avg_r,insight.status,insight.recommendation,Math.floor(Date.now()/1000)).run();
  }
  return {mode:"shadow_recommendation_only",automatic_parameter_changes:false,origin_modified:false,insights};
}
export async function adaptiveLearningReport(env:Env){
  const rows=await env.DB.prepare(`SELECT symbol,strategy,total_trades,train_trades,holdout_trades,train_avg_r,holdout_avg_r,status,recommendation,updated_at FROM v2_adaptive_insights ORDER BY symbol,strategy`).all();
  return {mode:"shadow_recommendation_only",automatic_parameter_changes:false,origin_modified:false,minimum_total_trades:MIN_TOTAL,minimum_holdout_trades:MIN_HOLDOUT,insights:rows.results??[]};
}
