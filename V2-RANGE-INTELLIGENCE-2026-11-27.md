# Lucide Sniper V2 — Range Intelligence (27-11-2026)

## Portée
Le détecteur de régime Range est appelé avant le détecteur tendance/liquidité dans `detectLiquiditySetup`.
Lorsqu'une consolidation est confirmée, V2 n'utilise pas le détecteur de tendance pour cette bougie :
il applique uniquement les règles Range, Fakeout ou Breakout.

## Classification H1
- Fenêtre de 24 bougies H1 clôturées, hors dernière bougie H1.
- Largeur admissible : 2,0 à 8,5 ATR H1.
- Au moins deux tests de chaque borne, avec tolérance liée à l'ATR.
- Dérive des clôtures limitée à 0,90 ATR entre le début et la fin de la fenêtre.
- Compression de volatilité récente comparée aux 16 bougies précédentes.
- Une clôture H1 impulsive au-delà d'une borne transforme le régime en cassure potentielle.

## Trois familles de setups
1. `Range Boundary Rejection` : rejet M15 confirmé près d'une borne, avec SL derrière la mèche.
2. `Range Fakeout + Sweep + Reclaim` : excursion au-delà de la borne puis clôture M15 de réintégration.
3. `Range Breakout + Retest` : cassure H1 impulsive, puis retest M15 uniquement après la clôture H1 de cassure (anti-look-ahead).

## Risque et filtres
- Score minimal : 75/100.
- Risque M15 : 0,25 à 1,80 ATR.
- Espace minimal : 1,5R.
- News bloquantes, marché fermé et trade V2 déjà ouvert empêchent la validation.
- Les objectifs des setups de range sont plafonnés avant la borne opposée ; les objectifs breakout utilisent une projection basée sur la hauteur du range.

## Multi-actifs
Les seuils sont normalisés par ATR et le prix, sans pip fixe. Les actifs crypto ne sont pas pénalisés hors Killzone, car leur marché est ouvert en continu.

## Stockage et sécurité
Aucune nouvelle table D1 n'est nécessaire. Les stratégies sont enregistrées dans le champ `strategy` existant de `shadow_signals`.
Origin reste le seul moteur de production ; les signaux V2 restent virtuels et sans notification.

## Validation effectuée
- Compilation TypeScript stricte des modules `range-engine.ts` et `liquidity-engine.ts`.
- Test d'exécution synthétique : rejet sur borne basse validé.
- Test d'exécution synthétique : breakout H1 + retest M15 post-clôture validé.
- Le test complet du dépôt et le typecheck global doivent être exécutés avec les dépendances du projet installées.
