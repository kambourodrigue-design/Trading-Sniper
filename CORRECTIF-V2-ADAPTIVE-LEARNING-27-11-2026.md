# Correctif V2 Adaptive Learning — 27/11/2026

## Corrections
- Correction de la boucle `for` mal formée dans `src/engine/adaptive-learning.ts`.
- Alignement de `schema.sql` et `src/lib/schema.ts` sur la structure D1 utilisée par la version déployée : `id`, `trade_count`, `total_trades`, `train_trades`, `holdout_trades` et contrainte unique `(symbol, strategy)`.
- L'upsert adaptatif renseigne maintenant `id` avec `crypto.randomUUID()` et maintient `trade_count` en cohérence avec `total_trades`.

## Base D1
La migration additive qui ajoute `total_trades`, `train_trades` et `holdout_trades` a déjà été exécutée par l'utilisateur. Ne pas la relancer.
Aucune table ni donnée existante n'est supprimée.

## Vérifications effectuées
- Transpilation syntaxique TypeScript des fichiers touchés : réussie.
- Test SQLite de l'INSERT/UPSERT sur une table reproduisant le schéma D1 communiqué : réussi.
- Création de la table depuis le DDL corrigé : réussie.
- Vérification complète de compilation TypeScript et tests npm : non exécutés, car l'installation des dépendances a expiré et `@cloudflare/workers-types` / `tsx` ne sont pas disponibles dans l'environnement de vérification.
