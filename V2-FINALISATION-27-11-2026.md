# Lucide Sniper V2 — finalisation technique du 27-11-2026

## Changements
- Objectifs normalisés dans le seul moteur V2 : TP1 = 2R, TP2 = 5R, TP3 = 8R minimum. La configuration historique globale (Origin) n’a pas été modifiée.
- TP3 adaptatif : peut aller jusqu'à 30R uniquement lorsqu'un obstacle structurel mesuré laisse l'espace requis. Sans obstacle mesuré, TP3 reste à 8R ; le moteur ne suppose pas qu'un mouvement de 30R est disponible.
- Application commune du calcul des objectifs aux familles continuation, range et sweep/ICT.
- Évaluation conjointe des candidats Range, Trend Continuation et Liquidity Sweep ; lorsqu’ils sont valides, ils sont classés par score au lieu de donner la priorité à la première fonction appelée. Une continuation valide peut être retenue sans sweep.
- Les marchés fermés sont désormais consignés dans `shadow_runs` avec le statut `market_closed` et un motif explicite, au lieu de disparaître silencieusement des observations.
- Le seuil final de publication Shadow reste 82/100 ; la limite globale reste une position ouverte ; Origin reste indépendant.
- Tests unitaires ajoutés pour les objectifs adaptatifs et corrigé le test qui affirmait à tort qu'aucune tendance sans sweep ne pouvait générer un signal.

## Migration D1
Aucune nouvelle migration D1 requise. Le code utilise la colonne `shadow_runs.note` déjà ajoutée dans la base de production. Ne pas réexécuter `schema.sql` intégralement sur la base distante.

## Vérifications
À exécuter localement après installation des dépendances :
- `npm test`
- `npm run typecheck`

Déploiement uniquement après réussite des deux commandes et revue du diff. Mode Shadow uniquement ; aucun ordre réel n'est envoyé.
