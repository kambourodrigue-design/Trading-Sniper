# Lucide Sniper V2 — Fundamental Intelligence

## Changements de cette version
- Ajout de `src/engine/fundamental-engine.ts` : transforme le contexte macro sourcé de `src/lib/macro.ts` en biais directionnel par symbole, couverture et ajustement de score.
- `src/engine/shadow.ts` récupère le contexte macro mis en cache et applique ce filtre aux candidats V2, y compris les stratégies Range/Fakeout/Breakout qui passent par le même flux.
- Un setup technique déjà validé reçoit un ajustement fondamental limité (+8 au maximum, -12 au maximum).
- Seuil final Shadow relevé à 82/100.
- Une contradiction fondamentale forte (écart >=25 points et couverture >=70/100) bloque le setup.
- Si les données macro sont absentes ou trop peu couvertes (<35/100), elles restent neutres : aucune donnée n'est inventée et aucun setup n'est bloqué pour cette seule raison.
- Ajout de trois tests unitaires de la couche fondamentale dans `scripts/test.ts`.

## Sources déjà utilisées par `src/lib/macro.ts`
Calendrier économique, actual/forecast disponibles, BIS (taux directeurs), Trésor US (taux nominaux et réels), CFTC TFF (positions hebdomadaires), FRED (séries macro/intermarket), DXY via Stooq ou proxy dollar large, et titres GDELT.

## Limites importantes
- Les scores macro existants sont explicitement un prototype explicable, non calibré par backtest.
- Certaines séries sont quotidiennes ou hebdomadaires, pas intraday.
- La couverture est variable par devise et par classe d'actifs.
- Cette couche est un filtre de confluence, pas une probabilité de gain.
- Les données absentes ne sont pas remplacées par des valeurs supposées.
- V2 reste Shadow-only ; Origin reste le moteur de production.
- Cette version n'ajoute aucun ordre réel ni notification Origin.

## Déploiement
Aucune nouvelle table D1 n'est requise. Remplacer les fichiers listés dans le message d'installation, puis exécuter `npm run typecheck`, `npm test`, `npm run deploy`.
