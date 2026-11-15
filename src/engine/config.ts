export type Session = "fx" | "us" | "crypto";
export type ProviderName = "deriv";
export interface Src { p: ProviderName; id: string } // id = symbole Deriv (frxEURUSD…)
export interface SymbolCfg { symbol: string; label: string; currencies: string[]; session: Session; sources: Src[] }

// Actifs surveillés.  symbol = nom affiché (noms des CFD MT5) ; sources = fournisseurs de données, essayés dans l'ordre (repli automatique).
//   fx     : forex/métaux, ouvert du dimanche 22h au vendredi 22h UTC
//   us     : indices US → séance 9h30-16h, heure de New York
//   crypto : 24h/24, 7j/7
// Source de données unique : Deriv (WebSocket public, aucune clé ; bougies M15, H1, H4, D1).
// Symboles Deriv : forex « frxEURUSD », or « frxXAUUSD », Bitcoin « cryBTCUSD », indices « OTC_DJI » (US Wall Street 30) et « OTC_NDX » (US Tech 100).
// Si un symbole est refusé, Admin → Signaux → « Tester les données » affiche les symboles proches du catalogue Deriv.
const dv = (id: string): Src[] => [{ p: "deriv", id }];
export const SYMBOLS: SymbolCfg[] = [
  { symbol: "XAU/USD", label: "Or", currencies: ["USD"], session: "fx", sources: dv("frxXAUUSD") },
  { symbol: "BTC/USD", label: "Bitcoin", currencies: ["USD"], session: "crypto", sources: dv("cryBTCUSD") },
  { symbol: "EUR/USD", label: "Euro / Dollar", currencies: ["EUR", "USD"], session: "fx", sources: dv("frxEURUSD") },
  { symbol: "GBP/USD", label: "Livre / Dollar", currencies: ["GBP", "USD"], session: "fx", sources: dv("frxGBPUSD") },
  { symbol: "USD/JPY", label: "Dollar / Yen", currencies: ["USD", "JPY"], session: "fx", sources: dv("frxUSDJPY") },
  { symbol: "US30", label: "Dow Jones (US 30)", currencies: ["USD"], session: "us", sources: dv("OTC_DJI") },
  { symbol: "USTEC", label: "Nasdaq 100 (US Tech)", currencies: ["USD"], session: "us", sources: dv("OTC_NDX") },
];

// Profils de sélectivité (variable PROFILE). Le profil « strict » correspond à la première version du moteur.
export interface Profile { name: string; minScore: number; poiTolAtr: number; poiRecentBars: number; htfD1Only: boolean; minRoomR: number }
export const PROFILES: Record<string, Profile> = {
  strict:   { name: "strict",   minScore: 55, poiTolAtr: 0.25, poiRecentBars: 0, htfD1Only: false, minRoomR: 2.0 },
  balanced: { name: "balanced", minScore: 45, poiTolAtr: 0.5,  poiRecentBars: 3, htfD1Only: true,  minRoomR: 1.5 },
  active:   { name: "active",   minScore: 38, poiTolAtr: 0.75, poiRecentBars: 5, htfD1Only: true,  minRoomR: 1.2 },
};

export const CFG = {
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
