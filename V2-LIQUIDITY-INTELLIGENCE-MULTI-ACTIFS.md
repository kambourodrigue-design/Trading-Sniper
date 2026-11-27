# Lucide Sniper V2 — Liquidity Intelligence multi-actifs

## Objectif

V2 est un détecteur de setups indépendant du moteur de décision Origin. Il consomme les mêmes flux OHLC, mais ne réutilise pas `buildAnalysis()` ni `evaluate()` d'Origin. Il n'écrit que dans `shadow_signals` et `shadow_runs`.

Origin reste l'unique moteur de production. V2 n'envoie aucun signal, ne déclenche aucune notification et ne modifie aucun paramètre live.

## Univers couvert

La logique s'applique à tous les symboles actuellement présents dans `src/engine/config.ts` : 12 paires Forex, XAU/USD, BTC/USD et ETH/USD (15 symboles au total). L'ajout futur d'un actif au catalogue `SYMBOLS` l'intègre au même détecteur, sous réserve que ses historiques M15/H1/H4/D1 soient disponibles.

## Chaîne de détection

1. **Biais HTF H4/D1** : structure HH/HL ou LH/LL confirmée par pivots et position du prix par rapport à la moyenne 50 périodes. Les biais contradictoires sont rejetés.
2. **Liquidité** : sweep d'un pivot M15 intact, avec dépassement de mèche et clôture de réintégration. Le pivot doit être confirmé avant la bougie de sweep ; un niveau déjà balayé ne compte pas.
3. **MSS post-sweep** : cassure clôturée d'un pivot M15 formé après le sweep.
4. **Displacement** : bougie M15 dans le sens du setup, corps d'au moins 0,60 ATR et clôture proche de l'extrême.
5. **FVG** : imbalance trois bougies créée après le sweep, avec retour du prix dans ou à proximité de la zone.
6. **Premium/Discount** : position du prix dans le dealing range H1 des 48 dernières bougies.
7. **Chiffres psychologiques** : niveau rond adaptatif calculé à partir du prix et de l'ATR H1 ; c'est une confluence, jamais un déclencheur autonome.
8. **Risque** : stop derrière la mèche du sweep avec buffer de 0,20 ATR M15 ; risque accepté entre 0,40 et 2,50 ATR M15 ; espace structurel jusqu'à la liquidité opposée d'au moins 2R.

## Score et conditions obligatoires

| Composante | Points |
|---|---:|
| Biais H4/D1 aligné (ou neutre) | 15 (ou 7) |
| Sweep confirmé | 20 |
| MSS après sweep | 15 |
| Displacement M15 | 15 |
| FVG retest | 15 |
| Premium/Discount | 5 |
| Killzone Londres/New York | 5 |
| Confluence chiffre rond | 5 |
| Espace libre d'au moins 2R | 5 |
| **Maximum** | **100** |

Le candidat exige au minimum 75/100 et tous les contrôles suivants : MSS, displacement, FVG retest, SL conforme, espace libre ≥2R, calendrier économique disponible sans blocage, marché ouvert, aucun autre trade virtuel ouvert sur le symbole, biais HTF non contradictoire.

Le score est une note de confluence, pas une probabilité de gain.

## Cadence et suivi

- V2 observe au rythme des créneaux M15 (une décision au maximum par symbole et par créneau de 15 minutes). Le nom historique de colonne D1 `bucket_hour` est conservé pour compatibilité, mais sa valeur représente désormais ce créneau de 15 minutes.
- Les candidats sont stockés dans `shadow_signals`.
- Les décisions rejetées, données périmées et erreurs sont consignées dans `shadow_runs`.
- Le suivi des TP/SL est indépendant et utilise les bougies de sortie disponibles.
- Les résultats restent virtuels et doivent être évalués avec spread, commissions, slippage et validation hors-échantillon avant toute décision de production.

## Fichiers modifiés

- Ajouter `src/engine/liquidity-engine.ts`
- Remplacer `src/engine/shadow.ts`
- Mettre à jour `scripts/test.ts`

Aucune modification D1 n'est requise : les tables `shadow_signals` et `shadow_runs` déjà présentes sont réutilisées sans suppression ni réinitialisation.
