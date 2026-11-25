# Lucide Sniper — repli de données Forex (ZIP avec backtest M15)

## Objectif
Corriger l'échec commun observé sur toutes les paires Forex :
`Aucune source ne fournit assez de données : biquote/... dernière bougie H1 trop ancienne`.

## Correction
- BiQuote reste la source principale, sans clé.
- Ajout de Yahoo Finance Chart API comme source de secours gratuite, sans clé, pour les 12 paires Forex et XAU/USD.
- Ajout également de Yahoo comme dernier repli pour BTC/USD et ETH/USD, après BiQuote, Kraken et Binance.
- Le moteur essaie le fournisseur de secours si BiQuote renvoie une erreur ou si sa dernière bougie H1 est trop ancienne.
- La validation de fraîcheur H1/M15 reste active : le correctif ne force pas de signal avec des bougies périmées.
- Le chemin Yahoo utilise les timestamps Unix UTC et les champs OHLC du endpoint chart. Si Yahoo ne sert pas le 4H pour un symbole, le code tente une reconstruction à partir du H1.
- Les appels admin de backtest et le script de backtest local reconnaissent également le fournisseur Yahoo.

## Fichiers modifiés
- `src/engine/config.ts`
- `src/lib/prices.ts`
- `src/admin.ts`
- `scripts/backtest.ts`
- `scripts/test.ts`

## Base et compatibilité
- Ce ZIP est construit à partir de `Lucide-Sniper-Backtest-Historique-Corrige-2026-11-25.zip`, celui qui contient déjà le correctif du backtest historique/M15.
- Aucun changement à `schema.sql`, D1, KV, secrets, identifiants de bindings ou données importées.
- Aucun déploiement Cloudflare n'a été effectué.

## Vérification
- Transpilation syntaxique des 29 fichiers TypeScript : 0 diagnostic de syntaxe.
- Le typecheck complet n'a pas pu être exécuté : les dépendances npm/`@cloudflare/workers-types` ne sont pas installées, et l'installation a expiré dans cet environnement.
- Le symbole `GC=F` est bien référencé sur Yahoo Finance, mais la réponse OHLC intraday de l’endpoint utilisé n’a pas pu être testée depuis l’environnement de préparation. Vérifier après déploiement que Yahoo renvoie les bougies M15/H1/H4/D1 fraîches.

## Installation recommandée
1. Fais une copie de sécurité du dépôt GitHub actuel.
2. Téléverse le contenu du ZIP complet dans le dépôt en remplaçant les fichiers correspondants, ou applique le ZIP patch.
3. Vérifie le diff : les changements doivent se limiter aux cinq fichiers listés ci-dessus et à ce guide.
4. Lance `npm install`, puis `npm run typecheck` et `npm test` dans un environnement avec accès au registre npm.
5. Commit/push seulement après vérification. Le déploiement GitHub→Cloudflare se fera alors selon ta configuration habituelle.
6. Pour XAU/USD, Yahoo `GC=F` est un proxy futures et peut différer légèrement du prix spot du broker ; avant d’utiliser les niveaux d’entrée/SL/TP, vérifier l’écart avec la cotation broker.
7. Après déploiement, regarde les logs : si BiQuote est stale, le moteur doit essayer Yahoo. Si Yahoo est bloqué ou stale lui aussi, le moteur doit continuer à refuser le signal plutôt que d'utiliser de mauvaises données.
