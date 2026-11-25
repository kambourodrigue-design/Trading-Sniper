export type Session = "fx" | "us" | "crypto";
export type ProviderName = "biquote" | "binance" | "kraken";
export interface Src { p: ProviderName; market: string; id: string }
export interface SymbolCfg { symbol: string; label: string; currencies: string[]; session: Session; sources: Src[] }

// Flux principal biquote (sans clé). Binance/Kraken sont des replis uniquement pour les cryptomonnaies.
// Les symboles biquote suivent le catalogue MT5 documenté : EURUSD, XAUUSD, BTCUSD, etc.
export const SYMBOLS: SymbolCfg[] = [
  { symbol: "XAU/USD", label: "Or", currencies: ["USD"], session: "fx", sources: [{ p: "biquote", market: "metals", id: "XAUUSD" }] },
  { symbol: "EUR/USD", label: "Euro / Dollar", currencies: ["EUR", "USD"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "EURUSD" }] },
  { symbol: "GBP/USD", label: "Livre / Dollar", currencies: ["GBP", "USD"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "GBPUSD" }] },
  { symbol: "USD/JPY", label: "Dollar / Yen", currencies: ["USD", "JPY"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "USDJPY" }] },
  { symbol: "USD/CAD", label: "Dollar / Dollar canadien", currencies: ["USD", "CAD"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "USDCAD" }] },
  { symbol: "USD/CHF", label: "Dollar / Franc suisse", currencies: ["USD", "CHF"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "USDCHF" }] },
  { symbol: "AUD/USD", label: "Dollar australien / Dollar", currencies: ["AUD", "USD"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "AUDUSD" }] },
  { symbol: "NZD/USD", label: "Dollar néo-zélandais / Dollar", currencies: ["NZD", "USD"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "NZDUSD" }] },
  { symbol: "EUR/GBP", label: "Euro / Livre", currencies: ["EUR", "GBP"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "EURGBP" }] },
  { symbol: "EUR/JPY", label: "Euro / Yen", currencies: ["EUR", "JPY"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "EURJPY" }] },
  { symbol: "EUR/CAD", label: "Euro / Dollar canadien", currencies: ["EUR", "CAD"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "EURCAD" }] },
  { symbol: "GBP/JPY", label: "Livre / Yen", currencies: ["GBP", "JPY"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "GBPJPY" }] },
  { symbol: "GBP/CAD", label: "Livre / Dollar canadien", currencies: ["GBP", "CAD"], session: "fx", sources: [{ p: "biquote", market: "forex", id: "GBPCAD" }] },
  { symbol: "BTC/USD", label: "Bitcoin", currencies: ["BTC", "USD"], session: "crypto", sources: [
    { p: "biquote", market: "crypto", id: "BTCUSD" }, { p: "kraken", market: "spot", id: "XBTUSD" }, { p: "binance", market: "spot", id: "BTCUSDT" },
  ] },
  { symbol: "ETH/USD", label: "Ethereum", currencies: ["ETH", "USD"], session: "crypto", sources: [
    { p: "biquote", market: "crypto", id: "ETHUSD" }, { p: "kraken", market: "spot", id: "XETHZUSD" }, { p: "binance", market: "spot", id: "ETHUSDT" },
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
