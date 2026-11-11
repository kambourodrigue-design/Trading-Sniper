// Backtest des RÈGLES du moteur (sans IA) sur l'historique Yahoo Finance : à lancer sur TON ordinateur (Node 18+, connexion Internet).
//   npm install
//   npx tsx scripts/backtest.ts                                  # 4 actifs, 3 profils
//   npx tsx scripts/backtest.ts --symbols XAU/USD --profiles balanced,active
//   npx tsx scripts/backtest.ts --synthetic                      # test hors-ligne sur données simulées (sans valeur statistique)
// Mesure, pour chaque profil : combien de setups le moteur aurait validés, leur répartition de résultats et ce qui bloque le plus.
// Hypothèses : décision à la clôture de chaque bougie H1 ; entrée au prix de clôture ; TP/SL testés sur bougies H1 (stop compté en premier si doute) ;
// 1 seul trade ouvert par actif jusqu'à son résultat (ou 120 h) ; pas de spread, pas de news, pas d'IA ; Yahoo ≈ indices « cash » (pas les CFD du courtier).
import { SYMBOLS, PROFILES, CFG } from "../src/engine/config";
import { buildAnalysis, evaluate } from "../src/engine/analyze";
import { isMarketOpen } from "../src/engine/sessions";
import { evaluateOutcome, Sig } from "../src/engine/outcome";
import { parseYahoo, aggregate } from "../src/lib/prices";
import type { Candle, Dir } from "../src/engine/types";

const H = 3_600_000, D = 86_400_000;
const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };
const synthetic = process.argv.includes("--synthetic");
const wantSymbols = (arg("symbols") ?? SYMBOLS.map((s) => s.symbol).join(",")).split(",");
const wantProfiles = (arg("profiles") ?? "strict,balanced,active").split(",");

async function yahooHist(id: string, interval: string, range: string): Promise<Candle[]> {
  const r = await fetch(`https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(id)}?interval=${interval}&range=${range}&includePrePost=false`, { headers: { "User-Agent": "Mozilla/5.0" } });
  if (!r.ok) throw new Error(`Yahoo ${id} HTTP ${r.status}`);
  return parseYahoo(await r.json());
}

function synth(n: number): Candle[] {
  let seed = 11; const rnd = () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296;
  const out: Candle[] = []; let p = 2000, drift = 0.5; const t0 = Date.UTC(2024, 0, 1);
  for (let i = 0; i < n; i++) {
    if (i % 240 === 0) drift = (rnd() > 0.4 ? 1 : -1) * (0.4 + rnd() * 0.5);
    const ph = i % 40, imp = ph < 12 ? 1.0 : ph < 28 ? -0.45 : 0.25;
    const o = p, c = o + drift * imp * 6 + (rnd() - 0.5) * 4;
    out.push({ t: t0 + i * H, o, h: Math.max(o, c) + rnd() * 2.5, l: Math.min(o, c) - rnd() * 2.5, c }); p = c;
  }
  return out;
}

interface Row { n: number; res: Record<string, number>; r: number; blockers: Record<string, number>; evals: number }

async function run(symbol: string) {
  const cfg = SYMBOLS.find((s) => s.symbol === symbol);
  if (!cfg) { console.log(`Actif inconnu : ${symbol}`); return; }
  let h1All: Candle[], d1All: Candle[];
  if (synthetic) { h1All = synth(24 * 700); d1All = aggregate(h1All, D, Infinity); }
  else {
    const id = cfg.sources.find((s) => s.p === "yahoo")?.id;
    if (!id) { console.log(`${symbol} : pas de source Yahoo`); return; }
    process.stdout.write(`${symbol} : téléchargement de l'historique… `);
    [h1All, d1All] = [await yahooHist(id, "60m", "2y"), await yahooHist(id, "1d", "5y")];
    console.log(`${h1All.length} bougies H1, ${d1All.length} D1`);
  }
  const rows: Record<string, Row> = {}, busy: Record<string, number> = {};
  for (const p of wantProfiles) { rows[p] = { n: 0, res: {}, r: 0, blockers: {}, evals: 0 }; busy[p] = 0; }
  let firstT = 0, lastT = 0, bars = 0;
  for (let i = 400; i < h1All.length - 1; i++) {
    const tClose = h1All[i].t + H;
    if (!isMarketOpen(cfg, tClose)) continue;
    const h1 = h1All.slice(i - 319, i + 1);
    const h4 = aggregate(h1All.slice(Math.max(0, i - 1300), i + 1), 4 * H, tClose).slice(-260);
    const d1 = d1All.filter((k) => k.t + D <= tClose).slice(-260);
    if (h4.length < 210 || d1.length < 210) continue;
    if (!firstT) firstT = tClose; lastT = tClose; bars++;
    const an = buildAnalysis(symbol, h1, h4, d1);
    for (const pn of wantProfiles) {
      const prof = PROFILES[pn]; if (!prof) continue;
      const row = rows[pn], open = tClose < busy[pn];
      const evals = (["BUY", "SELL"] as Dir[]).map((d) => evaluate(an, d, { newsBlock: null, marketOpen: true, hasOpen: open, p: prof }))
        .sort((a, b) => Number(b.passed) - Number(a.passed) || b.score - a.score);
      const best = evals[0]; row.evals++;
      if (!best.passed) { if (!open) for (const g of best.gates) if (!g.ok) row.blockers[g.name.replace(/ ≥ .*/, "")] = (row.blockers[g.name.replace(/ ≥ .*/, "")] ?? 0) + 1; continue; }
      const sig: Sig = { id: "b", symbol, direction: best.dir, entry: best.entry, stop_loss: best.sl, tp1: best.tps[0], tp2: best.tps[1], tp3: best.tps[2], tp_reached: 0, created_at: tClose / 1000 };
      const horizon = tClose + CFG.expiryHours * H;
      const fut = h1All.slice(i + 1).filter((k) => k.t < horizon);
      const o = evaluateOutcome(sig, fut, horizon + 2 * H, H);
      busy[pn] = o.at ? o.at + H : horizon;
      row.n++; row.res[o.outcome] = (row.res[o.outcome] ?? 0) + 1;
      row.r += o.outcome === "sl" ? -1 : o.outcome === "tp2" ? CFG.tpRR[0] : o.outcome === "tp3" ? CFG.tpRR[2] : 0; // TP1 puis stop à l'entrée = 0 R ; TP2 puis stop à TP1 = +1,5 R
    }
  }
  const weeks = Math.max(1, (lastT - firstT) / (7 * D)) * (cfg.session === "us" ? 1 : 1);
  console.log(`\n=== ${symbol} — ${bars} décisions sur ${weeks.toFixed(0)} semaines ===`);
  for (const pn of wantProfiles) {
    const r = rows[pn]; if (!r) continue;
    const w = (r.res.tp1 ?? 0) + (r.res.tp2 ?? 0) + (r.res.tp3 ?? 0), l = r.res.sl ?? 0;
    const top = Object.entries(r.blockers).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${Math.round((100 * v) / Math.max(1, r.evals))} %`).join(", ");
    console.log(`[${pn.padEnd(8)}] setups : ${String(r.n).padStart(3)} (${(r.n / weeks).toFixed(2)}/semaine) | TP1+ : ${w}  SL : ${l}  expirés : ${r.res.expired ?? 0}${w + l ? `  → taux TP1 ${Math.round((100 * w) / (w + l))} %` : ""} | R total ${r.r.toFixed(1)}${r.n ? ` (${(r.r / r.n).toFixed(2)} R/trade)` : ""}`);
    console.log(`           blocages les plus fréquents : ${top || "—"}`);
  }
}

(async () => { for (const s of wantSymbols) { try { await run(s.trim()); } catch (e) { console.log(`${s} : ${(e as Error).message}`); } } })();
