export type Session = "fx" | "us" | "crypto";
export type ProviderName = "lse" | "binance";
export interface Src { p: ProviderName; market: string; id: string } // market = dossier LSE (forex, crypto, commodities…), id = symbole du catalogue LSE
export interface SymbolCfg { symbol: string; label: string; currencies: string[]; session: Session; sources: Src[] }

// Actifs surveillés.  symbol = nom affiché (noms des CFD MT5) ; sources = fournisseurs de données, essayés dans l'ordre (repli automatique).
//   fx     : forex/métaux, ouvert du dimanche 22h au vendredi 22h UTC
//   us     : indices US → séance 9h30-16h, heure de New York
//   crypto : 24h/24, 7j/7
// Source de données unique : LSE Data (secret LSE_API_KEY ; plan gratuit : 60 appels/min ; bougies M15, H1, H4, D1).
// Symboles LSE : forex « EUR_USD », crypto cotée en Tether « BTCUSDT ». L'or : plusieurs orthographes possibles selon le catalogue,
// essayées dans l'ordre. Si aucune ne répond, Admin → Signaux → « Tester les données » affiche les symboles proches du catalogue.
export const SYMBOLS: SymbolCfg[] = [
  { symbol: "XAU/USD", label: "Or", currencies: ["USD"], session: "fx",
    sources: [{ p: "lse", market: "commodities", id: "XAU/USD" }, { p: "lse", market: "forex", id: "XAU_USD" }, { p: "lse", market: "commodities", id: "XAU_USD" }, { p: "lse", market: "commodities", id: "XAUUSD" }, { p: "lse", market: "commodities", id: "GOLD" }] },
  { symbol: "BTC/USD", label: "Bitcoin", currencies: ["USD"], session: "crypto",
    sources: [{ p: "binance", market: "spot", id: "BTCUSDT" }, { p: "lse", market: "crypto", id: "BTCUSDT" }] }, // Binance (public, temps réel, sans clé) en premier ; LSE en repli
  // Exemples à décommenter pour ajouter du forex (même format) :
  // { symbol: "EUR/USD", label: "Euro / Dollar", currencies: ["EUR", "USD"], session: "fx", sources: [{ p: "lse", market: "forex", id: "EUR_USD" }] },
  // { symbol: "GBP/JPY", label: "Livre / Yen", currencies: ["GBP", "JPY"], session: "fx", sources: [{ p: "lse", market: "forex", id: "GBP_JPY" }] },
  // { symbol: "USDJPY", label: "Dollar / Yen", currencies: ["USD", "JPY"], session: "fx", sources: [{ p: "lse", market: "forex", id: "USD_JPY" }] },
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
