export type Session = "fx" | "us" | "crypto";
export type ProviderName = "yahoo" | "binance" | "twelvedata";
export interface Src { p: ProviderName; id: string }
export interface SymbolCfg { symbol: string; label: string; currencies: string[]; session: Session; sources: Src[] }

// Actifs surveillés.  symbol = nom affiché (noms des CFD MT5) ; sources = fournisseurs de données, essayés dans l'ordre.
//   fx     : forex/métaux, ouvert du dimanche 22h au vendredi 22h UTC
//   us     : indices US (données = indice « cash » → séance 9h30-16h, heure de New York, jours ouvrés)
//   crypto : 24h/24, 7j/7
// Fournisseurs gratuits sans clé : Yahoo Finance (non officiel, usage personnel, peut renvoyer 429) et Binance (bougies crypto,
// hôte data-api.binance.vision). TwelveData n'est utilisé qu'en dernier recours, si TWELVEDATA_API_KEY est définie.
export const SYMBOLS: SymbolCfg[] = [
  { symbol: "XAU/USD", label: "Or", currencies: ["USD"], session: "fx",
    sources: [{ p: "yahoo", id: "XAUUSD=X" }, { p: "twelvedata", id: "XAU/USD" }] },
  { symbol: "US30", label: "Dow Jones (US30)", currencies: ["USD"], session: "us",
    sources: [{ p: "yahoo", id: "^DJI" }, { p: "twelvedata", id: "DJI" }] },
  { symbol: "USTEC", label: "Nasdaq 100 (USTEC)", currencies: ["USD"], session: "us",
    sources: [{ p: "yahoo", id: "^NDX" }, { p: "twelvedata", id: "NDX" }] },
  { symbol: "BTC/USD", label: "Bitcoin", currencies: ["USD"], session: "crypto",
    sources: [{ p: "binance", id: "BTCUSDT" }, { p: "yahoo", id: "BTC-USD" }, { p: "twelvedata", id: "BTC/USD" }] },
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
