# Suppression de Kraken et Binance

- Kraken et Binance ont été retirés des fournisseurs de marché du moteur.
- BTC/USD et ETH/USD utilisent désormais uniquement biquote, comme les autres actifs.
- Le chargement du backtest distant et le test administrateur utilisent également biquote uniquement.
- Les fonctions de récupération OHLC Kraken/Binance et leurs temporisations ont été supprimées de `src/lib/prices.ts`.
- Les règles ICT/SMC, les filtres M15, les seuils de score et la gestion du risque n’ont pas été modifiés.

Attention : sans fournisseur de secours, si biquote est indisponible ou ne fournit pas assez d’historique, l’actif concerné ne pourra pas être analysé. Les CSV historiques locaux/importés restent utilisables pour le backtest. Le téléchargeur Dukascopy intégré ne télécharge plus les historiques crypto ; ceux-ci doivent être fournis en CSV local.
