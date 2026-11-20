# Lucide Sniper — validation et déploiement (staging)

## État de cette livraison

Cette archive contient le code destiné au dépôt GitHub du Worker `trading-sniper`. Aucun déploiement Cloudflare n’a été effectué pendant sa préparation. Si GitHub est configuré pour déployer automatiquement la branche `main`, envoyer ces changements sur `main` déclenchera un déploiement en production.

- Le nom du Worker est réglé sur `trading-sniper`, conformément au nom confirmé par l’utilisateur. Le fichier `wrangler.original.backup.toml` est une sauvegarde historique et n’est pas utilisé au déploiement.
- Les identifiants D1 et KV sont conservés à l'identique.
- Le schéma applicatif exécute `ensureSchema` au premier appel du Worker. Il peut créer la table `backtest_candles` et ajouter les colonnes manquantes aux tables applicatives. Aucun `db:apply:remote` manuel n’est requis pour cette version.
- Le replay M1/M5/M15 est un lecteur OHLC local. Les niveaux de trades peuvent être affichés via le CSV de trades exporté par le backtest. Il ne simule pas encore un carnet d'ordres, le spread variable ou le slippage tick par tick.
- Le backtest local teste les règles du moteur sans IA. Le coût `--cost-atr` est une hypothèse paramétrique, pas une mesure de spread du broker.
- Les événements macro historiques ne sont pas téléchargés automatiquement sur deux ans. Le mode fondamental n'est exploitable que si un fichier d'événements historiques vérifié est fourni au module qui l'accepte.
- Aucun résultat de performance réel n'est inclus : les historiques doivent être téléchargés et les backtests exécutés sur la machine de l'utilisateur.

## Contrôles avant déploiement

1. Vérifier que le Worker Cloudflare de production est bien `trading-sniper` avant de fusionner/publier cette version. Cette configuration cible le Worker de production.
2. Vérifier les bindings `DB` et `CACHE` et confirmer qu'ils pointent vers les ressources attendues. Ne pas recréer de base ni de namespace.
3. Vérifier les secrets existants (`JWT_SECRET`, `ADMIN_EMAILS`, et les secrets optionnels IA/Telegram). Ne jamais coller leurs valeurs dans le chat ou dans un fichier.
4. Installer les dépendances avec `npm install` dans un environnement réseau fonctionnel.
5. Exécuter `npm run typecheck` et `npm test`. Les tests du téléchargeur sont séparés : `python scripts/test_history_downloader.py`.
6. Lancer un test local du Worker avec `npm run dev` et vérifier les pages, l'authentification admin, le Replay et l'API Backtest.
7. Déployer uniquement après ces contrôles avec `npm run deploy`.

## Base de données et retour arrière

- Ne pas exécuter `npm run db:apply:remote` pour cette version : le schéma est géré au démarrage par `ensureSchema` et aucune migration distante manuelle n'est demandée.
- La création de `backtest_candles` est additive (`CREATE TABLE IF NOT EXISTS`). Les données existantes D1/KV ne sont pas supprimées.
- Garder l’archive actuellement en production. En cas de régression, revenir au déploiement précédent depuis l’historique Cloudflare. Un rollback du Worker ne supprime pas les ajouts de schéma déjà effectués dans D1 ; ne pas supprimer de tables ni de namespaces.

## Résultat de validation dans cet environnement

- `python scripts/test_history_downloader.py` : 4 tests réussis.
- `unzip -t` : archive valide.
- Installation npm : expirée dans cet environnement.
- `tsc --noEmit` : bloqué car `@cloudflare/workers-types` n'est pas installé.
- Aucun backtest réel sur les 15 marchés n'a été exécuté ici.
