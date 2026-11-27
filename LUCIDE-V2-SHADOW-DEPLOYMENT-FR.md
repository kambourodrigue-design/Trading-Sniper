# Lucide Sniper — V2 Liquidity Intelligence Shadow

## Architecture livrée

- Origin reste l'unique moteur de production.
- V2 utilise un détecteur ICT/SMC indépendant : `Liquidity Sweep + MSS + Displacement + FVG Retest`.
- V2 consomme les mêmes données OHLC mais n'appelle pas le moteur `evaluate()` d'Origin.
- Univers : les 15 symboles actuellement déclarés dans `src/engine/config.ts` (12 Forex, XAU/USD, BTC/USD, ETH/USD).
- V2 enregistre ses candidats et rejets exclusivement dans `shadow_signals` et `shadow_runs`.
- Aucun signal V2 réel, notification ou changement de paramètre live.
- Une décision est prise par symbole et par créneau M15 ; la colonne historique `bucket_hour` conserve son nom pour compatibilité.
- Le basculement V2 en production reste verrouillé.

## Fichiers à remplacer / ajouter

1. Ajouter `src/engine/liquidity-engine.ts`
2. Remplacer `src/engine/shadow.ts`
3. Remplacer `scripts/test.ts`
4. Remplacer `src/admin.ts` et `public/admin.html` pour afficher le nouveau moteur

Les autres fichiers de l'archive sont conservés. Aucune migration D1 supplémentaire n'est requise : les tables Shadow déjà introduites sont réutilisées.

## Déploiement

```bash
npm install
npm run typecheck
npm test
npm run deploy
```

Avant déploiement, sauvegarder le projet et la base D1. Après déploiement, contrôler :

```sql
SELECT active_engine, reason FROM engine_control WHERE id=1;

SELECT status, COUNT(*) AS total
FROM shadow_runs
GROUP BY status;

SELECT symbol, direction, score, strategy, outcome, r_multiple, created_at
FROM shadow_signals
ORDER BY created_at DESC
LIMIT 30;
```

La valeur de `engine_control.active_engine` doit rester `origin`.

## Critères de validation

Le score (75/100 minimum) est une note de confluence et non une probabilité. La V2 doit accumuler au moins 30 trades clôturés par actif/configuration avant une première lecture statistique, puis subir une validation hors-échantillon incluant coûts réels et slippage. Ne pas l'activer en production avant cette validation.

Le typecheck complet et les tests npm doivent être exécutés dans l'environnement du projet après installation des dépendances.
