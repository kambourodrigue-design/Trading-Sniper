export type Session = "fx" | "us" | "crypto";
export type ProviderName = "oanda" | "twelvedata" | "binance" | "kraken" | "yahoo";
export interface Src { p: ProviderName; id: string }
export interface SymbolCfg { symbol: string; label: string; currencies: string[]; session: Session; sources: Src[] }

// Actifs surveillés.  symbol = nom affiché (noms des CFD MT5) ; sources = fournisseurs de données, essayés dans l'ordre (repli automatique).
//   fx     : forex/métaux/indices CFD, ouvert du dimanche 22h au vendredi 22h UTC
//   us     : indices US sur données « cash » (Yahoo) → séance 9h30-16h, heure de New York (utilisé seulement si OANDA n'est pas configuré)
//   crypto : 24h/24, 7j/7
// Sources gratuites :
//   oanda       compte DÉMO gratuit → jeton API (secret OANDA_API_TOKEN) : forex, or, indices US30/NAS100 en CFD, H4 natif. Recommandé.
//   twelvedata  clé gratuite (secret TWELVEDATA_API_KEY) : forex, or, crypto (pas les indices) ; 800 crédits/jour
//   binance / kraken  Bitcoin, sans clé
//   yahoo       sans clé mais non officiel : bloque souvent les serveurs (dernier recours)
export const SYMBOLS: SymbolCfg[] = [
  { symbol: "XAU/USD", label: "Or", currencies: ["USD"], session: "fx",
    sources: [{ p: "oanda", id: "XAU_USD" }, { p: "twelvedata", id: "XAU/USD" }, { p: "yahoo", id: "XAUUSD=X" }] },
  { symbol: "US30", label: "Dow Jones (US30)", currencies: ["USD"], session: "us",
    sources: [{ p: "oanda", id: "US30_USD" }, { p: "yahoo", id: "^DJI" }, { p: "twelvedata", id: "DJI" }] },
  { symbol: "USTEC", label: "Nasdaq 100 (USTEC)", currencies: ["USD"], session: "us",
    sources: [{ p: "oanda", id: "NAS100_USD" }, { p: "yahoo", id: "^NDX" }, { p: "twelvedata", id: "NDX" }] },
  { symbol: "BTC/USD", label: "Bitcoin", currencies: ["USD"], session: "crypto",
    sources: [{ p: "binance", id: "BTCUSDT" }, { p: "kraken", id: "XBTUSD" }, { p: "oanda", id: "BTC_USD" }, { p: "twelvedata", id: "BTC/USD" }, { p: "yahoo", id: "BTC-USD" }] },
  // Exemples à décommenter pour ajouter du forex (même format) :
  // { symbol: "EUR/USD", label: "Euro / Dollar", currencies: ["EUR", "USD"], session: "fx", sources: [{ p: "oanda", id: "EUR_USD" }, { p: "twelvedata", id: "EUR/USD" }, { p: "yahoo", id: "EURUSD=X" }] },
  // { symbol: "GBP/JPY", label: "Livre / Yen", currencies: ["GBP", "JPY"], session: "fx", sources: [{ p: "oanda", id: "GBP_JPY" }, { p: "twelvedata", id: "GBP/JPY" }, { p: "yahoo", id: "GBPJPY=X" }] },
  // { symbol: "USDJPY", label: "Dollar / Yen", currencies: ["USD", "JPY"], session: "fx", sources: [{ p: "oanda", id: "USD_JPY" }, { p: "twelvedata", id: "USD/JPY" }, { p: "yahoo", id: "USDJPY=X" }] },
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
