# Correctif du moteur de signaux — 25/11/2026

## Changements

- Reconnaissance des erreurs de limitation Kraken (`EGeneral: Too many requests`) et mise en temporisation du fournisseur.
- Mise en temporisation de Binance en cas de HTTP 403/429/451 et des erreurs réseau/5xx ; arrêt des essais d'hôtes après un refus d'accès ou une limitation.
- Validation de la fraîcheur M15 dans `getBundle()` lorsque le moteur live demande un bundle exploitable. Si le fournisseur principal ne fournit pas au moins 40 bougies M15 récentes, le moteur essaie le fournisseur suivant au lieu de retourner un bundle incomplet.
- Réduction de la pause d'un actif après une erreur de données temporaire à 3–5 minutes. Les erreurs de plan/compte restent en pause 12 heures.
- Les règles de score, ICT/SMC, confirmations M15, SL/TP et filtres de risque ne sont pas modifiées.

## Vérifications

- Transpilation TypeScript syntaxique de `src/lib/prices.ts` et `src/engine/run.ts` : OK.
- `tsc --noEmit` et `npm test` non exécutés : les dépendances du projet n'ont pas pu être installées dans l'environnement de vérification (installation interrompue/timeout).

## Après déploiement

1. Déployer le Worker.
2. Dans Admin, lancer une analyse forcée sur BTC/USD et ETH/USD, puis XAU/USD et EUR/USD.
3. Vérifier les journaux : source retenue, nombre de bougies M15/H1, fraîcheur des dernières bougies et erreurs fournisseurs.
4. Si Binance continue de répondre HTTP 403, cela reste un refus côté Binance/réseau : le code le temporise et passe au fournisseur suivant, mais ne peut pas lever une restriction réseau externe.
