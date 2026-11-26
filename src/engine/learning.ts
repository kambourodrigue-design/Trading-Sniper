import type { Analysis } from "./analyze";
import type { Evaluation } from "./types";

/** V1 : collecte passive. Aucun paramètre du moteur n'est modifié ici. */
export async function captureSetup(
  env: Env, signalId: string, source: string, strategy: string,
  score: number, confidence: number | null, ev: Evaluation, an: Analysis, createdAt: number,
): Promise<void> {
  const setup = {
    tags: ev.tags, reasons: ev.reasons, gates: ev.gates,
    h1: { trend: an.h1.trend, rsi: an.h1.rsi, atr: an.h1.atr },
    h4: { trend: an.h4.trend, rsi: an.h4.rsi, atr: an.h4.atr },
    d1: { trend: an.d1.trend, rsi: an.d1.rsi, atr: an.d1.atr },
    structure: { trend: an.structure.trend, event: an.structure.event?.type ?? null, eventDir: an.structure.event?.dir ?? null },
    wyckoff: { phase: an.wyckoff.phase, event: an.wyckoff.event ?? null },
    premiumDiscount: { position: an.pd.pos, equilibrium: an.pd.eq },
    crt: an.crt ? { direction: an.crt.dir, sweep: an.crt.sweepExtreme } : null,
    killzone: an.killzone.active ? an.killzone.name : null,
    patternNames: an.patterns.map(p => ({ name: p.name, direction: p.dir, confirmed: p.confirmed })),
    sweepCount: an.sweeps.length, zoneKinds: an.zones.map(z => z.kind),
  };
  await env.DB.prepare(`INSERT OR IGNORE INTO signal_learning
    (signal_id,symbol,source,direction,strategy,score,confidence,entry,stop_loss,tp1,tp2,tp3,setup_json,outcome,tp_reached,created_at)
    SELECT id,symbol,source,direction,?, ?, ?,entry,stop_loss,tp1,tp2,tp3,?,'open',0,created_at FROM signals WHERE id=?`)
    .bind(strategy, score, confidence, JSON.stringify(setup), signalId).run();
}

/** Garantit une ligne d'apprentissage même si la capture détaillée initiale a échoué.
 * La ligne de secours est explicitement marquée comme minimale : elle ne prétend pas
 * contenir les indicateurs techniques qui n'ont pas pu être capturés à la création. */
export async function ensureLearningRecord(env: Env, signalId?: string): Promise<void> {
  await env.DB.prepare(`INSERT OR IGNORE INTO signal_learning
    (signal_id,symbol,source,direction,strategy,score,confidence,entry,stop_loss,tp1,tp2,tp3,
     setup_json,outcome,tp_reached,r_multiple,created_at,closed_at)
    SELECT id,symbol,source,direction,strategy,score,confidence,entry,stop_loss,tp1,tp2,tp3,
      json_object('capture_quality','recovered_minimal',
        'reasoning',COALESCE(reasoning,''),
        'timeframe',COALESCE(timeframe,''),
        'rr_ratio',COALESCE(rr_ratio,'')),
      CASE
        WHEN outcome='closed' AND tp_reached>=3 THEN 'tp3'
        WHEN outcome='closed' AND tp_reached=2 THEN 'tp2'
        WHEN outcome='closed' AND tp_reached=1 THEN 'tp1'
        ELSE outcome
      END,
      tp_reached,
      CASE
        WHEN outcome='sl' THEN -1.0
        WHEN outcome='tp1' OR (outcome='closed' AND tp_reached=1) THEN ABS(tp1-entry)/NULLIF(ABS(entry-stop_loss),0)
        WHEN outcome='tp2' OR (outcome='closed' AND tp_reached=2) THEN ABS(tp2-entry)/NULLIF(ABS(entry-stop_loss),0)
        WHEN outcome='tp3' OR (outcome='closed' AND tp_reached>=3) THEN ABS(tp3-entry)/NULLIF(ABS(entry-stop_loss),0)
        ELSE NULL
      END,
      created_at,closed_at
    FROM signals WHERE (? IS NULL OR id=?)`).bind(signalId ?? null, signalId ?? null).run();
}

export async function recordLearningOutcome(env: Env, signalId: string, outcome: string, tpReached: number, closedAt: number | null): Promise<void> {
  await ensureLearningRecord(env, signalId);
  await env.DB.prepare(`UPDATE signal_learning SET outcome=?,tp_reached=?,closed_at=?,r_multiple=
    CASE WHEN entry IS NULL OR stop_loss IS NULL OR entry=stop_loss THEN NULL
    WHEN direction='BUY' THEN CASE WHEN ?='sl' THEN -1 WHEN ?='tp1' THEN ABS(tp1-entry)/ABS(entry-stop_loss) WHEN ?='tp2' THEN ABS(tp2-entry)/ABS(entry-stop_loss) WHEN ?='tp3' THEN ABS(tp3-entry)/ABS(entry-stop_loss) ELSE r_multiple END
    ELSE CASE WHEN ?='sl' THEN -1 WHEN ?='tp1' THEN ABS(entry-tp1)/ABS(entry-stop_loss) WHEN ?='tp2' THEN ABS(entry-tp2)/ABS(entry-stop_loss) WHEN ?='tp3' THEN ABS(entry-tp3)/ABS(entry-stop_loss) ELSE r_multiple END END
    WHERE signal_id=?`).bind(outcome,tpReached,closedAt,outcome,outcome,outcome,outcome,outcome,outcome,outcome,outcome,signalId).run();
}

export async function learningReport(env: Env): Promise<{ mode: string; totals: unknown[]; byAsset: unknown[]; byStrategy: unknown[] }> {
  const totals = await env.DB.prepare(`SELECT COUNT(*) total,SUM(CASE WHEN outcome IN ('tp1','tp2','tp3') THEN 1 ELSE 0 END) wins,
    SUM(CASE WHEN outcome='sl' THEN 1 ELSE 0 END) losses,SUM(CASE WHEN outcome='open' THEN 1 ELSE 0 END) open,
    ROUND(AVG(CASE WHEN outcome!='open' THEN r_multiple END),3) avg_r FROM signal_learning`).all();
  const byAsset = await env.DB.prepare(`SELECT symbol,COUNT(*) trades,SUM(CASE WHEN outcome IN ('tp1','tp2','tp3') THEN 1 ELSE 0 END) wins,
    SUM(CASE WHEN outcome='sl' THEN 1 ELSE 0 END) losses,ROUND(AVG(CASE WHEN outcome!='open' THEN r_multiple END),3) avg_r
    FROM signal_learning GROUP BY symbol ORDER BY trades DESC`).all();
  const byStrategy = await env.DB.prepare(`SELECT strategy,COUNT(*) trades,SUM(CASE WHEN outcome IN ('tp1','tp2','tp3') THEN 1 ELSE 0 END) wins,
    SUM(CASE WHEN outcome='sl' THEN 1 ELSE 0 END) losses,ROUND(AVG(CASE WHEN outcome!='open' THEN r_multiple END),3) avg_r
    FROM signal_learning GROUP BY strategy ORDER BY trades DESC`).all();
  return { mode: "observation", totals: totals.results, byAsset: byAsset.results, byStrategy: byStrategy.results };
}
