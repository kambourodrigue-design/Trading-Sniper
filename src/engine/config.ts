export type Session = "fx" | "us" | "crypto";
export type ProviderName = "biquote" | "yahoo";
export interface Src { p: ProviderName; market: string; id: string }
export interface SymbolCfg { symbol: string; label: string; currencies: string[]; session: Session; sources: Src[] }

// Flux principal BiQuote (sans clé), avec Yahoo Finance en unique repli.
// Les symboles biquote suivent le catalogue MT5 documenté : EURUSD, XAUUSD, BTCUSD, etc.
export const SYMBOLS: SymbolCfg[] = [
  { symbol: "XAU/USD", label: "Or", currencies: ["USD"], session: "fx", sources: [{ p: "biquote", market: "metals", id: "XAUUSD" }, { p: "yahoo", market: "metals-futures-proxy", id: "GC=F" }] },
  { symbol: "EUR/USD", label: "Euro / Dollar", currencies: ["EUR", "USD"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "EURUSD" }, { p: "yahoo", market: "forex", id: "EURUSD=X" }] },
  { symbol: "GBP/USD", label: "Livre / Dollar", currencies: ["GBP", "USD"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "GBPUSD" }, { p: "yahoo", market: "forex", id: "GBPUSD=X" }] },
  { symbol: "USD/JPY", label: "Dollar / Yen", currencies: ["USD", "JPY"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "USDJPY" }, { p: "yahoo", market: "forex", id: "JPY=X" }] },
  { symbol: "USD/CAD", label: "Dollar / Dollar canadien", currencies: ["USD", "CAD"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "USDCAD" }, { p: "yahoo", market: "forex", id: "CAD=X" }] },
  { symbol: "USD/CHF", label: "Dollar / Franc suisse", currencies: ["USD", "CHF"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "USDCHF" }, { p: "yahoo", market: "forex", id: "CHF=X" }] },
  { symbol: "AUD/USD", label: "Dollar australien / Dollar", currencies: ["AUD", "USD"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "AUDUSD" }, { p: "yahoo", market: "forex", id: "AUDUSD=X" }] },
  { symbol: "NZD/USD", label: "Dollar néo-zélandais / Dollar", currencies: ["NZD", "USD"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "NZDUSD" }, { p: "yahoo", market: "forex", id: "NZDUSD=X" }] },
  { symbol: "EUR/GBP", label: "Euro / Livre", currencies: ["EUR", "GBP"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "EURGBP" }, { p: "yahoo", market: "forex", id: "EURGBP=X" }] },
  { symbol: "EUR/JPY", label: "Euro / Yen", currencies: ["EUR", "JPY"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "EURJPY" }, { p: "yahoo", market: "forex", id: "EURJPY=X" }] },
  { symbol: "EUR/CAD", label: "Euro / Dollar canadien", currencies: ["EUR", "CAD"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "EURCAD" }, { p: "yahoo", market: "forex", id: "EURCAD=X" }] },
  { symbol: "GBP/JPY", label: "Livre / Yen", currencies: ["GBP", "JPY"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "GBPJPY" }, { p: "yahoo", market: "forex", id: "GBPJPY=X" }] },
  { symbol: "GBP/CAD", label: "Livre / Dollar canadien", currencies: ["GBP", "CAD"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "GBPCAD" }, { p: "yahoo", market: "forex", id: "GBPCAD=X" }] },
  { symbol: "BTC/USD", label: "Bitcoin", currencies: ["BTC", "USD"], session: "crypto", sources: [
    { p: "biquote", market: "crypto", id: "BTCUSD" }, { p: "yahoo", market: "crypto", id: "BTC-USD" },
  ] },
  { symbol: "ETH/USD", label: "Ethereum", currencies: ["ETH", "USD"], session: "crypto", sources: [
    { p: "biquote", market: "crypto", id: "ETHUSD" }, { p: "yahoo", market: "crypto", id: "ETH-USD" },
  ] },
];

export interface Profile { name: string; minScore: number; poiTolAtr: number; poiRecentBars: number; htfD1Only: boolean; minRoomR: number }
export const PROFILES: Record<string, Profile> = {
  strict:   { name: "strict",   minScore: 55, poiTolAtr: 0.25, poiRecentBars: 0, htfD1Only: false, minRoomR: 2.0 },
  balanced: { name: "balanced", minScore: 45, poiTolAtr: 0.5,  poiRecentBars: 3, htfD1Only: true,  minRoomR: 1.5 },
  active:   { name: "active",   minScore: 38, poiTolAtr: 0.75, poiRecentBars: 5, htfD1Only: true,  minRoomR: 1.2 },
  // Valeurs de base ; le profil adaptatif est recalculé pour chaque direction dans run.ts.
  adaptive: { name: "adaptive", minScore: 46, poiTolAtr: 0.45, poiRecentBars: 2, htfD1Only: false, minRoomR: 1.8 },
};

export const CFG = {
  maxPerRun: 1,
  tpRR: [1.5, 2.5, 4] as [number, number, number],
  maxRiskAtr: 3,
  minRoomR: 2,
  newsBeforeMin: 45,
  newsAfterMin: 20,
  expiryHours: 120,
  starterSymbols: ["XAU/USD", "BTC/USD"],
};
