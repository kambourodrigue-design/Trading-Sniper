/**
 * Fundamental Intelligence V2.
 * Parses only sourced, timestamped macro context produced by src/lib/macro.ts.
 * Missing/low-coverage data is neutral: it is never fabricated and never vetoes a setup.
 */
export type FundamentalBias = "BUY" | "SELL" | "NEUTRAL";
export interface FundamentalAssessment {
  bias: FundamentalBias;
  coverage: number;
  strength: number;
  adjustment: number;
  veto: boolean;
  summary: string;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function assessFundamentals(
  symbol: string,
  direction: "BUY" | "SELL",
  macroText: string
): FundamentalAssessment {
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pair = macroText.match(new RegExp(`${escaped}\\s*:\\s*(haussier|baissier|neutre)\\s*\\(écart indicatif\\s*(-?\\d+)\\s*points\\)`, "i"));
  if (!pair) {
    return { bias: "NEUTRAL", coverage: 0, strength: 0, adjustment: 0, veto: false,
      summary: "Fondamental indisponible ou biais non calculable : aucun bonus ni pénalité." };
  }

  const diff = Number(pair[2]);
  const bias: FundamentalBias = pair[1].toLowerCase() === "haussier" ? "BUY"
    : pair[1].toLowerCase() === "baissier" ? "SELL" : "NEUTRAL";

  // Couverture des deux devises : les lignes macro donnent explicitement un indicateur /100.
  const currencies = symbol.split("/");
  let coverage = 0;
  if (currencies.length === 2) {
    const values = currencies.map((ccy) => {
      const m = macroText.match(new RegExp(`(?:^|\\n)${ccy}\\s+\\d+/100\\s*\\(couverture\\s+(\\d+)/100`, "i"));
      return m ? Number(m[1]) : 0;
    });
    coverage = Math.round(values.reduce((a,b)=>a+b,0) / values.length);
  } else {
    const m = macroText.match(/(?:^|\n)USD\s+\d+\/100\s*\(couverture\s+(\d+)\/100/i);
    coverage = m ? Number(m[1]) : 0;
  }

  const strength = clamp(Math.abs(diff), 0, 40) / 40;
  if (coverage < 35 || bias === "NEUTRAL" || strength < 0.2) {
    return { bias, coverage, strength, adjustment: 0, veto: false,
      summary: `Biais fondamental ${bias.toLowerCase()}, couverture ${coverage}/100 : signal trop faible pour influencer le setup.` };
  }

  const aligned = bias === direction;
  const adjustment = aligned ? Math.round(8 * strength) : -Math.round(12 * strength);
  // Veto uniquement en cas de contradiction macro forte ET de bonne couverture.
  const veto = !aligned && coverage >= 70 && Math.abs(diff) >= 25;
  return {
    bias, coverage, strength, adjustment, veto,
    summary: `Biais fondamental ${bias === "BUY" ? "haussier" : "baissier"} ${aligned ? "aligné" : "opposé"} au setup ; écart ${diff} pts, couverture ${coverage}/100, ajustement ${adjustment > 0 ? "+" : ""}${adjustment}.`
  };
}
