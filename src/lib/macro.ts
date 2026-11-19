import { cacheGet, cacheSet } from "./cache";

export interface CalEvent { title: string; country: string; t: number; impact: string; forecast?: string; previous?: string; actual?: string; id?: string; confidence?: string }

function numericValue(raw?: string): number | null {
  if (!raw) return null;
  const v = raw.trim().replace(/,/g, "").replace(/[+$€£%\s]/g, "");
  const m = v.match(/^(-?\d+(?:\.\d+)?)([KMB])?$/i);
  if (!m) return null;
  const scale = m[2]?.toUpperCase() === "K" ? 1e3 : m[2]?.toUpperCase() === "M" ? 1e6 : m[2]?.toUpperCase() === "B" ? 1e9 : 1;
  return Number(m[1]) * scale;
}

// Score macro déterministe fondé uniquement sur les surprises actual/forecast publiées dans les 6 dernières heures.
// Il reste neutre si les chiffres ne sont pas disponibles : aucun biais n'est inventé à partir d'un simple titre.
export function fundamentalBias(events: CalEvent[], symbol: string, now: number): { bias: number; detail: string } {
  const byCurrency = new Map<string, { total: number; weight: number; count: number }>();
  for (const e of events) {
    if (e.t > now || e.t < now - 6 * 3600_000 || !e.actual || !e.forecast || e.confidence === "sources_disagree" || (e.impact !== "High" && e.impact !== "Medium")) continue;
    const actual = numericValue(e.actual), forecast = numericValue(e.forecast);
    if (actual === null || forecast === null || forecast === 0) continue;
    const title = e.title.toLowerCase();
    const adverseWhenHigher = /unemployment|jobless|initial claims|continuing claims|claimant count/.test(title);
    const rawSurprise = (actual - forecast) / Math.max(Math.abs(forecast), 1);
    const score = Math.max(-1, Math.min(1, rawSurprise / 0.05)) * (adverseWhenHigher ? -1 : 1);
    const weight = e.impact === "High" ? 2 : 1;
    const old = byCurrency.get(e.country) ?? { total: 0, weight: 0, count: 0 };
    old.total += score * weight; old.weight += weight; old.count++;
    byCurrency.set(e.country, old);
  }
  const strength = (ccy: string) => {
    const v = byCurrency.get(ccy);
    return v && v.weight ? v.total / v.weight : 0;
  };
  const parts = symbol.split("/");
  let bias = 0;
  if (parts.length === 2) bias = strength(parts[0]) - strength(parts[1]);
  else if (symbol === "XAU/USD" || symbol === "BTC/USD" || symbol === "ETH/USD") bias = -strength("USD");
  bias = Math.max(-1, Math.min(1, bias));
  const used = [...byCurrency.entries()].map(([ccy, v]) => `${ccy} ${Math.round((v.total / v.weight) * 100)}/100 (${v.count} surprise(s) publiée(s))`);
  return { bias: Number(bias.toFixed(2)), detail: used.length ? `Surprises macro récentes : ${used.join(" ; ")}` : "Aucune surprise actual/prévision exploitable dans les 6 dernières heures ; biais macro directionnel neutre." };
}

// Calendrier économique ShowMyTrades : accès public sans clé, rafraîchi toutes les 15 minutes.
export async function getCalendar(_env: Env): Promise<{ ok: boolean; events: CalEvent[] }> {
  const hit = await cacheGet(_env, "cal:showmytrades:v1");
  if (hit) return JSON.parse(hit) as { ok: boolean; events: CalEvent[] };
  let out = { ok: false, events: [] as CalEvent[] };
  try {
    const url = "https://showmytrades.com/api/public/calendar/v1?impact=high,medium&days=7";
    const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12_000) });
    if (!res.ok) throw new Error(`ShowMyTrades HTTP ${res.status}`);
    const body = await res.json() as { events?: Array<{ ts: number; currency: string; impact: string; title: string; forecast?: string; previous?: string; actual?: string; id?: string; confidence?: string }>; server_time?: number };
    if (!Array.isArray(body.events)) throw new Error("ShowMyTrades : format events absent");
    out = { ok: true, events: body.events.map((r) => ({
      title: r.title, country: r.currency, t: Number(r.ts) * 1000,
      impact: String(r.impact).toLowerCase() === "high" ? "High" : String(r.impact).toLowerCase() === "medium" ? "Medium" : String(r.impact),
      forecast: r.forecast, previous: r.previous, actual: r.actual, id: r.id, confidence: r.confidence,
    })).filter((e) => Number.isFinite(e.t) && !!e.country) };
  } catch (e) { console.error("calendrier ShowMyTrades indisponible", (e as Error).message); }
  await cacheSet(_env, "cal:showmytrades:v1", JSON.stringify(out), out.ok ? 900 : 180);
  return out;
}

export function newsBlock(events: CalEvent[], currencies: string[], now: number, beforeMin: number, afterMin: number): string | null {
  for (const e of events) {
    if (e.impact !== "High" || !currencies.includes(e.country)) continue;
    const dMin = (e.t - now) / 60000;
    if (dMin <= beforeMin && dMin >= -afterMin) return `${e.country} ${e.title} ${dMin >= 0 ? `dans ${Math.round(dMin)} min` : `il y a ${Math.round(-dMin)} min`}`;
  }
  return null;
}

export function upcomingEvents(events: CalEvent[], currencies: string[], now: number): string {
  const rows = events.filter((e) => (e.impact === "High" || e.impact === "Medium") && currencies.includes(e.country) && e.t > now - 6 * 3600_000 && e.t < now + 24 * 3600_000)
    .sort((a, b) => a.t - b.t).slice(0, 8);
  if (!rows.length) return "aucune publication high/medium répertoriée dans les prochaines 24 h";
  return rows.map((e) => `- ${new Date(e.t).toISOString().slice(5, 16).replace("T", " ")} UTC ${e.country} [${e.impact}] ${e.title}${e.forecast ? ` (prév. ${e.forecast}, préc. ${e.previous ?? "?"}${e.actual ? `, réel ${e.actual}` : ""})` : ""}`).join("\n");
}

async function gdelt(): Promise<string> {
  try {
    const q = encodeURIComponent("(central bank OR interest rate OR inflation OR employment OR tariffs OR sanctions OR conflict) sourcelang:english");
    const res = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=ArtList&maxrecords=8&format=json&sort=datedesc&timespan=2d`, { signal: AbortSignal.timeout(12_000) });
    if (!res.ok) return "";
    const j = await res.json() as { articles?: Array<{ title: string; seendate?: string; url?: string }> };
    return (j.articles ?? []).slice(0, 8).map((a) => `- ${a.seendate ?? "date non fournie"} ${a.title}`).join("\n");
  } catch { return ""; }
}


const num = (v?: string): number | null => { if (!v || v === "N/A") return null; const n = Number(v); return Number.isFinite(n) ? n : null; };

// Courbe US officielle du Trésor : données quotidiennes, pas des cotations intraday.
async function treasuryYields(env: Env): Promise<string> {
  const cached = await cacheGet(env, "macro:treasury:yields:v1");
  if (cached) return cached;
  const year = new Date().getUTCFullYear();
  const base = "https://home.treasury.gov/resource-center/data-chart-center/interest-rates/pages/xml";
  const load = async (kind: string) => {
    const u = `${base}?data=${kind}&field_tdr_date_value=${year}`;
    const r = await fetch(u, { headers: { Accept: "application/xml" }, signal: AbortSignal.timeout(10000) });
    if (!r.ok) throw new Error(`Treasury ${kind} HTTP ${r.status}`);
    return r.text();
  };
  try {
    const [nominal, real] = await Promise.all([load("daily_treasury_yield_curve"), load("daily_treasury_real_yield_curve")]);
    const parse = (xml: string) => {
      const rows: Array<{date:string;y2:number|null;y10:number|null}> = [];
      for (const m of xml.matchAll(/<[^>]*\b(?:entry|item)\b[^>]*>([\s\S]*?)<\/[^>]*>/gi)) {
        const b=m[1]; const get=(key:string)=>{const x=b.match(new RegExp(`<${key}[^>]*>([^<]*)<\/${key}>`,'i'));return x?.[1]?.trim()??"";};
        const date=get("NEW_DATE")||get("record_date")||get("DATE");
        if(date) rows.push({date,y2:num(get("BC_2YEAR")),y10:num(get("BC_10YEAR"))});
      }
      if(rows.length) return rows;
      const dates=[...xml.matchAll(/<NEW_DATE>([^<]+)<\/NEW_DATE>/g)].map(x=>x[1]);
      const two=[...xml.matchAll(/<BC_2YEAR>([^<]*)<\/BC_2YEAR>/g)].map(x=>num(x[1]));
      const ten=[...xml.matchAll(/<BC_10YEAR>([^<]*)<\/BC_10YEAR>/g)].map(x=>num(x[1]));
      return dates.map((date,i)=>({date,y2:two[i]??null,y10:ten[i]??null}));
    };
    const n=parse(nominal), rr=parse(real), latest=n[n.length-1];
    if(!latest) return "Rendements US : flux du Trésor reçu mais format non reconnu.";
    const realLatest=rr.find(x=>x.date===latest.date);
    const out = `TRÉSOR US (source officielle, dernière observation ${latest.date}) : taux 2 ans ${latest.y2??"n/d"} %, 10 ans ${latest.y10??"n/d"} %, rendement réel TIPS 10 ans ${realLatest?.y10??"n/d"} %. Fréquence quotidienne ; ces chiffres ne sont pas intraday.`;
    await cacheSet(env, "macro:treasury:yields:v1", out, 6 * 3600); return out;
  } catch(e) { return `Rendements US indisponibles : ${(e as Error).message.slice(0,100)}.`; }
}

// CFTC TFF : positions des leveraged funds sur devises. Publication hebdomadaire.
async function cotContext(env: Env): Promise<string> {
  const cached = await cacheGet(env, "macro:cftc:tff:v1");
  if (cached) return cached;
  try {
    const url = "https://publicreporting.cftc.gov/resource/gpe5-46if.json?$select=report_date_as_yyyy_mm_dd,market_and_exchange_names,lev_money_positions_long,lev_money_positions_short,open_interest_all&$order=report_date_as_yyyy_mm_dd%20DESC&$limit=500";
    const r=await fetch(url,{headers:{Accept:"application/json"},signal:AbortSignal.timeout(12000)});
    if(!r.ok) throw new Error(`CFTC HTTP ${r.status}`);
    const rows=await r.json() as Array<Record<string,string>>;
    const keys=["EURO FX","BRITISH POUND","JAPANESE YEN","CANADIAN DOLLAR","SWISS FRANC","AUSTRALIAN DOLLAR","NEW ZEALAND DOLLAR"];
    const lines:string[]=[];
    for(const key of keys){const x=rows.find(z=>(z.market_and_exchange_names||"").toUpperCase().includes(key));if(!x)continue;const l=Number(x.lev_money_positions_long), sh=Number(x.lev_money_positions_short), oi=Number(x.open_interest_all);if(Number.isFinite(l)&&Number.isFinite(sh)){lines.push(`${key}: leveraged funds net ${Math.round(l-sh)} contrats${oi>0?`, ${(100*(l-sh)/oi).toFixed(1)} % de l'open interest`:""} (rapport ${x.report_date_as_yyyy_mm_dd})`);}}
    const out = lines.length?`CFTC TFF — positions leveraged funds (hebdomadaire, non temps réel) :\n${lines.join("\n")}`:"CFTC COT : aucune ligne FX exploitable trouvée dans le dernier lot.";
    await cacheSet(env, "macro:cftc:tff:v1", out, 6 * 3600); return out;
  } catch(e){return `CFTC COT indisponible : ${(e as Error).message.slice(0,100)}.`;}
}

// BIS Central Bank Policy Rates (CBPOL) : série officielle harmonisée, sans clé API.
// Les observations quotidiennes reflètent le taux en vigueur ; les changements successifs
// permettent de reconstituer les dates d'effet, pas nécessairement les heures d'annonce.
type PolicyRatePoint = { currency: string; date: string; rate: number };
const BIS_CURRENCIES: Record<string, string[]> = {
  USD: ["US", "USA"], EUR: ["XM", "EA", "EMU"], GBP: ["GB", "GBR"],
  JPY: ["JP", "JPN"], CAD: ["CA", "CAN"], CHF: ["CH", "CHE"],
  AUD: ["AU", "AUS"], NZD: ["NZ", "NZL"],
};

function parseCsvLine(line: string): string[] {
  const out: string[] = []; let value = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"' && quoted && line[i + 1] === '"') { value += '"'; i++; }
    else if (c === '"') quoted = !quoted;
    else if (c === "," && !quoted) { out.push(value); value = ""; }
    else value += c;
  }
  out.push(value); return out;
}

function parseBisPolicyCsv(csv: string): PolicyRatePoint[] {
  const lines = csv.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]).map(x => x.trim().toUpperCase());
  const idx = (names: string[]) => headers.findIndex(h => names.includes(h));
  const areaI = idx(["REF_AREA", "REFAREA", "REFERENCE_AREA"]);
  const dateI = idx(["TIME_PERIOD", "TIMEPERIOD", "PERIOD"]);
  const valueI = idx(["OBS_VALUE", "OBSVALUE", "VALUE"]);
  if (areaI < 0 || dateI < 0 || valueI < 0) return [];
  const codeToCurrency = new Map<string, string>();
  for (const [currency, codes] of Object.entries(BIS_CURRENCIES)) for (const code of codes) codeToCurrency.set(code, currency);
  const points: PolicyRatePoint[] = [];
  for (const line of lines.slice(1)) {
    const cells = parseCsvLine(line);
    const area = (cells[areaI] ?? "").trim().toUpperCase();
    const currency = codeToCurrency.get(area);
    const date = (cells[dateI] ?? "").trim();
    const rate = Number((cells[valueI] ?? "").trim());
    if (currency && /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(rate)) points.push({ currency, date, rate });
  }
  return points.sort((a, b) => a.date.localeCompare(b.date));
}

async function policyRateContext(env: Env): Promise<string> {
  const cached = await cacheGet(env, "macro:bis:policy-rates:v1");
  if (cached) return cached;
  try {
    const url = "https://stats.bis.org/api/v1/data/WS_CBPOL/.?startPeriod=2000-01-01&format=csvfile";
    const res = await fetch(url, { headers: { Accept: "text/csv" }, signal: AbortSignal.timeout(15000) });
    if (!res.ok) throw new Error(`BIS HTTP ${res.status}`);
    const points = parseBisPolicyCsv(await res.text());
    if (!points.length) throw new Error("CSV BIS reçu mais colonnes ou codes de devises non reconnus");
    const latest = new Map<string, PolicyRatePoint>();
    const history = new Map<string, PolicyRatePoint[]>();
    for (const p of points) {
      latest.set(p.currency, p);
      const arr = history.get(p.currency) ?? [];
      const last = arr[arr.length - 1];
      if (!last || last.rate !== p.rate) arr.push(p);
      history.set(p.currency, arr);
    }
    const names: Record<string, string> = { USD:"Fed", EUR:"BCE", GBP:"BoE", JPY:"BoJ", CAD:"BoC", CHF:"BNS", AUD:"RBA", NZD:"RBNZ" };
    const rows = Object.keys(BIS_CURRENCIES).map(ccy => {
      const p = latest.get(ccy); const changes = (history.get(ccy) ?? []).slice(-5).reverse();
      return p ? `${ccy} (${names[ccy]}) : ${p.rate.toFixed(3)} % au ${p.date}; derniers changements effectifs connus depuis 2000 : ${changes.map(x => `${x.date}=${x.rate.toFixed(3)} %`).join(", ") || "historique indisponible"}` : `${ccy} (${names[ccy]}) : donnée BIS absente`;
    });
    const currencies = Object.keys(BIS_CURRENCIES);
    const pairs = currencies.flatMap((base, i) => currencies.slice(i + 1).map(quote => `${base}/${quote}`));
    const diffs = pairs.map(pair => {
      const [base, quote] = pair.split("/"); const a = latest.get(base), b = latest.get(quote);
      return a && b ? `${pair} : ${base}−${quote} = ${(a.rate - b.rate).toFixed(3)} point(s) de pourcentage` : `${pair} : différentiel indisponible`;
    });
    const out = `TAUX DIRECTEURS — source BIS CBPOL (taux de politique monétaire harmonisés, dernière observation disponible par zone) :\n${rows.join("\n")}\nDIFFÉRENTIELS DE TAUX DIRECTEURS :\n${diffs.join("\n")}\nHISTORIQUE : les dates indiquent la date d'effet observée dans la série BIS, pas nécessairement la date/heure de l'annonce. Données BIS publiées autour du milieu de semaine ; attribution source : Bank for International Settlements (BIS).`;
    await cacheSet(env, "macro:bis:policy-rates:v1", out, 6 * 3600);
    return out;
  } catch (e) { return `Taux directeurs BIS indisponibles : ${(e as Error).message.slice(0, 140)}.`; }
}

// Séries quotidiennes FRED publiques exportées en CSV (pas de clé API pour l'export graphique).
type FredPoint = { date: string; value: number };
async function fredSeries(id: string): Promise<FredPoint[]> {
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${encodeURIComponent(id)}&cosd=${new Date(Date.now()-45*86400000).toISOString().slice(0,10)}`;
  const r = await fetch(url, { headers: { Accept: "text/csv" }, signal: AbortSignal.timeout(12000) });
  if (!r.ok) throw new Error(`FRED ${id} HTTP ${r.status}`);
  const lines = (await r.text()).replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  if (lines.length < 2) return [];
  return lines.slice(1).map(line => parseCsvLine(line)).map(c => ({ date: (c[0] ?? "").trim(), value: Number((c[1] ?? "").trim()) }))
    .filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x.date) && Number.isFinite(x.value));
}
function latestPair(rows: FredPoint[]): [FredPoint | null, FredPoint | null] {
  const valid = rows.filter(x => Number.isFinite(x.value));
  return [valid[valid.length - 1] ?? null, valid[valid.length - 2] ?? null];
}
async function stooqDxy(): Promise<FredPoint[]> {
  const r=await fetch("https://stooq.com/q/d/l/?s=dx.f&i=d",{headers:{Accept:"text/csv","User-Agent":"LucideSniperMacro/1.0"},signal:AbortSignal.timeout(10000)});
  if(!r.ok) throw new Error(`Stooq DXY HTTP ${r.status}`);
  const lines=(await r.text()).trim().split(/\r?\n/);
  if(!lines[0]?.startsWith("Date,")) throw new Error("Stooq DXY CSV indisponible ou limite atteinte");
  return lines.slice(1).map(line=>parseCsvLine(line)).map(c=>({date:(c[0]??"").trim(),value:Number((c[4]??"").trim())})).filter(x=>/^\d{4}-\d{2}-\d{2}$/.test(x.date)&&Number.isFinite(x.value)).sort((a,b)=>a.date.localeCompare(b.date));
}
async function marketMacroContext(env: Env): Promise<{ text: string; values: Record<string, number> }> {
  const cached = await cacheGet(env, "macro:market:fred:v1");
  if (cached) { try { return JSON.parse(cached) as { text: string; values: Record<string, number> }; } catch { /* refresh corrupted cache */ } }
  const ids = ["DCOILWTICO", "DCOILBRENTEU", "VIXCLS", "DTWEXBGS", "DGS2", "DFII10"];
  const names: Record<string,string> = { DCOILWTICO:"WTI", DCOILBRENTEU:"Brent", VIXCLS:"VIX", DTWEXBGS:"Dollar broad index (proxy DXY)", DGS2:"US 2Y", DFII10:"US 10Y real yield" };
  const values: Record<string,number> = {}; const lines: string[] = [];
  const results = await Promise.allSettled(ids.map(id => fredSeries(id)));
  results.forEach((result, i) => {
    const id=ids[i];
    if (result.status !== "fulfilled") { lines.push(`${names[id]} : indisponible (${String(result.reason).slice(0,70)})`); return; }
    const [last, prev] = latestPair(result.value);
    if (!last) { lines.push(`${names[id]} : aucune observation exploitable`); return; }
    values[id]=last.value;
    const change=prev && prev.value!==0 ? ((last.value-prev.value)/Math.abs(prev.value))*100 : null;
    if(change!==null) values[`${id}_CHANGE`]=change;
    const fiveBack=result.value.length>=6?result.value[result.value.length-6]:null;
    if(fiveBack&&fiveBack.value!==0) values[`${id}_CHANGE_5D`]=last.value-fiveBack.value;
    lines.push(`${names[id]} : ${last.value.toFixed(2)} au ${last.date}${change===null?"":`; variation vs observation précédente ${change>=0?"+":""}${change.toFixed(2)} %`}`);
  });
  try {
    const [dxyLast,dxyPrev]=latestPair(await stooqDxy());
    if(dxyLast){values.DXY=dxyLast.value;if(dxyPrev&&dxyPrev.value!==0)values.DXY_CHANGE=(dxyLast.value-dxyPrev.value)/Math.abs(dxyPrev.value)*100;lines.push(`DXY futures (DX, Stooq, clôture quotidienne) : ${dxyLast.value.toFixed(3)} au ${dxyLast.date}${dxyPrev?`; variation ${((dxyLast.value-dxyPrev.value)/Math.abs(dxyPrev.value)*100).toFixed(2)} %`:""}`);}
  } catch(e) { lines.push(`DXY futures : indisponible (${String(e).slice(0,80)}); indice large FRED conservé comme proxy secondaire.`); }
  const textOut = `MARCHÉS / INTERMARKET (observations quotidiennes, pas des cotations intraday) :\n${lines.join("\n")}\nNOTE : le DXY est approché par le future DX via Stooq lorsque le flux est disponible ; sinon DTWEXBGS (indice large du dollar pondéré par le commerce) sert uniquement de proxy secondaire et n'est pas l'ICE DXY. Le VIX mesure la volatilité implicite actions, pas un signal directionnel isolé.`;
  const out={text:textOut,values};
  await cacheSet(env,"macro:market:fred:v1",JSON.stringify(out),900);
  return out;
}

export function macroScoreText(events: CalEvent[], policyText: string, cotText: string, market: {values:Record<string,number>}, now: number): string {
  const currencies=["USD","EUR","GBP","JPY","CAD","CHF","AUD","NZD"];
  const rateMap:Record<string,number>={};
  for (const c of currencies) {
    const m=policyText.match(new RegExp(`${c} \\([^\\n]*?\\)\\s*:\\s*([+-]?\\d+(?:\\.\\d+)?) %`));
    if(m) rateMap[c]=Number(m[1]);
  }
  const avgRate=Object.values(rateMap).length?Object.values(rateMap).reduce((a,b)=>a+b,0)/Object.values(rateMap).length:0;
  const cotMap:Record<string,number>={};
  const cotAliases:Record<string,string>={EUR:"EURO FX",GBP:"BRITISH POUND",JPY:"JAPANESE YEN",CAD:"CANADIAN DOLLAR",CHF:"SWISS FRANC",AUD:"AUSTRALIAN DOLLAR",NZD:"NEW ZEALAND DOLLAR"};
  for(const [ccy,label] of Object.entries(cotAliases)){
    const re=new RegExp(`${label}: leveraged funds net (-?\\d+) contrats(?:, (-?\\d+(?:\\.\\d+)?) % de l'open interest)?`,'i');
    const m=cotText.match(re); if(m && m[2]!==undefined) cotMap[ccy]=Math.max(-1,Math.min(1,Number(m[2])/10));
  }
  const scoreMap:Record<string,number>={};
  const rows=currencies.map(ccy=>{
    let weighted=0,weight=0,coverage=0; const add=(score:number,w:number)=>{weighted+=score*w;weight+=w;coverage+=w;};
    if(rateMap[ccy]!==undefined) add(Math.max(0,Math.min(100,50+(rateMap[ccy]-avgRate)*8)),25);
    if(ccy==="USD"&&(market.values.DGS2_CHANGE_5D!==undefined||market.values.DFII10_CHANGE_5D!==undefined)){
      const nominalBp=(market.values.DGS2_CHANGE_5D??0)*100;
      const realBp=(market.values.DFII10_CHANGE_5D??0)*100;
      add(Math.max(0,Math.min(100,50+nominalBp*1.2+realBp*0.8)),20);
    }
    const recent=events.filter(e=>e.country===ccy&&e.t<=now&&e.t>=now-30*86400000&&e.actual&&e.forecast&&e.confidence!=="sources_disagree"&&(e.impact==="High"||e.impact==="Medium"));
    const surprises=recent.filter(e=>!/gdp|gross domestic|pmi|ism|retail sales|industrial production/.test(e.title.toLowerCase())).map(e=>{const a=numericValue(e.actual),f=numericValue(e.forecast);if(a===null||f===null)return null;const raw=Math.max(-1,Math.min(1,(a-f)/Math.max(Math.abs(f),1)/0.05));const title=e.title.toLowerCase();return raw*(/unemployment|jobless|initial claims|continuing claims|claimant count/.test(title)?-1:1);}).filter((x):x is number=>x!==null);
    if(surprises.length){const mean=surprises.reduce((a,b)=>a+b,0)/surprises.length;add(50+25*mean,25);}
    const growthEvents=recent.filter(e=>/gdp|gross domestic|pmi|ism|retail sales|industrial production/.test(e.title.toLowerCase()));
    if(growthEvents.length){const vals=growthEvents.map(e=>{const a=numericValue(e.actual),f=numericValue(e.forecast);return a===null||f===null?null:Math.max(-1,Math.min(1,(a-f)/Math.max(Math.abs(f),1)/0.05));}).filter((x):x is number=>x!==null);if(vals.length)add(50+25*vals.reduce((a,b)=>a+b,0)/vals.length,15);}
    if(cotMap[ccy]!==undefined)add(50+25*cotMap[ccy],10);
    // USD : variation de l'indice large du dollar ; CAD : impulsion du WTI/Brent.
    const dollarMove=market.values.DXY_CHANGE??market.values.DTWEXBGS_CHANGE;
    if(ccy==="USD"&&dollarMove!==undefined)add(Math.max(0,Math.min(100,50+dollarMove*8)),5);
    if(ccy==="CAD"&&(market.values.DCOILWTICO_CHANGE!==undefined||market.values.DCOILBRENTEU_CHANGE!==undefined)){
      const oilMove=market.values.DCOILWTICO_CHANGE??market.values.DCOILBRENTEU_CHANGE;
      add(Math.max(0,Math.min(100,50+oilMove*4)),5);
    }
    const score=weight?Math.round(weighted/weight):50;
    scoreMap[ccy]=score;
    return `${ccy} ${score}/100 (couverture ${coverage}/100 ; ${recent.length} surprise(s) macro sur 30 j${rateMap[ccy]!==undefined?`; taux ${rateMap[ccy].toFixed(2)} %`:""}${cotMap[ccy]!==undefined?"; COT disponible":""})`;
  });
  const pairs=["EUR/USD","GBP/USD","USD/JPY","USD/CHF","USD/CAD","AUD/USD","NZD/USD","EUR/GBP","EUR/JPY","GBP/JPY","EUR/CAD","XAU/USD","BTC/USD","ETH/USD"];
  const pairRows=pairs.map(pair=>{const [a,b]=pair.split("/");const vix=market.values.VIX??20;const realYieldMove=market.values.DFII10_CHANGE_5D??0;const riskAdj=a==="XAU"?(vix>=25?5:vix<15?-2:0)-realYieldMove*100*0.8:(a==="BTC"||a==="ETH")?(vix>=25?-5:vix<15?3:0):0;const diff=(a==="XAU"||a==="BTC"||a==="ETH")?50-scoreMap.USD+riskAdj:(b==="XAU"||b==="BTC"||b==="ETH")?scoreMap[a]-50:(a==="USD"||b==="USD"||scoreMap[a]!==undefined&&scoreMap[b]!==undefined)?(scoreMap[a]??(100-scoreMap.USD))- (scoreMap[b]??(100-scoreMap.USD)):scoreMap[a]-scoreMap[b];const bias=diff>=8?"haussier":diff<=-8?"baissier":"neutre";return `${pair} : ${bias} (écart indicatif ${Math.round(diff)} points)`;});
  return `SCORE MACRO AUTONOME (prototype explicable, non encore calibré par backtest) :\n${rows.join("\n")}\nBIAIS RELATIFS INDICATIFS :\n${pairRows.join("\n")}\nMéthode cible sur 100 : politique monétaire 25, inflation/emploi 25, croissance 15, rendements obligataires 20, COT 10, sentiment/intermarket 5. Les facteurs absents sont exclus du dénominateur et la couverture est affichée ; score 50 = neutre faute de données. Le facteur rendements obligataires est calculé pour USD à partir de la variation sur cinq observations du Treasury 2 ans et du TIPS réel 10 ans ; il reste indisponible pour les sept autres devises, faute de séries homogènes branchées dans cette version. Le facteur croissance dépend des publications disponibles. Les scores ne sont pas des probabilités de gain et ne doivent pas déclencher seuls un ordre.`;
}

// Contexte macro sans LLM ni API payante : headlines GDELT + calendrier structuré.
export async function getMacroContext(env: Env): Promise<string> {
  const hit = await cacheGet(env, "macro:ctx:free:v1");
  if (hit) return hit;
  const [geo, cal, yields, cot, policyRates, market] = await Promise.all([gdelt(), getCalendar(env), treasuryYields(env), cotContext(env), policyRateContext(env), marketMacroContext(env)]);
  const high = cal.events.filter((e) => e.impact === "High").sort((a, b) => a.t - b.t).slice(0, 12);
  const eventText = high.map((e) => `- ${new Date(e.t).toISOString()} ${e.country} ${e.title}; prévision=${e.forecast ?? "n/d"}; précédent=${e.previous ?? "n/d"}; réel=${e.actual ?? "non publié"}`).join("\n");
  const ctx = [
    "SOURCE CALENDRIER : ShowMyTrades (flux public ; horaires UTC ; prévisions/réels selon disponibilité).",
    "MOTEUR MACRO GRATUIT ET DÉTERMINISTE. Aucune conclusion directionnelle ne doit être inventée en l'absence de données chiffrées.",
    geo ? `ACTUALITÉS GÉOPOLITIQUES / MACRO (GDELT) :\n${geo}` : "Actualités GDELT indisponibles.",
    policyRates,
    yields,
    cot,
    market.text,
    macroScoreText(cal.events, policyRates, cot, market, Date.now()),
    eventText ? `PUBLICATIONS ÉCONOMIQUES À FORT IMPACT :\n${eventText}` : "Aucune publication à fort impact disponible dans le calendrier.",
    "Les événements et titres sont des éléments de contexte, pas une preuve autonome d'achat ou de vente.",
  ].join("\n\n");
  await cacheSet(env, "macro:ctx:free:v1", ctx, 900);
  return ctx;
}
