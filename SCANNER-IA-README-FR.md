# Scanner IA Lucide — première intégration

## Principe

Le Scanner IA est une interface de lecture du moteur existant. Il ne calcule pas de nouveaux signaux et ne modifie aucune règle de trading.

## Fonctionnement

- `GET /api/scanner` récupère, pour chaque actif de `SYMBOLS`, le dernier signal public publié (`user_id IS NULL`, `status = 'published'`).
- La réponse est construite à partir de la table D1 `signals` et des règles d'accès déjà utilisées par `/api/signals/latest`.
- Les niveaux Entry / SL / TP restent masqués selon le plan de l'utilisateur.
- Les actifs sans signal affichent « En attente d'un signal validé ». Cela ne signifie pas qu'aucun mouvement de marché n'existe.
- La page `/scanner.html` actualise l'affichage toutes les 60 secondes et propose une recherche ainsi que des filtres Forex/Métaux, Crypto, BUY et SELL.

## Fichiers modifiés

- `src/index.ts` : ajout de la route `/api/scanner`.
- `public/scanner.html` : nouvelle page Scanner IA.
- `public/index.html` : liens vers le Scanner depuis l'accueil.
- `public/dashboard.html` : raccourcis vers le Scanner.

## Limites actuelles

- Le Scanner présente le dernier signal publié par actif, pas une cotation en temps réel ni un biais technique recalculé à chaque chargement.
- La page ne force aucune analyse du moteur : la cadence reste celle du cron et de la rotation déjà configurés.
- Les données de bougies et les indicateurs détaillés ne sont pas ajoutés à cette première étape.

## Déploiement

Aucune migration D1 n'est requise. Les identifiants D1/KV et les paramètres du moteur sont inchangés. Déployer le Worker et ses assets habituels après vérification en environnement de test.
