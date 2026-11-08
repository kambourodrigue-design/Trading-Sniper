import { cacheGet, cacheSet } from "./cache";

export interface CalEvent { title: string; country: string; t: number; impact: string; forecast?: string; previous?: string }

// Calendrier économique (flux hebdomadaire public, non officiel : s'il tombe, le moteur continue sans ce filtre).
export async function getCalendar(env: Env): Promise<{ ok: boolean; events: CalEvent[] }> {
  const hit = await cacheGet(env, "cal:week");
  if (hit) return JSON.parse(hit);
  let out = { ok: false, events: [] as CalEvent[] };
  try {
    const res = await fetch("https://nfs.faireconomy.media/ff_calendar_thisweek.json");
    if (res.ok) {
      const rows = await res.json<Array<{ title: string; country: string; date: string; impact: string; forecast?: string; previous?: string }>>();
      out = { ok: true, events: rows.map((r) => ({ title: r.title, country: r.country, t: Date.parse(r.date), impact: r.impact, forecast: r.forecast, previous: r.previous })).filter((e) => !isNaN(e.t)) };
    }
  } catch (e) { console.error("calendrier indisponible", e); }
  await cacheSet(env, "cal:week", JSON.stringify(out), out.ok ? 3600 : 600);
  return out;
}

// Retourne une description si une news à fort impact touche l'une des devises dans la fenêtre interdite, sinon null.
export function newsBlock(events: CalEvent[], currencies: string[], now: number, beforeMin: number, afterMin: number): string | null {
  for (const e of events) {
    if (e.impact !== "High" || !currencies.includes(e.country)) continue;
    const dMin = (e.t - now) / 60000;
    if (dMin <= beforeMin && dMin >= -afterMin) return `${e.country} ${e.title} ${dMin >= 0 ? `dans ${Math.round(dMin)} min` : `il y a ${Math.round(-dMin)} min`}`;
  }
  return null;
}

export function upcomingEvents(events: CalEvent[], currencies: string[], now: number): string {
  const rows = events.filter((e) => e.impact === "High" && currencies.includes(e.country) && e.t > now - 6 * 3600_000 && e.t < now + 24 * 3600_000).sort((a, b) => a.t - b.t).slice(0, 6);
  if (!rows.length) return "aucune news à fort impact dans les prochaines 24 h";
  return rows.map((e) => `- ${new Date(e.t).toISOString().slice(5, 16).replace("T", " ")} UTC ${e.country} ${e.title}${e.forecast ? ` (prév. ${e.forecast}, préc. ${e.previous ?? "?"})` : ""}`).join("\n");
}

async function gdelt(): Promise<string> {
  try {
    const q = encodeURIComponent("(war OR conflict OR sanctions OR missile OR invasion OR ceasefire OR tariffs) sourcelang:english");
    const res = await fetch(`https://api.gdeltproject.org/api/v2/doc/doc?query=${q}&mode=ArtList&maxrecords=8&format=json&sort=datedesc&timespan=2d`);
    const j = JSON.parse(await res.text()) as { articles?: Array<{ title: string }> };
    return (j.articles ?? []).slice(0, 8).map((a) => `- ${a.title}`).join("\n");
  } catch { return ""; }
}

async function alphaVantage(env: Env): Promise<string> {
  if (!env.ALPHAVANTAGE_API_KEY) return "";
  try {
    const res = await fetch(`https://www.alphavantage.co/query?function=NEWS_SENTIMENT&topics=economy_macro,financial_markets,economy_fiscal,economy_monetary&sort=LATEST&limit=6&apikey=${env.ALPHAVANTAGE_API_KEY}`);
    const j = (await res.json()) as { feed?: Array<{ title: string; overall_sentiment_label?: string; overall_sentiment_score?: number }> };
    return (j.feed ?? []).slice(0, 6).map((f) => `- [${f.overall_sentiment_label ?? "Neutral"} ${(f.overall_sentiment_score ?? 0).toFixed(2)}] ${f.title}`).join("\n");
  } catch { return ""; }
}

// Synthèse macro/géopolitique datée, via Gemini + recherche Google (si clé fournie).
async function geminiBrief(env: Env): Promise<string> {
  if (!env.GEMINI_API_KEY) return "";
  try {
    const model = env.GEMINI_MODEL || "gemini-3.1-pro-preview";
    const prompt = `Nous sommes le ${new Date().toISOString().slice(0, 16)} UTC. Tu es analyste macro. En t'appuyant sur des recherches web récentes (48 dernières heures), résume en 180 mots maximum, en français : (1) politique monétaire Fed/BCE/BoE et attentes de taux ; (2) dernières données d'inflation et d'emploi US ; (3) tendance du dollar (DXY) et des rendements US ; (4) tensions géopolitiques actives ; (5) impact attendu sur l'or (XAU/USD), EUR/USD, GBP/JPY et le Bitcoin. Donne des faits datés ; n'invente rien et signale ce qui est incertain.`;
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY ?? "" },
      body: JSON.stringify({ contents: [{ role: "user", parts: [{ text: prompt }] }], tools: [{ google_search: {} }], generationConfig: { maxOutputTokens: 4096 } }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!res.ok) { console.error("Gemini macro", res.status, (await res.text()).slice(0, 200)); return ""; }
    const j = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
    return (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("").trim();
  } catch (e) { console.error("Gemini macro", e); return ""; }
}

// Contexte macro partagé par tous les actifs, rafraîchi toutes les 3 h.
export async function getMacroContext(env: Env): Promise<string> {
  const hit = await cacheGet(env, "macro:ctx");
  if (hit) return hit;
  const [brief, geo, av] = await Promise.all([geminiBrief(env), gdelt(), alphaVantage(env)]);
  const parts = [
    brief ? `SYNTHÈSE MACRO (Gemini + Google Search) :\n${brief}` : "",
    geo ? `TITRES GÉOPOLITIQUES RÉCENTS (GDELT) :\n${geo}` : "",
    av ? `NEWS & SENTIMENT MARCHÉ (Alpha Vantage) :\n${av}` : "",
  ].filter(Boolean);
  const ctx = parts.length ? parts.join("\n\n") : "Contexte macro/géopolitique indisponible : n'en déduis PAS l'absence de risques.";
  if (parts.length) await cacheSet(env, "macro:ctx", ctx, 3 * 3600);
  return ctx;
}
