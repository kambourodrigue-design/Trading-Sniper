# Correctif API Cloudflare — 23 novembre 2026

## Cause ciblée
Le module `src/lib/schema.ts` conservait une Promise globale (`ready`) d'initialisation D1. Sur Cloudflare Workers, une Promise créée dans le contexte d'une requête ne doit pas être partagée puis résolue dans le contexte d'une autre requête. Cela correspond au message `This promise was created by a request that has since ended` observé sur `/api/auth/login` et `/api/signals/latest`.

## Changements
- Remplacement de la Promise globale par un indicateur booléen qui ne mémorise que l'état d'initialisation déjà terminée. Chaque initialisation reste attendue dans le contexte de la requête qui l'a lancée.
- Ajout d'un `try/catch` autour du traitement Worker : les exceptions API sont journalisées avec leur chemin et leur pile, et le Worker renvoie une réponse JSON HTTP 500 au lieu de laisser remonter une page HTML générique.
- Aucun changement aux identifiants D1/KV, au schéma SQL, aux secrets, aux stratégies ou aux règles de trading.

## Validation
Les deux fichiers TypeScript modifiés ont passé une vérification de syntaxe/transpilation. Le contrôle TypeScript complet n'a pas pu être exécuté dans cet environnement car les dépendances du projet (`@cloudflare/workers-types`) ne sont pas installées.

## Déploiement
Remplacer les fichiers `src/lib/schema.ts` et `src/index.ts` dans le dépôt. Vérifier ensuite `/api/health`, la connexion et `/api/signals/latest` dans les logs Cloudflare. Ce correctif n'a pas été déployé sur la production.
