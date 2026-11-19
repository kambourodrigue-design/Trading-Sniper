// Couche IA : OpenAI (GPT-6), DeepSeek, Gemini et Claude, appelés en parallèle (chaque IA n'est utilisée que si sa clé est configurée ; une seule suffit).
// Deux usages :
//   1) VALIDATION d'un setup détecté par les règles (les niveaux restent ceux du moteur) ;
//   2) ANALYSE INDÉPENDANTE : l'IA lit elle-même les bougies et propose son propre trade (niveaux validés par des garde-fous).

type Macro = "supportive" | "neutral" | "adverse";
export interface Verdict {
  provider: string; decision: "BUY" | "SELL" | "NONE"; confidence: number;
  macro: Macro; veto: boolean; reasoning: string; risks: string[];
}
export interface IndepVerdict extends Verdict {
  entry: number | null; sl: number | null; tp1: number | null; tp2: number | null; tp3: number | null; strategies: string[];
}

export const SYSTEM_PROMPT = `Tu es un analyste de trading senior (Smart Money Concepts, Wyckoff, offre/demande, price action, analyse fondamentale).
On te soumet un setup candidat détecté par un moteur de règles. Les niveaux (entrée, SL, TP) sont calculés par le moteur : ne les modifie pas et n'en invente pas.
Ton rôle : CONFIRMER ou REJETER le setup, en tenant compte du contexte macro et géopolitique fourni.
Réponds "NONE" si les signaux sont contradictoires, si la structure paraît fragile, si une news majeure est imminente ou si le contexte macro/géopolitique est défavorable au sens proposé.
Les chiffres INTERMARCHÉS fournis (dollar, taux US 10 ans) sont des mesures réelles : intègre-les à ton analyse fondamentale.\nveto=true uniquement pour un risque macro/géopolitique majeur. reasoning : 60 mots maximum, en français.
Réponds STRICTEMENT par un objet JSON : {"decision":"BUY|SELL|NONE","confidence":0-100,"macro":"supportive|neutral|adverse","veto":true|false,"reasoning":"...","risks":["..."]}`;

export const INDEP_SYSTEM_PROMPT = `Tu es un trader professionnel et analyste macro (Smart Money Concepts, Wyckoff, offre/demande, price action, figures chartistes, moyennes mobiles 50/200, analyse fondamentale).
On te donne les bougies récentes (D1, H4, H1), des indicateurs calculés et le contexte macro/géopolitique. Fais TA PROPRE analyse top-down (D1 puis H4 puis H1). Les détections automatiques fournies "à titre indicatif" ne te lient pas : tu peux les contredire.
Propose un trade UNIQUEMENT si le setup est de haute probabilité : tendance supérieure cohérente, zone ou structure claire, confirmation, contexte fondamental non défavorable, et ratio gain/risque >= 2 sur TP2. Sinon réponds "NONE" : ne force jamais un trade.
Niveaux : utilise uniquement des prix cohérents avec les bougies fournies. L'entrée est au marché, au prix actuel indiqué (entry = prix actuel, ou null). Le SL se place au-delà du point d'invalidation (entre 0.5 et 3 ATR du prix). TP1, TP2 et TP3 sont dans le sens du trade et croissants. N'invente aucune donnée.
Les chiffres INTERMARCHÉS fournis (dollar, taux US 10 ans) sont des mesures réelles : intègre-les à ton analyse fondamentale.\nveto=true uniquement pour un risque macro/géopolitique majeur. reasoning : 80 mots maximum, en français. strategies : liste courte (ex. "SMC", "Wyckoff", "Offre/Demande", "Figure", "MM50/200", "Macro").
Réponds STRICTEMENT par un objet JSON : {"decision":"BUY|SELL|NONE","confidence":0-100,"entry":nombre|null,"sl":nombre|null,"tp1":nombre|null,"tp2":nombre|null,"tp3":nombre|null,"strategies":["..."],"macro":"supportive|neutral|adverse","veto":true|false,"reasoning":"...","risks":["..."]}`;

const VERDICT_PROPS = {
  decision: { type: "string", enum: ["BUY", "SELL", "NONE"] }, confidence: { type: "integer", minimum: 0, maximum: 100 },
  macro: { type: "string", enum: ["supportive", "neutral", "adverse"] }, veto: { type: "boolean" },
  reasoning: { type: "string" }, risks: { type: "array", items: { type: "string" } },
};
const VERDICT_SCHEMA = { type: "object", properties: VERDICT_PROPS, required: ["decision", "confidence", "macro", "veto", "reasoning"] };
const num = { type: ["number", "null"] };
const INDEP_SCHEMA = {
  type: "object",
  properties: { ...VERDICT_PROPS, entry: num, sl: num, tp1: num, tp2: num, tp3: num, strategies: { type: "array", items: { type: "string" } } },
  required: ["decision", "confidence", "macro", "veto", "reasoning"],
};

interface Raw { provider: string; raw: string }

async function callDeepSeek(env: Env, system: string, user: string, maxTokens: number): Promise<Raw> {
  // `deepseek-v4-pro` = alias demandé ; repli automatique sur `deepseek-flash` (V4.1 Flash) s'il est refusé.
  const models = [env.DEEPSEEK_MODEL || "deepseek-v4-pro", "deepseek-flash"];
  let lastErr = "";
  for (const model of models) {
    const res = await fetch("https://api.deepseek.com/chat/completions", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${env.DEEPSEEK_API_KEY ?? ""}` },
      body: JSON.stringify({
        model, max_tokens: maxTokens, thinking: { type: "enabled" }, reasoning_effort: "high", response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(200_000),
    });
    if (!res.ok) { lastErr = `${model} HTTP ${res.status} ${(await res.text()).slice(0, 150)}`; continue; }
    const j = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return { provider: `deepseek:${model}`, raw: j.choices?.[0]?.message?.content ?? "" };
  }
  throw new Error(`DeepSeek: ${lastErr}`);
}

// OpenAI GPT-6 via l'API Responses (surface principale d'OpenAI). La sortie JSON est demandée par `text.format`.
// Modèle par défaut : gpt-6-luna (second avis) ; OPENAI_MODEL permet d'en choisir un autre. La couche fondamentale utilise gpt-6-sol (OPENAI_SOL_MODEL).
async function callOpenAI(env: Env, system: string, user: string, maxTokens: number, opts: { model?: string; effort?: string } = {}): Promise<Raw> {
  const models = [opts.model || env.OPENAI_MODEL || "gpt-6-luna"]; // gpt-6-luna : modèle GPT-6 le plus économique (0,10 $ / 1M tokens en entrée, 0,50 $ en sortie)
  const wanted = opts.effort ?? env.OPENAI_EFFORT ?? "";
  const effort = ["low", "medium", "high", "xhigh", "max"].includes(wanted) ? wanted : "medium";
  let lastErr = "";
  for (const model of models) {
    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: { "content-type": "application/json", Authorization: `Bearer ${env.OPENAI_API_KEY ?? ""}` },
      body: JSON.stringify({
        model, reasoning: { effort }, max_output_tokens: Math.max(maxTokens, 6000), text: { format: { type: "json_object" } },
        input: [{ role: "system", content: system }, { role: "user", content: user }],
      }),
      signal: AbortSignal.timeout(200_000),
    });
    const j = (await res.json().catch(() => ({}))) as { status?: string; error?: { message?: string }; output?: Array<{ type: string; content?: Array<{ type: string; text?: string }> }> };
    if (res.status === 401 || res.status === 429 || res.status >= 500) throw new Error(`OpenAI HTTP ${res.status} ${(j.error?.message ?? "").slice(0, 150)}`);
    if (!res.ok) { lastErr = `${model} HTTP ${res.status} ${(j.error?.message ?? "").slice(0, 150)}`; continue; }
    if (j.status === "incomplete") throw new Error(`OpenAI ${model} : réponse incomplète (limite de sortie atteinte)`);
    const text = (j.output ?? []).filter((o) => o.type === "message").flatMap((o) => o.content ?? []).filter((c) => c.type === "output_text").map((c) => c.text ?? "").join("");
    return { provider: `openai:${model}`, raw: text };
  }
  throw new Error(`OpenAI : ${lastErr}`);
}

async function callGemini(env: Env, system: string, user: string, maxTokens: number): Promise<Raw> {
  const model = env.GEMINI_MODEL || "gemini-3.1-pro-preview";
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY ?? "" },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: "user", parts: [{ text: user }] }],
      generationConfig: { responseMimeType: "application/json", maxOutputTokens: maxTokens },
    }),
    signal: AbortSignal.timeout(200_000),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status} ${(await res.text()).slice(0, 150)}`);
  const j = (await res.json()) as { candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean }> } }> };
  return { provider: `gemini:${model}`, raw: (j.candidates?.[0]?.content?.parts ?? []).filter((p) => !p.thought).map((p) => p.text ?? "").join("") };
}

async function callClaude(env: Env, system: string, user: string, schema: object, maxTokens: number): Promise<Raw> {
  const model = env.CLAUDE_MODEL || "claude-sonnet-5-5";
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": env.ANTHROPIC_API_KEY ?? "", "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }],
      tools: [{ name: "verdict", description: "Verdict structuré.", input_schema: schema }],
      tool_choice: { type: "tool", name: "verdict" },
    }),
    signal: AbortSignal.timeout(150_000),
  });
  if (!res.ok) throw new Error(`Claude HTTP ${res.status} ${(await res.text()).slice(0, 150)}`);
  const j = (await res.json()) as { content?: Array<{ type: string; input?: unknown }> };
  const tu = j.content?.find((b) => b.type === "tool_use");
  if (!tu) throw new Error("Claude: pas de tool_use");
  return { provider: `claude:${model}`, raw: JSON.stringify(tu.input) };
}

export function configuredAIs(env: Env): string[] {
  return [env.OPENAI_API_KEY && "openai", env.DEEPSEEK_API_KEY && "deepseek", env.GEMINI_API_KEY && "gemini", env.ANTHROPIC_API_KEY && "claude"].filter(Boolean) as string[];
}

// Relance une fois sur erreur transitoire (429 / 5xx / réseau) : une IA momentanément indisponible ne doit pas être écartée trop vite.
async function retry<T>(f: () => Promise<T>): Promise<T> {
  try { return await f(); } catch (e) {
    if (!/HTTP (429|5\d\d)|fetch failed|network/i.test(String((e as Error).message))) throw e;
    await new Promise((r) => setTimeout(r, 4000));
    return f();
  }
}

async function askAll(env: Env, system: string, user: string, schema: object, maxTokens: number): Promise<{ raws: Raw[]; errors: string[] }> {
  const jobs: Array<Promise<Raw>> = [];
  if (env.OPENAI_API_KEY) jobs.push(retry(() => callOpenAI(env, system, user, maxTokens)));
  if (env.DEEPSEEK_API_KEY) jobs.push(retry(() => callDeepSeek(env, system, user, maxTokens)));
  if (env.GEMINI_API_KEY) jobs.push(retry(() => callGemini(env, system, user, maxTokens)));
  if (env.ANTHROPIC_API_KEY) jobs.push(retry(() => callClaude(env, system, user, schema, Math.min(maxTokens, 2000))));
  const res = await Promise.allSettled(jobs);
  const raws: Raw[] = [], errors: string[] = [];
  for (const r of res) r.status === "fulfilled" ? raws.push(r.value) : errors.push(String(r.reason?.message ?? r.reason).slice(0, 200));
  return { raws, errors };
}

const toNum = (v: unknown): number | null => { const x = typeof v === "number" ? v : parseFloat(String(v)); return Number.isFinite(x) ? x : null; };

function parseObj(provider: string, raw: string): Record<string, unknown> {
  const m = raw.match(/\{[\s\S]*\}/);
  if (!m) throw new Error(`${provider}: réponse sans JSON`);
  return JSON.parse(m[0]) as Record<string, unknown>;
}
function toVerdict(provider: string, j: Record<string, unknown>): Verdict {
  const dec = String(j.decision ?? "NONE").toUpperCase(), mac = String(j.macro ?? "neutral").toLowerCase();
  return {
    provider, decision: dec === "BUY" || dec === "SELL" ? dec : "NONE",
    confidence: Math.max(0, Math.min(100, Math.round(toNum(j.confidence) ?? 0))),
    macro: mac === "supportive" || mac === "adverse" ? mac : "neutral", veto: j.veto === true,
    reasoning: String(j.reasoning ?? "").slice(0, 700), risks: Array.isArray(j.risks) ? j.risks.map(String).slice(0, 5) : [],
  };
}
function collect<T>(raws: Raw[], errors: string[], f: (provider: string, j: Record<string, unknown>) => T): { out: T[]; errors: string[] } {
  const out: T[] = [];
  for (const r of raws) { try { out.push(f(r.provider, parseObj(r.provider, r.raw))); } catch (e) { errors.push(String((e as Error).message).slice(0, 200)); } }
  return { out, errors };
}

// ---------- 1) Validation d'un setup du moteur ----------
export async function askAIs(env: Env, user: string): Promise<{ verdicts: Verdict[]; errors: string[] }> {
  const { raws, errors } = await askAll(env, SYSTEM_PROMPT, user, VERDICT_SCHEMA, 4000);
  const c = collect(raws, errors, toVerdict);
  return { verdicts: c.out, errors: c.errors };
}

// Couche hybride : GPT seul fournit un second avis, sans jamais bloquer le moteur autonome.
export async function askGPT(env: Env, user: string): Promise<{ verdict: Verdict | null; error: string | null }> {
  if (!env.OPENAI_API_KEY) return { verdict: null, error: "clé OpenAI absente" };
  try {
    const raw = await retry(() => callOpenAI(env, SYSTEM_PROMPT, user, 2500));
    return { verdict: toVerdict(raw.provider, parseObj(raw.provider, raw.raw)), error: null };
  } catch (e) {
    return { verdict: null, error: String((e as Error).message ?? e).slice(0, 220) };
  }
}

// ---------- 3) Deuxième couche d'analyse FONDAMENTALE : GPT-6 Sol ----------
// Lit uniquement les données macro mesurées (taux directeurs, Treasuries, TIPS, COT, pétrole, VIX, dollar, scores autonomes, calendrier, actualités)
// et rend un biais fondamental de l'actif. Pas de graphiques, pas de niveaux, pas de veto : le moteur autonome garde la décision finale.
export interface FundVerdict {
  provider: string; bias: "bullish" | "bearish" | "neutral"; confidence: number;
  drivers: string[]; risks: string[]; gaps: string[]; reasoning: string;
}
export const FUND_SYSTEM_PROMPT = `Tu es un analyste macro-fondamental senior (forex, or, crypto). Tu es la DEUXIÈME couche d'analyse fondamentale d'un moteur de signaux : une première couche déterministe a déjà calculé des scores.
Ta mission : (1) lire les DONNÉES MESURÉES fournies (taux directeurs BIS, courbe des Treasuries, rendement réel TIPS, positionnement COT, pétrole, VIX, indice dollar, scores macro autonomes, surprises du calendrier, actualités) ; (2) en déduire le biais fondamental de l'actif pour les prochains jours ; (3) citer les 2 à 4 facteurs déterminants, les risques d'événement à venir et les données manquantes.
Règles : n'invente aucun chiffre ni événement absent des données ; si les données sont insuffisantes ou contradictoires, réponds "neutral" avec une confiance basse. Le COT est hebdomadaire et les taux BIS sont des dates d'effet : ce ne sont pas des données intraday. Tu n'analyses pas les graphiques et ne proposes pas de niveaux. La direction proposée par le moteur technique est une simple information : juge si le fondamental la soutient, sans chercher à la confirmer.
"bullish" = hausse attendue de l'actif tel qu'écrit (pour EUR/USD : hausse de EUR/USD). confidence = fiabilité de TON biais (0-100), pas une probabilité de gain. reasoning : 120 mots maximum, en français.
Réponds STRICTEMENT par un objet JSON : {"bias":"bullish|bearish|neutral","confidence":0-100,"drivers":["..."],"risks":["..."],"data_gaps":["..."],"reasoning":"..."}`;

export function toFundVerdict(provider: string, j: Record<string, unknown>): FundVerdict {
  const b = String(j.bias ?? "neutral").toLowerCase();
  const list = (v: unknown, n: number) => (Array.isArray(v) ? v.map((x) => String(x).slice(0, 200)).slice(0, n) : []);
  return {
    provider, bias: b === "bullish" || b === "bearish" ? b : "neutral",
    confidence: Math.max(0, Math.min(100, Math.round(toNum(j.confidence) ?? 0))),
    drivers: list(j.drivers, 4), risks: list(j.risks, 3), gaps: list(j.data_gaps, 3), reasoning: String(j.reasoning ?? "").slice(0, 900),
  };
}
// Alignement du biais fondamental avec la direction du moteur technique (calculé ici, pas laissé au modèle).
export function fundAlignment(dir: "BUY" | "SELL", bias: FundVerdict["bias"]): "aligned" | "against" | "neutral" {
  if (bias === "neutral") return "neutral";
  return (dir === "BUY") === (bias === "bullish") ? "aligned" : "against";
}
export function fundSummary(v: FundVerdict, dir: "BUY" | "SELL"): string {
  const side = dir === "BUY" ? "l'achat" : "la vente";
  const al = { aligned: `aligné avec ${side}`, against: `contraire à ${side}`, neutral: `neutre face à ${side}` }[fundAlignment(dir, v.bias)];
  const bias = { bullish: "haussier", bearish: "baissier", neutral: "neutre" }[v.bias];
  return `Biais fondamental ${bias} (${al}).${v.drivers.length ? ` Facteurs : ${v.drivers.join(" ; ")}.` : ""}${v.reasoning ? ` ${v.reasoning}` : ""}`;
}
export async function askFundamentalSol(env: Env, user: string): Promise<{ verdict: FundVerdict | null; error: string | null }> {
  if (!env.OPENAI_API_KEY) return { verdict: null, error: "clé OpenAI absente" };
  try {
    const raw = await retry(() => callOpenAI(env, FUND_SYSTEM_PROMPT, user, 6000, { model: env.OPENAI_SOL_MODEL || "gpt-6-sol", effort: env.OPENAI_SOL_EFFORT || "medium" }));
    return { verdict: toFundVerdict(raw.provider, parseObj(raw.provider, raw.raw)), error: null };
  } catch (e) {
    return { verdict: null, error: String((e as Error).message ?? e).slice(0, 220) };
  }
}

// Majorité requise : 1 IA dispo → elle confirme ; 2 → les deux ; 3 → au moins 2 ; 4 → au moins 3 (majorité stricte). Aucun veto toléré.
const needOf = (n: number) => (n <= 2 ? n : Math.floor(n / 2) + 1);
export function consensus(verdicts: Verdict[], dir: "BUY" | "SELL"): { ok: boolean; agree: Verdict[]; reason: string } {
  const n = verdicts.length;
  if (n === 0) return { ok: false, agree: [], reason: "aucune IA n'a répondu" };
  const minConf = n === 1 ? 75 : 60; // une seule IA = pas de recoupement : on exige plus de confiance
  const agree = verdicts.filter((v) => v.decision === dir && v.confidence >= minConf && v.macro !== "adverse");
  const need = needOf(n);
  const veto = verdicts.find((v) => v.veto);
  if (veto) return { ok: false, agree, reason: `veto ${veto.provider} : ${veto.reasoning}` };
  if (agree.length < need) return { ok: false, agree, reason: `consensus insuffisant (${agree.length}/${need} requis sur ${n} IA)` };
  return { ok: true, agree, reason: `${agree.length}/${n} IA confirment` };
}

// ---------- 2) Analyse indépendante ----------
export async function askIndependent(env: Env, user: string): Promise<{ verdicts: IndepVerdict[]; errors: string[] }> {
  const { raws, errors } = await askAll(env, INDEP_SYSTEM_PROMPT, user, INDEP_SCHEMA, 8000);
  const c = collect(raws, errors, (provider, j): IndepVerdict => ({
    ...toVerdict(provider, j), entry: toNum(j.entry), sl: toNum(j.sl), tp1: toNum(j.tp1), tp2: toNum(j.tp2), tp3: toNum(j.tp3),
    strategies: Array.isArray(j.strategies) ? j.strategies.map(String).slice(0, 5) : [],
  }));
  return { verdicts: c.out, errors: c.errors };
}

// Même règle de majorité ; le sens retenu est celui qui obtient le plus de voix valides (confiance >= 65, macro non défavorable).
export function independentConsensus(vs: IndepVerdict[]): { ok: boolean; dir: "BUY" | "SELL" | null; agree: IndepVerdict[]; reason: string } {
  const n = vs.length;
  if (n === 0) return { ok: false, dir: null, agree: [], reason: "aucune IA n'a répondu" };
  const veto = vs.find((v) => v.veto);
  if (veto) return { ok: false, dir: null, agree: [], reason: `veto ${veto.provider} : ${veto.reasoning}` };
  const minConf = n === 1 ? 75 : 65; // une seule IA = pas de recoupement : on exige plus de confiance
  const valid = (v: IndepVerdict, d: "BUY" | "SELL") => v.decision === d && v.confidence >= minConf && v.macro !== "adverse";
  const buys = vs.filter((v) => valid(v, "BUY")), sells = vs.filter((v) => valid(v, "SELL"));
  const need = needOf(n);
  const dir: "BUY" | "SELL" = buys.length >= sells.length ? "BUY" : "SELL";
  const agree = dir === "BUY" ? buys : sells;
  if (agree.length < need) return { ok: false, dir: null, agree, reason: agree.length === 0 ? "aucun setup retenu par les IA" : `consensus insuffisant (${agree.length}/${need} requis sur ${n} IA)` };
  return { ok: true, dir, agree, reason: `${agree.length}/${n} IA proposent un ${dir}` };
}

const median = (xs: number[]): number | null => {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
// Niveaux retenus = médiane des niveaux proposés par les IA d'accord.
export function mergeLevels(agree: IndepVerdict[]): { entry: number | null; sl: number | null; tp1: number | null; tp2: number | null; tp3: number | null } {
  const pick = (k: "entry" | "sl" | "tp1" | "tp2" | "tp3") => median(agree.map((v) => v[k]).filter((x): x is number => x !== null));
  return { entry: pick("entry"), sl: pick("sl"), tp1: pick("tp1"), tp2: pick("tp2"), tp3: pick("tp3") };
}
