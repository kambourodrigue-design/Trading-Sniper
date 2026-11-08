// Couche IA : DeepSeek, Gemini et Claude, appelés en parallèle (chaque IA n'est utilisée que si sa clé est configurée ; une seule suffit).
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
veto=true uniquement pour un risque macro/géopolitique majeur. reasoning : 60 mots maximum, en français.
Réponds STRICTEMENT par un objet JSON : {"decision":"BUY|SELL|NONE","confidence":0-100,"macro":"supportive|neutral|adverse","veto":true|false,"reasoning":"...","risks":["..."]}`;

export const INDEP_SYSTEM_PROMPT = `Tu es un trader professionnel et analyste macro (Smart Money Concepts, Wyckoff, offre/demande, price action, figures chartistes, moyennes mobiles 50/200, analyse fondamentale).
On te donne les bougies récentes (D1, H4, H1), des indicateurs calculés et le contexte macro/géopolitique. Fais TA PROPRE analyse top-down (D1 puis H4 puis H1). Les détections automatiques fournies "à titre indicatif" ne te lient pas : tu peux les contredire.
Propose un trade UNIQUEMENT si le setup est de haute probabilité : tendance supérieure cohérente, zone ou structure claire, confirmation, contexte fondamental non défavorable, et ratio gain/risque >= 2 sur TP2. Sinon réponds "NONE" : ne force jamais un trade.
Niveaux : utilise uniquement des prix cohérents avec les bougies fournies. L'entrée est au marché, au prix actuel indiqué (entry = prix actuel, ou null). Le SL se place au-delà du point d'invalidation (entre 0.5 et 3 ATR du prix). TP1, TP2 et TP3 sont dans le sens du trade et croissants. N'invente aucune donnée.
veto=true uniquement pour un risque macro/géopolitique majeur. reasoning : 80 mots maximum, en français. strategies : liste courte (ex. "SMC", "Wyckoff", "Offre/Demande", "Figure", "MM50/200", "Macro").
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
  return [env.DEEPSEEK_API_KEY && "deepseek", env.GEMINI_API_KEY && "gemini", env.ANTHROPIC_API_KEY && "claude"].filter(Boolean) as string[];
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

// Consensus : 1 IA dispo → elle confirme ; 2 → les deux ; 3 → au moins 2. Aucun veto toléré.
export function consensus(verdicts: Verdict[], dir: "BUY" | "SELL"): { ok: boolean; agree: Verdict[]; reason: string } {
  const n = verdicts.length;
  if (n === 0) return { ok: false, agree: [], reason: "aucune IA n'a répondu" };
  const minConf = n === 1 ? 75 : 60; // une seule IA = pas de recoupement : on exige plus de confiance
  const agree = verdicts.filter((v) => v.decision === dir && v.confidence >= minConf && v.macro !== "adverse");
  const need = n <= 2 ? n : Math.ceil(n / 2);
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
  const need = n <= 2 ? n : Math.ceil(n / 2);
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
