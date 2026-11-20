# Backtest historique – mode sans R2 (staging)

## Architecture
- Les historiques OHLC importés sont conservés dans une nouvelle table `backtest_candles` de la base D1 déjà liée au Worker.
- Aucun bucket R2, aucune clé supplémentaire et aucun changement des tables de signaux/abonnements.
- Les bougies sont regroupées par marché, timeframe et mois. Les imports sont envoyés par lots de 3 000 bougies.
- Timeframes requis pour le moteur actuel : 1H, 4H et 1D. Le test de deux ans s'appuie sur ces historiques ; M1/M5 et le Replay graphique ne sont pas encore inclus dans cette étape.

## Import
Dans Admin > Backtest :
1. Choisir un marché.
2. Choisir H1, puis importer son CSV ; répéter pour H4 et D1.
3. CSV normalisé avec en-têtes `timestamp,open,high,low,close`. Timestamp en millisecondes Unix ou date ISO UTC.
4. Choisir 730 jours et lancer le backtest.

Les fichiers doivent contenir des bougies clôturées, en UTC, triées chronologiquement. L'import dédoublonne par timestamp et remplace une bougie existante si le même timestamp est réimporté.

## Limites connues
- Le fournisseur live actuel ne donne pas 2 ans ; les tests de plus de 7 jours sont refusés si les trois historiques n'ont pas été importés.
- L'interface ne télécharge pas encore automatiquement Dukascopy. Il faut d'abord préparer les CSV OHLC normalisés.
- L'implémentation stocke les historiques dans D1 pour éviter R2, mais reste soumise aux quotas D1 du compte Cloudflare. Importer un actif et un timeframe à la fois ; ne pas importer simultanément les 15 marchés.
- Le calcul actuel simule des décisions H1 et des sorties H1. Les annonces sont uniquement prises en compte si un calendrier historique fiable est importé séparément. Aucun résultat n'est une promesse de rentabilité.
- Les données existantes de D1 et KV sont conservées ; la création de la table `backtest_candles` se fait via le mécanisme de schéma du Worker au prochain démarrage après déploiement.
