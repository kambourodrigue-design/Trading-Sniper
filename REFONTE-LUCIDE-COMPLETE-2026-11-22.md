# Lucide — refonte interface complète

## Base utilisée
- Archive de départ : `Trading-Sniper-Scanner-IA-Phase1-2026-11-22.zip`.
- Cette base contient déjà les confirmations moteur M15 / displacement intégrées précédemment.
- Le Scanner IA reste branché sur `/api/scanner` et affiche exclusivement les signaux publiés par le moteur.

## Ajouts
- `public/history.html` : historique des signaux réels via le nouvel endpoint `GET /api/history`.
- `public/performance.html` : indicateurs de performance réels via `GET /api/stats`.
- `public/multi-timeframe.html` : visualisation des bougies H1/H4/D1 via `GET /api/candles` (connexion requise).
- `public/academy.html` : rubrique pédagogique ICT/SMC, structure, liquidité, OB/FVG, MTF, risque et fondamentaux.
- `public/subscription.html` : présentation des offres existantes et état transparent de l'activation.
- Navigation étendue depuis l'accueil, le scanner et le dashboard.
- `src/index.ts` : endpoint `GET /api/history`, lecture seule, 100 signaux maximum, niveaux masqués selon les règles d'abonnement existantes.

## Préservation
- Thème Lucide violet / magenta / cyan et modes clair/sombre conservés.
- Moteur de signaux et rotation des marchés non modifiés.
- D1, KV, cron et variables Wrangler conservés.
- Aucun changement de schéma D1 ni migration nécessaire.
- Aucun déploiement effectué.

## Limites honnêtes
- Le paiement automatisé n'est pas activé : les endpoints webhook présents dans le backend sont des placeholders. La page Abonnements ne prétend donc pas traiter un paiement.
- Le multi-timeframe affiche les bougies H1/H4/D1 disponibles ; il ne fabrique pas de score de tendance supplémentaire.
- L'historique montre les signaux publics du moteur. Les niveaux sont soumis à `applyAccess` comme dans les autres écrans.
- Les statistiques utilisent les données de résultats suivies par le backend, sur 90 jours, et ne sont pas un relevé broker. Coûts de transaction non garantis inclus.
- L'Académie est une rubrique de contenus pédagogiques structurés, pas encore un LMS avec comptes de progression ou vidéos hébergées.

## Contrôles effectués
- Intégrité ZIP source vérifiée.
- Syntaxe JavaScript des scripts HTML contrôlée avec Node.js : aucune erreur.
- Contrôle TypeScript complet non exécuté : `node_modules` absent dans l'environnement de préparation.
- Pas de test de déploiement Cloudflare ni de test D1 distant effectué.


## Mode clair / mode nuit — correctif global (22/11/2026)

- Ajout d’un bouton global Mode nuit / Mode clair sur les pages HTML publiques, Scanner IA, Dashboard, Administration, Historique, Performance, Multi-timeframe, Académie, Abonnement et outils de backtest.
- Préférence mémorisée dans `localStorage` sous `lucide_theme` et synchronisée entre les pages du même domaine.
- Au premier accès, le thème suit le réglage du système ; l’utilisateur peut ensuite choisir manuellement.
- Palette nuit Lucide : fonds prune très sombre, surfaces violettes, textes clairs, bordures discrètes et accents cyan/violet.
- Les pages de replay et rapport backtest reçoivent aussi le contrôle global ; certains éléments de visualisation personnalisés peuvent conserver leurs couleurs propres.
