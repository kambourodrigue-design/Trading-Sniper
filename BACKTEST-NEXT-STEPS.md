# Lucide Sniper — historique local et Replay (staging)

## Historique gratuit M1/M5/M15
Le script `scripts/download_history.py` télécharge localement :
- Forex + XAU/USD : flux public Dukascopy BID M1 (fichiers BI5 journaliers), sans clé ;
- BTC/ETH : chandeliers Binance Spot BTCUSDT/ETHUSDT M1, sans clé.

Il produit M1, M5, M15, M30, H1, H4 et D1 en CSV, plus `manifest.json`.

### Lancer sur un ordinateur avec Python 3.10+
```bash
python scripts/download_history.py --start 2024-11-20 --end 2026-11-19 --symbols XAUUSD --out ./historical
```
Puis tous les marchés :
```bash
python scripts/download_history.py --start 2024-11-20 --end 2026-11-19 --symbols all --out ./historical
```
Le téléchargement de deux ans en M1 pour 15 marchés peut être long et produire plusieurs gigaoctets. Commencer par XAUUSD et un mois pour valider. Les jours sans marché/fichier sont ignorés ; vérifier `manifest.json`, le premier/dernier timestamp et les erreurs avant toute analyse.

### Replay
Admin > Backtest > « Ouvrir Replay M1/M5/M15 ». Charger localement `M1.csv`, `M5.csv` ou `M15.csv`. Le navigateur lit le CSV M1, M5 ou M15, dessine les bougies et permet lecture/pause, vitesse, pas-à-pas et déplacement par curseur. Les fichiers ne sont pas envoyés au Worker.

## Limites / qualité des données
- Dukascopy : flux BID, pas un historique CFD exact de ton broker ; spread, commission et slippage doivent être modélisés séparément. Le format BI5 utilisé est documenté par la communauté ; le téléchargement doit être contrôlé avec manifest et tests de cohérence.
- BTC/ETH : Binance Spot USDT, pas BTC/USD ou ETH/USD CFD. Ne pas mélanger ces séries sans signaler le basis et les horaires.
- Sans R2, garder M1/M5/M15 localement. Ne pas essayer de stocker 2 ans de M1 des 15 actifs dans D1 : volume et écritures peuvent dépasser les quotas. Importer dans D1 seulement H1/H4/D1 utiles au moteur.
- La page Replay reste un visualiseur OHLC et ne simule pas l’exécution des ordres ; elle peut toutefois superposer visuellement les niveaux des trades exportés (entrée, SL, TP1/TP2/TP3).
- Le backtest moteur actuel traite un symbole par requête. Les tests sur 15 marchés doivent être lancés séparément ou orchestrés par lots après mesure de durée, jamais dans une seule requête Worker longue.
- Annonces économiques gratuites : les calendriers publics ne garantissent pas 2 ans de prévisions horodatées et de valeurs initiales non révisées. Les modes B/C ne doivent être interprétés que sur les événements réellement archivés ; la couverture doit être affichée. Pas de reconstruction fictive.

## Tests locaux
```bash
python scripts/test_history_downloader.py
```
Ces tests vérifient le décodage d'une fixture BI5 synthétique, la validation OHLC, l'agrégation et le périmètre de 15 marchés. Ils ne prouvent pas que chaque URL distante répond ni que deux ans de données ont été téléchargés.


## Étape suivante — comparaison multi-marchés
La commande locale `npm run backtest` lance les 15 marchés avec les profils strict, balanced, active et adaptive par défaut. Elle lit d'abord les fichiers locaux `./historical/<SYMBOL>/<TF>.csv` produits par `scripts/download_history.py` (H1, H4, D1 ; M15 en mode `--live`). Si l'historique local est absent ou insuffisant, elle essaie les fournisseurs configurés. `--history-dir ./historical` permet de changer le dossier. Ajouter `--live` active les sorties M15 et exige au moins 500 bougies M15 ainsi que 105 bougies H4 ; sinon le marché est ignoré ou passe au fournisseur suivant. Cette commande reste locale : elle n’est pas exécutée dans une requête Worker. Les résultats réels exigent des historiques réellement disponibles ; `--synthetic` sert uniquement aux tests techniques et ne doit jamais être interprété comme une performance.

Chaque exécution qui produit des résultats exporte dans `./backtest-results` : un résumé JSON, un résumé CSV et un CSV des trades (entrée, SL, TP1/TP2/TP3, résultat et horodatages). Exemple pour choisir un autre dossier : `npm run backtest -- --symbols XAU/USD --out ./reports/xau`. Pour le Replay, charger le CSV OHLC M1/M5/M15 puis le CSV `trades-*.csv` correspondant. Les timestamps du backtest sont en millisecondes Unix ; le Replay accepte également les dates ISO.

Le rapport donne des statistiques descriptives par marché et profil, avec coût ATR, drawdown, profit factor, espérance et courbe d’équité. Il ne constitue pas une validation de stratégie si la couverture historique est courte, si les coûts ne correspondent pas au broker, ou si les événements fondamentaux historiques sont absents.

## Rapport de comparaison et exports (staging)
`npm run backtest -- --symbols XAU/USD,EUR/USD --profiles strict,balanced,adaptive --out ./backtest-results` écrit un résumé JSON et CSV par exécution, ainsi qu'un `trades-*.csv` réutilisable dans le Replay. Le CSV des trades contient timestamp (millisecondes UTC), direction, entrée, SL, TP1/TP2/TP3, timestamp de sortie et résultat. Dans Replay, charger le fichier OHLC puis le fichier trades pour afficher les niveaux d'entrée/SL/TP pendant la durée du trade.

Le rapport conserve les hypothèses du moteur : entrée à la clôture H1, stop prioritaire si TP et SL sont touchés dans la même bougie, un trade simultané maximum par marché, expiration après 120 h, coût paramétrable en fraction d'ATR. Le rapport JSON contient aussi les statistiques séparées de calibration et de test hors échantillon (`walk_forward`). Il ne comprend pas encore le spread réel variable par broker, le financement overnight, les annonces économiques historiques, ni l'avis IA. Le walk-forward est une séparation temporelle des résultats, pas une optimisation automatique des paramètres.

Exemple de test hors-ligne (données synthétiques uniquement) :
```bash
npm run backtest -- --synthetic --symbols XAU/USD --out ./backtest-synthetic
```
Ne pas utiliser les résultats synthétiques pour décider de trader en réel.
