// Backtest des règles du moteur sans IA. Les API gratuites ont des historiques limités : le test dépend de la profondeur réellement retournée par le fournisseur.
//   npm install
//   npx tsx scripts/backtest.ts                                  # 15 actifs, 4 profils ; lit ./historical d'abord
//   npx tsx scripts/backtest.ts --history-dir ./historical --live # sorties M15 si M15/H4 locaux suffisants
//   npx tsx scripts/backtest.ts --symbols XAU/USD --profiles balanced,active
//   npx tsx scripts/backtest.ts --synthetic                      # test hors-ligne sur données simulées (sans valeur statistique)
//   Options : --cost-atr 0.04 (coût/trade) · --split 0.6 (walk-forward réglage/test) · --live (sorties M15, fenêtre courte)
// Mesure, pour chaque profil : combien de setups le moteur aurait validés, leur répartition de résultats et ce qui bloque le plus.
// Hypothèses : décision à la clôture de chaque bougie H1 ; entrée au prix de clôture ; TP/SL testés sur bougies H1 (stop compté en premier si doute) ;
// 1 seul trade ouvert par actif jusqu'à son résultat (ou 120 h) ; pas de spread, pas de news, pas d'IA.
import { SYMBOLS, PROFILES, CFG } from "../src/engine/config";
import { buildAnalysis, evaluate } from "../src/engine/analyze";
import { isMarketOpen } from "../src/engine/sessions";
import { evaluateOutcome, Sig } from "../src/engine/outcome";
import { summarize, rOf } from "../src/engine/metrics";
import { aggregate, biquoteCandles, binanceCandles, krakenCandles } from "../src/lib/prices";
import type { Src } from "../src/engine/config";
import type { Candle, Dir } from "../src/engine/types";

const H = 3_600_000, D = 86_400_000;
const arg = (k: string) => { const i = process.argv.indexOf(`--${k}`); return i > -1 ? process.argv[i + 1] : undefined; };
const synthetic = process.argv.includes("--synthetic");
const wantSymbols = (arg("symbols") ?? SYMBOLS.map((s) => s.symbol).join(",")).split(",");
// Coût d'exécution (spread + slippage) par trade, en fraction d'ATR H1 (défaut 0,04 ; --cost-atr 0 pour l'ignorer). Converti en R pour chaque trade.
const costAtr = Number(arg("cost-atr") ?? 0.04);
// Mode de sortie optionnel : H1 par défaut pour couvrir toute la fenêtre historique disponible ; M15 avec --live.
//   - H4 natif biquote (comme le moteur) au lieu d'un H4 reconstruit depuis le H1 ;
//   - --live : sorties TP/SL rejouées en M15 (fenêtre courte) au lieu de H1.
// Walk-forward : --split 0.6 sépare l'historique en 2 périodes (réglage / test hors échantillon) et affiche les métriques de chacune.
const live = !synthetic && process.argv.includes("--live");
const split = Number(arg("split") ?? 0.6);
const wantProfiles = (arg("profiles") ?? "strict,balanced,active,adaptive").split(",");
const outputDir = arg("out") ?? "./backtest-results";
const historyDir = arg("history-dir") ?? "./historical";
const reportRows: Array<Record<string, unknown>> = [];
const tradeRows: Array<Record<string, unknown>> = [];

// Télécharge l’historique disponible. biquote expose une fenêtre glissante limitée ; ce test évalue uniquement les bougies réellement disponibles.
async function providerHist(src: Src, interval: "15m" | "1h" | "4h" | "1d", fromMs: number, toMs: number): Promise<Candle[]> {
  if (src.p === "biquote") return biquoteCandles(src, interval, fromMs, toMs);
  if (src.p === "kraken") return krakenCandles(src, interval, fromMs, toMs);
  return binanceCandles(src, interval, fromMs, toMs);
}

async function localCandles(symbol: string, timeframe: "M15" | "H1" | "H4" | "D1"): Promise<Candle[] | null> {
  const fs = await import("node:fs/promises");
  const fileSymbol = symbol.replace("/", "").replace("BTCUSD", "BTCUSDT").replace("ETHUSD", "ETHUSDT");
  const path = `${historyDir.replace(/[\\/]$/, "")}/${fileSymbol}/${timeframe}.csv`;
  let raw: string;
  try { raw = await fs.readFile(path, "utf8"); } catch { return null; }
  const lines = raw.trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  const headers = lines.shift()!.replace(/^\uFEFF/, "").toLowerCase().split(",").map(x => x.trim());
  const ix = (name: string) => headers.indexOf(name);
  const ti = ix("timestamp"), oi = ix("open"), hi = ix("high"), li = ix("low"), ci = ix("close");
  if ([ti, oi, hi, li, ci].some(x => x < 0)) throw new Error(`CSV local invalide ${path}: en-têtes timestamp,open,high,low,close requis`);
  const out: Candle[] = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    const a = line.split(",");
    let t = Number(a[ti]);
    if (!Number.isFinite(t)) t = Date.parse(a[ti]);
    else if (t < 1e12) t *= 1000;
    const o = Number(a[oi]), h = Number(a[hi]), l = Number(a[li]), c = Number(a[ci]);
    if (Number.isFinite(t) && [o,h,l,c].every(Number.isFinite) && h >= Math.max(o,c,l) && l <= Math.min(o,c)) out.push({ t, o, h, l, c });
  }
  out.sort((a,b) => a.t-b.t);
  return out.filter((x,i) => i === 0 || x.t !== out[i-1].t);
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

interface Row { n: number; res: Record<string, number>; seq: Array<{ t: number; outcome: string; costR: number; direction?: string; entry?: number; stop_loss?: number; tp1?: number; tp2?: number; tp3?: number; exit?: number }>; blockers: Record<string, number>; evals: number }

async function run(symbol: string) {
  const cfg = SYMBOLS.find((s) => s.symbol === symbol);
  if (!cfg) { console.log(`Actif inconnu : ${symbol}`); return; }
  let h1All: Candle[], d1All: Candle[], h4Native: Candle[] | null = null, m15All: Candle[] | null = null;
  let historySource: "local" | "provider" | "synthetic" = synthetic ? "synthetic" : "provider";
  if (synthetic) { h1All = synth(24 * 700); d1All = aggregate(h1All, D, Infinity); }
  else {
    process.stdout.write(`${symbol} : lecture historique local… `);
    const now = Date.now();
    let found: [Candle[], Candle[], Candle[] | null, Candle[] | null] | null = null;
    try {
      const [lh1, ld1, lh4, lm15] = await Promise.all([
        localCandles(symbol, "H1"), localCandles(symbol, "D1"), localCandles(symbol, "H4"), live ? localCandles(symbol, "M15") : Promise.resolve(null)
      ]);
      if (lh1 && ld1 && lh1.length >= 105 && ld1.length >= 205 && (!live || ((lh4?.length ?? 0) >= 105 && (lm15?.length ?? 0) >= 500))) {
        found = [lh1, ld1, lh4, lm15];
        historySource = "local";
        console.log(`historique local ${historyDir}`);
      } else if (lh1 || ld1 || lh4 || lm15) {
        console.log(`historique local incomplet (H1 ${lh1?.length ?? 0}, H4 ${lh4?.length ?? 0}, D1 ${ld1?.length ?? 0}, M15 ${lm15?.length ?? 0})`);
      }
    } catch (e) { console.log(`erreur CSV local: ${(e as Error).message}`); }
    if (!found) process.stdout.write(`${symbol} : téléchargement fournisseur… `);
    for (const src of (found ? [] : cfg.sources)) {
      try {
        const h1 = await providerHist(src, "1h", now - 730 * D, now);
        const d1 = await providerHist(src, "1d", now - 1800 * D, now);
        const h4 = live ? await providerHist(src, "4h", now - 760 * D, now) : null;
        const m15 = live ? await providerHist(src, "15m", now - 730 * D, now) : null;
        if (h1.length < 105 || d1.length < 205 || (live && ((h4?.length ?? 0) < 105 || (m15?.length ?? 0) < 500))) throw new Error(`historique trop court : H1 ${h1.length}/105, H4 ${h4?.length ?? 0}/105, D1 ${d1.length}/205, M15 ${m15?.length ?? 0}/500`);
        found = [h1, d1, h4, m15];
        break;
      } catch (e) { console.log(`\n  ${src.p}: ${(e as Error).message}`); }
    }
    if (!found) { console.log(`${symbol} : aucune source ne fournit assez d’historique. Essaie --synthetic pour vérifier le moteur sans données réelles.`); return; }
    [h1All, d1All, h4Native, m15All] = found;
    console.log(`${h1All.length} bougies H1, ${d1All.length} D1${h4Native ? `, ${h4Native.length} H4` : ""}${m15All ? `, ${m15All.length} M15` : ""}`);
  }
  const rows: Record<string, Row> = {}, busy: Record<string, number> = {};
  for (const p of wantProfiles) { rows[p] = { n: 0, res: {}, seq: [], blockers: {}, evals: 0 }; busy[p] = 0; }
  let firstT = 0, lastT = 0, bars = 0;
  for (let i = 104; i < h1All.length - 1; i++) {
    const tClose = h1All[i].t + H;
    if (!isMarketOpen(cfg, tClose)) continue;
    const h1 = h1All.slice(Math.max(0, i - 167), i + 1);
    const h4 = h4Native ? h4Native.filter((k) => k.t + 4 * H <= tClose).slice(-260) : aggregate(h1All.slice(Math.max(0, i - 1300), i + 1), 4 * H, tClose).slice(-260);
    const d1 = d1All.filter((k) => k.t + D <= tClose).slice(-260);
    if (h4.length < 105 || d1.length < 205) continue;
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
      const cMs = m15All ? 900_000 : H;
      const fut = (m15All ?? h1All.slice(i + 1)).filter((k) => k.t >= tClose && k.t < horizon);
      const o = evaluateOutcome(sig, fut, horizon + 2 * H, cMs);
      busy[pn] = o.at ? o.at + cMs : horizon;
      row.n++; row.res[o.outcome] = (row.res[o.outcome] ?? 0) + 1;
      const risk = Math.abs(best.entry - best.sl) || 1e-9;
      row.seq.push({ t: tClose, outcome: o.outcome, costR: (costAtr * an.atr) / risk, direction: best.dir, entry: best.entry, stop_loss: best.sl, tp1: best.tps[0], tp2: best.tps[1], tp3: best.tps[2], exit: o.at }); // résultats chronologiques (la règle « 1 trade à la fois » les rend séquentiels)
    }
  }
  const weeks = Math.max(1, (lastT - firstT) / (7 * D)) * (cfg.session === "us" ? 1 : 1);
  console.log(`\n=== ${symbol} — ${bars} décisions sur ${weeks.toFixed(0)} semaines ===`);
  for (const pn of wantProfiles) {
    const r = rows[pn]; if (!r) continue;
    const m = summarize(r.seq), gross = summarize(r.seq.map((t) => ({ outcome: t.outcome })));
    for (const trade of r.seq) tradeRows.push({ symbol, profile: pn, timestamp: trade.t, direction: trade.direction, entry: trade.entry, stop_loss: trade.stop_loss, tp1: trade.tp1, tp2: trade.tp2, tp3: trade.tp3, exit_timestamp: trade.exit, outcome: trade.outcome, costR: trade.costR });
    let equity = 0;
    const equity_curve = r.seq.filter(t => ["sl","tp1","tp2","tp3"].includes(t.outcome)).map(t => { equity = Math.round((equity + rOf(t.outcome, t.costR)) * 100) / 100; return { timestamp: t.t, equity_r: equity, outcome: t.outcome }; });
    const splitAt = firstT + (lastT - firstT) * split;
    const walkForward = split > 0 && split < 1 ? {
      split_ratio: split,
      calibration: summarize(r.seq.filter(x => x.t < splitAt)),
      out_of_sample: summarize(r.seq.filter(x => x.t >= splitAt)),
      split_timestamp: splitAt
    } : null;
    reportRows.push({ symbol, profile: pn, decisions: bars, setups: r.n, weeks: Number(weeks.toFixed(2)), ...m, gross_expectancy_r: gross.expectancy_r, cost_atr: costAtr, split: split, walk_forward: walkForward, source_mode: historySource, exit_timeframe: live ? "M15" : "H1", equity_curve });
    const top = Object.entries(r.blockers).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => `${k} ${Math.round((100 * v) / Math.max(1, r.evals))} %`).join(", ");
    const f = (x: number | null, d = 2) => (x === null ? "—" : x.toFixed(d));
    console.log(`[${pn.padEnd(8)}] setups : ${String(r.n).padStart(3)} (${(r.n / weeks).toFixed(2)}/semaine) | clos ${m.trades} : ${m.wins} gagnants (R>0), ${m.breakeven} breakeven, ${m.losses} SL, ${m.unresolved} expirés`);
    console.log(`           win rate ${m.win_rate ?? "—"} % (TP1 touché : ${m.tp1_touch_rate ?? "—"} %) | espérance ${f(m.expectancy_r)} R/trade (brute ${f(gross.expectancy_r)}) | R total ${m.total_r} | profit factor ${f(m.profit_factor)}`);
    console.log(`           gain moyen ${f(m.avg_win_r)} R, perte moyenne ${f(m.avg_loss_r)} R | drawdown max ${m.max_drawdown_r} R | pire série de SL : ${m.max_loss_streak} | coût ${costAtr} ATR/trade`);
    if (r.seq.length >= 4 && split > 0 && split < 1) {
      const cut = firstT + (lastT - firstT) * split, parts: Array<[string, typeof r.seq]> = [["réglage ", r.seq.filter((x) => x.t < cut)], ["TEST hors-éch.", r.seq.filter((x) => x.t >= cut)]];
      for (const [name, seq] of parts) { const q = summarize(seq); console.log(`           ${name.padEnd(14)}: ${q.trades} trades | win rate ${q.win_rate ?? "—"} % | espérance ${f(q.expectancy_r)} R | PF ${f(q.profit_factor)} | DD max ${q.max_drawdown_r} R`); }
    }
    console.log(`           blocages les plus fréquents : ${top || "—"}`);
  }
}

(async () => {
  for (const s of wantSymbols) { try { await run(s.trim()); } catch (e) { console.log(`${s} : ${(e as Error).message}`); } }
  if (reportRows.length) {
    const fs = await import("node:fs/promises");
    await fs.mkdir(outputDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    await fs.writeFile(`${outputDir}/summary-${stamp}.json`, JSON.stringify({ generated_at: new Date().toISOString(), synthetic, symbols_requested: wantSymbols, profiles: wantProfiles, assumptions: { entry: "H1 close", stop_first_on_ambiguous_bar: true, one_trade_per_market: true, expiry_hours: CFG.expiryHours, spread_and_slippage: `costAtr=${costAtr} ATR`, fundamental_events: "not included unless separately supplied", AI: "not included" }, results: reportRows }, null, 2));
    const cols = Object.keys(reportRows[0]);
    const csv = [cols.join(","), ...reportRows.map(row => cols.map(k => { const v = row[k]; const x = v == null ? "" : String(v); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; }).join(","))].join("\n");
    await fs.writeFile(`${outputDir}/summary-${stamp}.csv`, csv);
    const tradeCols = ["symbol","profile","timestamp","direction","entry","stop_loss","tp1","tp2","tp3","exit_timestamp","outcome","costR"];
    const tradeCsv = [tradeCols.join(","), ...tradeRows.map(row => tradeCols.map(k => { const v = row[k]; const x = v == null ? "" : String(v); return /[",\n]/.test(x) ? `"${x.replace(/"/g, '""')}"` : x; }).join(","))].join("\n");
    await fs.writeFile(`${outputDir}/trades-${stamp}.csv`, tradeCsv);
    console.log(`\nRapports exportés dans ${outputDir} (résumé JSON/CSV + trades CSV pour Replay).`);
  } else console.log("\nAucun résultat exportable : données insuffisantes ou aucun actif traité.");
})();
