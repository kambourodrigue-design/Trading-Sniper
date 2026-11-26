# Correctifs Lucide Sniper — 26 novembre 2026

## Apprentissage
- Ajout de `ensureLearningRecord()` : une ligne manquante dans `signal_learning` est récupérée depuis `signals`.
- La récupération est tentée lors du suivi des résultats et avant la mise à jour d'un résultat.
- Les lignes de secours portent `capture_quality: recovered_minimal` dans `setup_json` afin de distinguer les données récupérées des instantanés techniques complets.
- `INSERT OR IGNORE` protège les lignes existantes : aucune donnée d'apprentissage déjà présente n'est écrasée.
- Aucun changement de schéma D1 ni migration SQL n'est requis.

## Fournisseurs
- Kraken et Binance supprimés des types, configurations, appels OHLC, tests, backtest et administration.
- BiQuote reste la source principale ; Yahoo Finance est le seul repli configuré.
- Aucune table D1, aucun identifiant D1/KV et aucune donnée historique n'ont été modifiés.

## Vérifications
- Vérification syntaxique TypeScript par transpilation : 31 fichiers, 0 erreur de syntaxe.
- Requête SQL de récupération testée localement sur SQLite.
- `tsc --noEmit` n'a pas pu être exécuté complètement car les dépendances du projet (`@cloudflare/workers-types`) ne sont pas installées dans cet environnement.
