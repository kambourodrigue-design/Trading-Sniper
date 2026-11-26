import { SYMBOLS, CFG, PROFILES } from "./config";
import { buildAnalysis, evaluate } from "./analyze";
import { getBundle, getOutcomeCandles } from "../lib/prices";
import { getCalendar, newsBlock, fundamentalBias } from "../lib/macro";
import { getIntermarket } from "../lib/intermarket";
import { isMarketOpen } from "./sessions";
import { evaluateOutcome, Sig } from "./outcome";
import { newId } from "../lib/auth";
import type { Dir } from "./types";
import { cacheGet, cacheSet } from "../lib/cache";

const HOUR = 3_600_000;

/**
 * V2 shadow is deliberately isolated from the live signal pipeline:
 * it writes only shadow_signals, never signals, notifications, KV live cache,
 * analysis_state or Origin learning records.
 */
export async function runShadowEngine(env: Env, opts: { force?: boolean; symbol?: string } = {}) {
  const now = Date.now();
  const cal = await getCalendar(env);
  const results: Array<{symbol:string;status:string;score:number;note:string}> = [];
  for (const s of SYMBOLS) {
    if (opts.symbol && opts.symbol !== s.symbol) continue;
    if (!opts.force && !isMarketOpen(s, now)) continue;
    const hour = Math.floor(now / HOUR);
    const seen = await env.DB.prepare("SELECT symbol FROM shadow_runs WHERE symbol=? AND bucket_hour=?").bind(s.symbol,hour).first();
    if (seen) continue;
    try {
      const maxAge = s.session === "us" ? 9_000_000 : 7_500_000;
      const bundle = await getBundle(env,s,now,maxAge);
      const {m15,h1,h4,d1} = bundle;
      if (!h1.length || now-h1[h1.length-1].t>maxAge || m15.length<40 || now-m15[m15.length-1].t>30*60_000) {
        results.push({symbol:s.symbol,status:"stale",score:0,note:"Données de marché trop anciennes pour l'observation V2."});
        await env.DB.prepare("INSERT OR IGNORE INTO shadow_runs(symbol,bucket_hour,status,score,created_at) VALUES(?,?,'stale',0,?)").bind(s.symbol,hour,Math.floor(now/1000)).run();
        continue;
      }
      const an = buildAnalysis(s.symbol,h1,h4,d1,now,m15);
      const open = await env.DB.prepare("SELECT COUNT(*) n FROM shadow_signals WHERE symbol=? AND outcome='open'").bind(s.symbol).first<{n:number}>();
      const inter = await getIntermarket(env,s,now);
      const fundamental = fundamentalBias(cal.events,s.symbol,now);
      const combinedBias = Math.max(-1,Math.min(1,0.5*inter.bias+0.5*fundamental.bias));
      const ctx = {
        inter: combinedBias,
        newsBlock: cal.ok ? newsBlock(cal.events,s.currencies,now,CFG.newsBeforeMin,CFG.newsAfterMin) : "calendrier économique indisponible : observation suspendue",
        marketOpen: isMarketOpen(s,now),
        hasOpen: (open?.n ?? 0)>0,
        p: PROFILES.strict,
      };
      const evals = (["BUY","SELL"] as Dir[]).map(d=>evaluate(an,d,ctx)).sort((a,b)=>Number(b.passed)-Number(a.passed)||b.score-a.score);
      const best = evals[0];
      if (!best?.passed) {
        results.push({symbol:s.symbol,status:"rejected",score:best?.score??0,note:best?.gates.filter(g=>!g.ok).map(g=>g.name).join(", ")||"Aucun setup V2 strict."});
        await env.DB.prepare("INSERT OR IGNORE INTO shadow_runs(symbol,bucket_hour,status,score,created_at) VALUES(?,?, 'rejected',?,?)").bind(s.symbol,hour,best?.score??0,Math.floor(now/1000)).run();
        continue;
      }
      const id = newId();
      await env.DB.prepare(`INSERT OR IGNORE INTO shadow_signals
        (id,symbol,direction,entry,stop_loss,tp1,tp2,tp3,score,strategy,reasoning,outcome,tp_reached,r_multiple,created_at,bucket_hour)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,'open',0,NULL,?,?)`)
        .bind(id,s.symbol,best.dir,best.entry,best.sl,best.tps[0],best.tps[1],best.tps[2],best.score,best.tags.join(" + "),best.reasons.join(" · ").slice(0,1200),Math.floor(now/1000),hour).run();
      await env.DB.prepare("INSERT OR IGNORE INTO shadow_runs(symbol,bucket_hour,status,score,created_at) VALUES(?,?, 'candidate',?,?)").bind(s.symbol,hour,best.score,Math.floor(now/1000)).run();
      results.push({symbol:s.symbol,status:"shadow_candidate",score:best.score,note:"Candidat virtuel V2 enregistré ; aucun signal réel publié."});
    } catch(e) {
      const note=String((e as Error).message??e).slice(0,250);
      console.error("V2 shadow",s.symbol,note);
      results.push({symbol:s.symbol,status:"error",score:0,note});
      await env.DB.prepare("INSERT OR IGNORE INTO shadow_runs(symbol,bucket_hour,status,score,created_at) VALUES(?,?, 'error',0,?)").bind(s.symbol,hour,Math.floor(now/1000)).run().catch(()=>{});
    }
  }
  const lastTrack=Number(await cacheGet(env,"shadow:track:last")??0);
  if (now-lastTrack>=15*60_000) {
    await cacheSet(env,"shadow:track:last",String(now),30*60);
    await trackShadowOutcomes(env,now);
  }
  return results;
}

async function trackShadowOutcomes(env: Env, now: number): Promise<void> {
  const rows=(await env.DB.prepare("SELECT id,symbol,direction,entry,stop_loss,tp1,tp2,tp3,tp_reached,created_at,progress_at FROM shadow_signals WHERE outcome='open' AND entry IS NOT NULL AND stop_loss IS NOT NULL AND tp1 IS NOT NULL").all<Sig>()).results;
  const grouped=new Map<string,Sig[]>();
  for(const row of rows) grouped.set(row.symbol,[...(grouped.get(row.symbol)??[]),row]);
  for(const [symbol,sigs] of grouped) {
    const cfg=SYMBOLS.find(x=>x.symbol===symbol); if(!cfg) continue;
    try {
      const history=await getOutcomeCandles(env,cfg,Math.min(...sigs.map(x=>x.created_at))*1000-HOUR,now);
      for(const sig of sigs) {
        const result=evaluateOutcome(sig,history.candles,now,history.candleMs);
        if(result.outcome!=="open" || result.tp!==sig.tp_reached) {
          const risk=Math.abs(sig.entry-sig.stop_loss);
          const target=result.outcome==="sl" ? (result.tp===2 ? sig.tp1 : null) : result.tp>=3 ? sig.tp3 : result.tp===2 ? sig.tp2 : result.tp===1 ? sig.tp1 : null;
          const signedReward=target==null || !risk ? null : (sig.direction==="BUY" ? target-sig.entry : sig.entry-target)/risk;
          const r=result.outcome==="sl" ? (result.tp===0 ? -1 : result.tp===1 ? 0 : signedReward) : result.outcome==="tp1" || result.outcome==="tp2" || result.outcome==="tp3" ? signedReward : null;
          await env.DB.prepare("UPDATE shadow_signals SET tp_reached=?,outcome=?,progress_at=?,closed_at=CASE WHEN ?='open' THEN NULL ELSE ? END,r_multiple=CASE WHEN ?='open' THEN NULL ELSE ? END WHERE id=?")
            .bind(result.tp,result.outcome,result.progressAt??sig.progress_at??null,result.outcome,Math.floor(now/1000),result.outcome,r,sig.id).run();
        }
      }
    } catch(e) { console.error("V2 shadow outcome",symbol,(e as Error).message); }
  }
}

export async function shadowReport(env: Env) {
  const totals=await env.DB.prepare("SELECT COUNT(*) total,SUM(CASE WHEN outcome='open' THEN 1 ELSE 0 END) open,SUM(CASE WHEN outcome IN ('tp1','tp2','tp3') THEN 1 ELSE 0 END) wins,SUM(CASE WHEN outcome='sl' THEN 1 ELSE 0 END) losses,ROUND(AVG(r_multiple),3) avg_r FROM shadow_signals").first();
  const bySymbol=await env.DB.prepare("SELECT symbol,COUNT(*) total,SUM(CASE WHEN outcome='open' THEN 1 ELSE 0 END) open,SUM(CASE WHEN outcome IN ('tp1','tp2','tp3') THEN 1 ELSE 0 END) wins,SUM(CASE WHEN outcome='sl' THEN 1 ELSE 0 END) losses,ROUND(AVG(r_multiple),3) avg_r FROM shadow_signals GROUP BY symbol ORDER BY symbol").all();
  const recent=await env.DB.prepare("SELECT id,symbol,direction,entry,stop_loss,tp1,tp2,tp3,score,strategy,outcome,tp_reached,r_multiple,created_at,closed_at FROM shadow_signals ORDER BY created_at DESC LIMIT 50").all();
  return {version:2,mode:"shadow_only",live_engine:"origin",live_signals_modified:false,notifications_enabled:false,totals,bySymbol:bySymbol.results,recent:recent.results};
}
