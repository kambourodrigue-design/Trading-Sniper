export type Session = "fx" | "us" | "crypto";
export interface SymbolCfg { symbol: string; td: string; label: string; currencies: string[]; session: Session }

// Actifs surveillés.  symbol = nom affiché aux abonnés (noms des CFD MT5) ; td = symbole chez TwelveData.
//   fx     : forex/métaux, ouvert du dimanche 22h au vendredi 22h UTC
//   us     : indices US (données = indice « cash » → séance 9h30-16h, heure de New York, jours ouvrés)
//   crypto : 24h/24, 7j/7
// ⚠ Les indices (DJI, NDX) ne sont PAS inclus dans le plan gratuit TwelveData : tant que le plan ne les inclut pas,
//   le moteur désactive proprement l'actif (message visible dans l'admin) et continue avec les autres.
export const SYMBOLS: SymbolCfg[] = [
  { symbol: "XAU/USD", td: "XAU/USD", label: "Or", currencies: ["USD"], session: "fx" },
  { symbol: "US30", td: "DJI", label: "Dow Jones (US30)", currencies: ["USD"], session: "us" },
  { symbol: "USTEC", td: "NDX", label: "Nasdaq 100 (USTEC)", currencies: ["USD"], session: "us" },
  { symbol: "BTC/USD", td: "BTC/USD", label: "Bitcoin", currencies: ["USD"], session: "crypto" },
];

export const CFG = {
  minScore: 55,            // score de confluence minimal (0-100) ; surchargeable via la variable MIN_SCORE
  maxPerRun: 1,            // actifs analysés par passage du cron (Workers Free : 1 ; Workers Paid : 4)
  tpRR: [1.5, 2.5, 4] as [number, number, number], // TP1/TP2/TP3 en multiples du risque
  minRiskAtr: 0.8,         // SL au moins 0.8 ATR (élargi si plus serré)
  maxRiskAtr: 3,           // SL au plus 3 ATR (sinon setup rejeté)
  minRoomR: 2,             // espace libre minimal vers l'obstacle HTF, en multiples du risque
  newsBeforeMin: 45,       // pas de signal 45 min avant une news à fort impact
  newsAfterMin: 20,        // ... ni 20 min après
  expiryHours: 120,        // filet de sécurité : un trade sans TP ni SL après 5 jours est clôturé « expiré »
  starterSymbols: ["XAU/USD", "BTC/USD"], // actifs accessibles au plan Starter
};
