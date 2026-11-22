# Mise à jour du moteur de signaux — M15 et displacement

## Modifications
- Ajout de la récupération et du cache des bougies M15 clôturées (fenêtre glissante de 192 bougies), sans modifier les identifiants D1/KV.
- Ajout de deux validations obligatoires en production : BOS/CHoCH/MSS M15 récent dans le sens du signal et bougie de displacement M15 confirmée dans le même sens.
- Le displacement exige une amplitude d'au moins 0,8 ATR, un corps d'au moins 55 % de la bougie et une clôture dans les 25 % proches de l'extrême directionnel ; recherche sur les trois dernières bougies clôturées.
- Ajout d'un bonus de score si le prix revient dans une zone OB/FVG M15 alignée.
- Un signal automatique est suspendu si les données M15 sont absentes ou trop anciennes (plus de 30 minutes). Les graphiques H1/H4/D1 restent disponibles même si le flux M15 est indisponible.
- Correction anti-look-ahead des pools Equal Highs/Equal Lows : chaque bougie ne voit que les pivots dont les bougies de confirmation sont déjà clôturées.
- Le backtest local `scripts/backtest.ts --live` transmet désormais les bougies M15 clôturées au moteur. Les tests H1/H4/D1 de l'endpoint administrateur indiquent explicitement que les confirmations M15 ne sont pas évaluées.

## Seuils à calibrer
Les seuils M15 (0,8 ATR, 55 %, 25 %, récence) sont des paramètres initiaux de filtrage, pas des performances démontrées. Ils doivent être comparés sur historique M15, par actif et hors échantillon, avant toute optimisation.

## Limites de validation
- Le typecheck ciblé du moteur d'analyse passe.
- Le test unitaire anti-look-ahead dédié passe.
- Un test d'exécution de la détection displacement est lancé séparément.
- La suite complète `npm test` et le typecheck global n'ont pas pu être exécutés dans cet environnement : les dépendances npm ne sont pas installées et le registre npm était inaccessible (erreur DNS EAI_AGAIN).
- Aucun déploiement Cloudflare n'a été effectué.
