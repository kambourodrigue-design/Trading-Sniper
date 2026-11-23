# Correctif de robustesse API — Lucide Sniper

## Fichiers à remplacer
- `src/index.ts`
- `public/admin.html`
- `public/dashboard.html`

## Modifications
- Ajout de `GET /api/health` : vérifie le Worker, une requête D1 en lecture seule (`SELECT 1`) et l'accès KV en lecture seule. Réponse JSON avec état `ok` ou `degraded` ; aucun secret ni donnée métier exposé.
- `GET /api/auth/login` répond désormais HTTP 405 en JSON et indique que la connexion attend POST. La vraie route POST reste inchangée.
- Admin et Dashboard lisent d'abord la réponse HTTP en texte, puis analysent le JSON. Une page HTML reçue par erreur produit un message explicite au lieu de `Unexpected token '<'`.
- Les erreurs HTTP JSON affichent le message du serveur et le code HTTP quand disponible.

## Non modifié
- Moteur de signaux, stratégie et confirmations M15.
- Calculs Entry / SL / TP / RR.
- Schéma et données D1, données KV et identifiants Cloudflare.
- Authentification POST, stockage des sessions, Telegram et secrets.
- `wrangler.toml` et configuration de routage.

## Vérifications effectuées
- Syntaxe JavaScript des scripts inline de `admin.html` et `dashboard.html` : OK avec `node --check`.
- Recherche des appels `.json()` directs dans les deux pages : aucun restant pour les réponses API.
- Vérification TypeScript complète non disponible dans cet environnement : les dépendances du projet, notamment `@cloudflare/workers-types`, ne sont pas installées. Aucun déploiement réel n'a été effectué.

## Test après déploiement
1. Ouvrir `/api/health` : attendre `status: "ok"`, `worker: "ok"`, `d1: "ok"`, `kv: "ok"`.
2. Ouvrir `/api/auth/login` en GET : attendre HTTP 405 et un message JSON indiquant que POST est attendu. C'est normal.
3. Ouvrir `/api/signals/latest` : attendre une réponse JSON.
4. Tester la connexion réelle depuis `/admin.html` et le chargement des signaux depuis `/dashboard.html`.
