# Archive d'annonces économiques gratuites — staging

## Source et fonctionnement
- Source synchronisée : calendrier public BiQuote `GET https://biquote.io/api/calendar`.
- Synchronisation manuelle depuis Admin > Backtest > « Synchroniser les annonces gratuites disponibles ».
- Fenêtre demandée : 89 jours précédents jusqu'à aujourd'hui ; limite API demandée : 500 événements.
- Les événements reçus sont conservés dans la nouvelle table D1 `backtest_events`, sans toucher aux tables de signaux, abonnements, ni au KV.
- Le JSON des événements sauvegardés est chargé dans le champ du backtest pour les modes B et C.

## Limites à afficher impérativement
- BiQuote documente une fenêtre glissante d'environ 90 jours passés et 90 jours futurs, pas une archive complète de deux ans.
- Le endpoint est limité à 500 événements par requête ; le nombre réellement reçu et sauvegardé est affiché.
- Certaines publications n'ont pas de prévision, de valeur réelle ou d'heure exacte.
- Les valeurs historiques et révisions ne constituent pas une archive complète « point-in-time » : un backtest fondamental strictement sans biais temporel n'est donc pas garanti.
- ShowMyTrades est utilisé pour le calendrier à venir dans le moteur live ; sa documentation décrit un calendrier public pour les annonces programmées, pas une archive historique de deux ans.
- Aucun événement manquant n'est fabriqué. Les jours/indicateurs non couverts doivent rester marqués comme données manquantes.

## Mise à niveau
La table `backtest_events` est ajoutée à `schema.sql` et `src/lib/schema.ts`. Le mécanisme `ensureSchema` crée la table au démarrage après déploiement du Worker. Aucun bucket R2 et aucune nouvelle clé ne sont requis.

## Tests
- `schema.sql` exécuté dans SQLite en mémoire : OK.
- TypeScript complet non validé dans l'environnement de préparation : `@cloudflare/workers-types` absent.
- Aucun appel réseau de synchronisation n'a été lancé depuis cet environnement ; la première synchronisation réelle se fera depuis le panneau Admin après déploiement en staging.
