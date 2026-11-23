# Correctif Lucide Sniper — Admin / Dashboard / API

Base utilisée : Trading-Sniper-LUCIDE-Corrections-Signaux-Espace-Trading-2026-11-23.zip fourni dans cette conversation.

## Fichiers à remplacer dans GitHub
- `src/index.ts`
- `public/admin.html`
- `public/dashboard.html`

## Inclus
- `/api/health` : contrôle JSON de disponibilité du Worker, D1 et KV.
- Routes GET login/register : réponse JSON 405 explicite (la connexion reste POST).
- Lecture API robuste dans Admin et Dashboard : détection des réponses HTML, JSON invalide et erreurs HTTP, avec message explicite au lieu de `Unexpected token '<'`.
- Onglets d'administration nommés « Trades en cours » et « Historique des trades » (les filtres et actions existants sont conservés).
- Le design de l'espace de trading présent dans le ZIP de base est conservé.

## Non modifié
- `wrangler.toml`, identifiants D1/KV, schéma et données.
- Moteur de signaux, confirmations M15, SL/TP/RR, cron et Telegram.
- Pages et fonctionnalités hors des trois fichiers listés.

## Déploiement
Extraire les trois fichiers en conservant exactement les chemins, puis remplacer uniquement ces fichiers dans le dépôt GitHub. Attendre la fin du déploiement Cloudflare.
Tester ensuite :
- `/api/health`
- `/api/signals/latest`
- `/admin.html` puis une connexion réelle via le formulaire (ne pas ouvrir `/api/auth/login` comme une page : GET n'est pas la méthode de connexion).

La compilation TypeScript complète et les tests sur le Worker Cloudflare déployé restent à effectuer après intégration.
