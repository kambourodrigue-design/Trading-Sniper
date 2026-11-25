# Correctif backtest — couverture historique

Base : `Lucide-Sniper-M15-Backtest-Full.zip` (archive la plus récente de la bibliothèque au moment de la correction).

## Changements dans `src/admin.ts`

1. Le backtest ancre désormais la fenêtre sélectionnée sur la dernière bougie H1 clôturée disponible, au lieu de `Date.now()`. Si les imports s'arrêtent le 6 novembre alors que la date actuelle est le 25 novembre, un test 30 jours parcourt les 30 jours précédant le 6 novembre, sous réserve de la couverture des historiques.
2. La réponse finale expose `requested_start`, `available_end` et `coverage_complete` en plus de `coverage_start` / `coverage_end`.
3. Le contrôle M15 vérifie la fraîcheur de la dernière bougie clôturée utilisée. Il refuse un historique ancien réutilisé malgré un trou récent.

## À savoir

- Aucun déploiement Cloudflare n'a été effectué.
- Aucune modification D1/KV ou du schéma n'a été effectuée.
- Le typecheck n'a pas pu être confirmé dans cet environnement : les types `@cloudflare/workers-types` ne sont pas installés et l'installation npm a expiré.
- Après remplacement du code, lancer un test 30 jours puis vérifier `coverage_start`, `coverage_end`, `requested_start`, `available_end` et `coverage_complete`.
