# Lucide Sniper — backtest avec confirmations M15

## Fichiers modifiés
- `src/admin.ts`
- `public/admin.html`

Aucune modification de `schema.sql`, des bindings D1/KV, des secrets ou des données existantes.

## Ce que fait la mise à jour
- Autorise l'import historique M15 dans le même stockage D1 existant.
- Affiche M15 dans le statut des historiques importés.
- Exige des données M15 suffisantes et couvrant la période H1 testée.
- Utilise uniquement les bougies M15 clôturées pour les confirmations de structure et de displacement.
- Charge les bougies M15 par fenêtre de dates autour de chaque bloc de 12 bougies H1, pour limiter le travail CPU.
- Conserve la progression du backtest par blocs de 12 bougies H1.
- Conserve les sorties TP/SL en H1 pour ce premier test comparatif.

## Avant de lancer le backtest
1. Dans le dashboard admin, choisis `XAU/USD`.
2. Dans « Importer les prix historiques », sélectionne `M15`.
3. Importe un CSV M15 au format `timestamp,open,high,low,close` (horodatage UTC, millisecondes ou date ISO UTC).
4. Pour comparer sur 2024–2026, le CSV M15 doit couvrir la même période que les historiques H1/H4/D1.
5. Lance d'abord le backtest sur 30 jours pour vérifier que la progression et les confirmations M15 fonctionnent.
6. Ensuite seulement, lance 1 an puis 2 ans.

Si le backtest indique que M15 est incomplet, complète l'import M15 pour le marché et la période demandés.

## Installation
Remplacer les deux fichiers listés ci-dessus dans le dépôt, puis vérifier le diff et lancer `npm run typecheck` dans un environnement où les dépendances sont installées. Commit/push vers GitHub seulement après vérification.

Aucun déploiement Cloudflare n'a été effectué par cette préparation. Le test de syntaxe TypeScript a réussi, ainsi que la vérification syntaxique des scripts de `public/admin.html`. Le typecheck global n'a pas pu être validé ici car les dépendances Cloudflare ne sont pas installées.

## Correctif complémentaire — repli de prix Forex
Ce ZIP inclut aussi le correctif `CORRECTIF-REPLI-YAHOO-FR.md` : BiQuote reste prioritaire, Yahoo Finance est ajouté en secours gratuit pour les paires Forex et l'or. Aucun D1/KV n'est modifié. Voir ce guide pour les fichiers changés et les vérifications avant push.
