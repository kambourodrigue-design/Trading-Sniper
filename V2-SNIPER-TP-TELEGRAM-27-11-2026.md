# Lucide Sniper V2 — objectifs Sniper et Telegram professionnel

## Règles de sélection V2
- TP1 minimum : 2R.
- TP2 minimum : 5R.
- TP3 minimum : 8R.
- Extension de gestion possible jusqu'à 30R uniquement si la structure et la liquidité le permettent ; ce n'est pas un objectif garanti.
- Un setup est rejeté si l'espace structurel disponible ne permet pas le TP3, ou si les RR réels calculés après arrondi des prix sont sous les seuils.
- Ces règles concernent exclusivement V2 Shadow. Le moteur Origin et les signaux réels ne sont pas modifiés.

## Telegram V2
Le message est organisé en rubriques : identification, plan de trade, objectifs/RR, confirmations techniques, contexte fondamental, notes du moteur, statut et horodatage. Les RR sont calculés à partir des prix entrée/SL/TP stockés. Le statut virtuel est clairement indiqué.

## Fichiers modifiés
- `src/engine/liquidity-engine.ts`
- `src/engine/range-engine.ts`
- `src/engine/shadow.ts`

## Base de données
Aucune migration D1 requise. Aucun changement de schéma.

## Vérifications
- Transpilation TypeScript des trois fichiers modifiés : syntaxe OK.
- `npm run typecheck` non exécuté jusqu'au bout : les dépendances du projet ne sont pas installées dans l'environnement (`@cloudflare/workers-types` manquant).
- `npm test` non exécuté pour la même raison (`tsx` absent).


## Suivi Telegram des résultats Shadow
- Notifications distinctes et dédupliquées : TP1, TP2, TP3, SL initial, stop suiveur après TP, et expiration du setup.
- Les événements sont stockés dans `shadow_telegram_events` (outbox D1) et réessayés tant que Telegram ne confirme pas l'envoi.
- La notification initiale et les notifications de progression restent en mode virtuel Shadow.
- Seuil Telegram par défaut : 82/100 (la variable `TELEGRAM_V2_MIN_SCORE` peut le remplacer).
- Migration additive uniquement : `CREATE TABLE IF NOT EXISTS`; aucune donnée existante supprimée.
