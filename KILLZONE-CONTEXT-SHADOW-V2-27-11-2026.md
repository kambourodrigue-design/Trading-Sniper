# Correctif ICT Kill Zones — Shadow V2 — 27/11/2026

## Objectif
Améliorer le contexte temporel de Shadow V2 sans ajouter de filtre horaire bloquant et sans modifier le moteur Origin.

## Changements
- La Kill Zone London / New York reste un bonus contextuel de +5 points dans les détecteurs Liquidity et Range.
- En dehors de ces fenêtres, aucun point n'est retiré et aucune condition de rejet n'est ajoutée.
- Les extrêmes de la session asiatique (20:00–00:00, heure de New York) sont calculés à partir des bougies M15, avec gestion automatique du changement d'heure via `America/New_York`.
- Un balayage de l'extrême asiatique suivi d'une réintégration dans la range ajoute +5 points au setup correspondant.
- Si aucun balayage asiatique n'est confirmé, les niveaux restent informatifs et n'empêchent pas le setup d'être évalué.
- Aucun changement D1, aucune migration et aucune modification de la publication Origin.

## Fichiers modifiés
- `src/engine/ictcrt.ts`
- `src/engine/liquidity-engine.ts`
- `src/engine/range-engine.ts`
- `scripts/test.ts`

## Validation
Les trois modules moteur modifiés passent une vérification TypeScript ciblée (`tsc --noEmit` sur les modules concernés). La suite complète `npm test` et le typecheck complet du projet n'ont pas pu être exécutés dans cet environnement, car les dépendances du projet (`@cloudflare/workers-types`, `tsx`) ne sont pas installées et le registre npm n'est pas accessible en mode hors ligne.

## Déploiement
Remplacer les quatre fichiers listés dans le projet. Aucune commande SQL à exécuter. Garder `engine_control.active_engine = 'origin'` : V2 demeure en `shadow_only`.
