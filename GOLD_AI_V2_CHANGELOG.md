# Trading Sniper GOLD AI — changements v2

- Remplacement des sources de prix configurées : biquote pour les 12 paires Forex et XAU/USD ; biquote puis Kraken/Binance pour BTC/USD et ETH/USD.
- Suppression des intégrations de prix précédentes et de leurs variables/secrets associés dans le code.
- Calendrier économique ShowMyTrades sans clé, mis en cache 15 minutes.
- Moteur fondamental déterministe : surprises actual/prévision quand disponibles, force relative calculée par devise, blocage des nouvelles publications si le calendrier est indisponible.
- Publication autonome forcée par `AUTONOMOUS_ONLY=true`; appels IA payants désactivés.
- Moyennes mobiles : MM50/MM100 H1 et H4 ; MM50/MM200 D1.
- Historique requis : 105 bougies H1/H4 et 205 bougies D1.
- Suivi des trades : M15 pour les positions récentes, H1 pour les positions plus anciennes afin de tenir compte de la fenêtre M15 limitée.
- Dashboard Admin mis à jour avec les 15 actifs.
- Cron toutes les 2 minutes, un actif par passage, afin de parcourir les 15 actifs en environ 30 minutes.
- Le nom du Worker cible est `trading-sniper`; les identifiants D1 et KV de l’archive d’origine sont conservés à l’identique.

Aucune migration D1 n’a été ajoutée et aucun déploiement Cloudflare n’a été effectué.


## Mise à jour HYBRID (19/11/2026)
- Le moteur autonome conserve la décision finale de publication et les niveaux de trading.
- GPT via l’API OpenAI fournit un second avis fondamental/technique, enregistré avec le signal, sans veto et sans modification des niveaux.
- En cas d’absence de clé ou d’échec API, retour transparent au moteur autonome sans interruption.
- Analyse indépendante IA désactivée pour éviter que GPT crée des trades séparés.
- Ajouter `OPENAI_API_KEY` comme Secret Cloudflare et vérifier `OPENAI_MODEL` avec les modèles disponibles dans le compte API.


## Extension ICT/SMC/CRT
- Ajout des événements MSS en plus de BOS/CHoCH (déplacement relatif à la range récente).
- Ajout des Breaker Blocks calculés à partir d'anciens OB invalidés puis repris.
- Ajout du CRT : bougie de référence, range, sweep et clôture de réintégration.
- Ajout des Kill Zones Londres/New York en heures locales DST-aware.
- Ajout des repères BSL/SSL issus des Equal Highs/Equal Lows, avec détection dédiée des sweeps de pools de liquidité et réintégration.
- Les nouvelles confluences alimentent l'évaluation autonome ; aucune modification des identifiants D1/KV ni déploiement production.

## Enrichissement fondamental autonome — Lucide Sniper
- Ajout de la courbe quotidienne des Treasuries US (2 ans, 10 ans) et du rendement réel TIPS 10 ans via le flux XML officiel du Trésor américain.
- Ajout du positionnement Leveraged Funds du rapport CFTC Traders in Financial Futures pour les principales devises (donnée hebdomadaire, pas intraday).
- Cache dédié : 6 heures pour rendements et COT ; contexte macro agrégé conservé 15 minutes.
- Les données sont présentées comme contexte macro et ne remplacent pas les règles de biais fondées sur des surprises publiées. En cas d'indisponibilité, le moteur signale la source manquante et ne fabrique aucune valeur.
- Aucun identifiant D1/KV ni paramètre de production n'a été modifié ; aucun déploiement effectué.

## Enrichissement macro — phase 1 (préparation, non déployée)
- Ajout de la récupération des taux directeurs via le jeu BIS CBPOL, API publique sans clé.
- Couverture ciblée : USD/Fed, EUR/BCE, GBP/BoE, JPY/BoJ, CAD/BoC, CHF/BNS, AUD/RBA et NZD/RBNZ.
- Extraction de la dernière observation disponible et des derniers changements de taux observés depuis 2000.
- Calcul des différentiels de taux directeurs pour les principales paires suivies par Lucide Sniper.
- Cache applicatif D1 de six heures pour les taux, sans modification du schéma D1, des identifiants D1/KV ou de wrangler.toml.
- Les dates BIS correspondent aux dates d'effet observées dans la série et ne sont pas présentées comme les heures d'annonce des banques centrales.
- Source : BIS Central Bank Policy Rates (CBPOL). Les observations quotidiennes sont diffusées autour du milieu de semaine ; elles ne sont donc pas un flux intraday.
- Validation limitée à l'inspection statique et à l'intégrité de l'archive : l'accès réseau depuis l'environnement de préparation et le test TypeScript complet restent à effectuer.

## Phase macro complémentaire — pétrole, dollar, volatilité et score explicable

- Ajout des séries FRED quotidiennes WTI (`DCOILWTICO`), Brent (`DCOILBRENTEU`), VIX (`VIXCLS`), indice large USD (`DTWEXBGS`), Treasury 2 ans (`DGS2`) et TIPS réel 10 ans (`DFII10`). Export CSV public FRED, sans clé API ; nouvelle vérification du cache toutes les 15 minutes (les observations restent quotidiennes).
- Ajout d'une tentative de lecture du future Dollar Index DX via CSV Stooq (`dx.f`). En cas d'indisponibilité/limitation, le moteur conserve `DTWEXBGS` comme proxy secondaire et le signale explicitement : ce n'est pas l'ICE DXY.
- Calcul des variations quotidiennes et, pour les rendements américains, de la variation sur cinq observations.
- Ajout d'un score macro par devise et de biais relatifs indicatifs sur EUR/USD, GBP/USD, USD/JPY, USD/CHF, USD/CAD, AUD/USD, NZD/USD, EUR/GBP, EUR/JPY, GBP/JPY, EUR/CAD, XAU/USD, BTC/USD et ETH/USD.
- Le score affiche la couverture des facteurs disponibles. Les poids cibles restent 25/25/15/20/10/5 ; les rendements obligataires ne sont actuellement scorés que pour USD. Les facteurs manquants ne sont pas inventés ni comptés comme observations.
- Le score est un prototype explicable, non une probabilité de gain et non calibré par backtest historique. Il ne doit pas déclencher seul une position.
- Aucun changement des bindings D1/KV, du schéma SQL, de `wrangler.toml`, des secrets ou des réglages de déploiement. Aucun déploiement effectué.
- Ajout d'un test unitaire du rendu du score, de l'indicateur de couverture et des biais relatifs. L'exécution de la suite complète reste bloquée dans l'environnement actuel car `tsx` et les types Cloudflare ne sont pas installés.

## Mode adaptatif (préparation hors production)
- Le profil par défaut passe à `adaptive` : seuils recalculés séparément pour BUY et SELL selon l'alignement H4/D1.
- Le régime de volatilité est estimé par le ratio ATR H1 / (ATR H4 / 2). Une volatilité élevée augmente le score minimal et l'espace libre exigé ; une volatilité très faible ajoute une marge de prudence.
- Les règles de sécurité (calendrier indisponible, news à fort impact, marché fermé, signal déjà ouvert, risque SL maximal) restent obligatoires.
- Les fournisseurs crypto ont une temporisation locale après HTTP 429 (60 s), HTTP 5xx (30 s) et HTTP 451 (6 h), afin d'éviter de marteler une source temporairement limitée ou géo-bloquée et de laisser essayer les replis.
- Aucun fournisseur Deriv ou LSE n'est configuré dans `src/engine/config.ts`; le code de cette archive utilise BiQuote et, pour les cryptos uniquement, Kraken puis Binance.
- Tests unitaires ajoutés pour les seuils adaptatifs. Les valeurs sont heuristiques initiales, pas calibrées ni validées par backtest.
- `wrangler.toml` sélectionne `PROFILE = "adaptive"`. Aucun déploiement ni migration D1 effectué.


## Couche GPT-6 Luna — effort de raisonnement moyen
- `OPENAI_EFFORT` passe de `low` à `medium` dans la configuration de staging.
- La valeur de repli du code est également `medium` si la variable est absente ou invalide.
- Le modèle reste `gpt-6-luna`; le deuxième avis IA reste consultatif et ne modifie pas les niveaux du moteur autonome.
- Aucun changement D1/KV et aucun déploiement.


## Correctifs de staging — 20 novembre 2026

- SL : sélection de la zone d’invalidation valide la plus proche du prix ; les zones situées du mauvais côté du prix sont ignorées. La mèche d’un sweep n’est prise en compte que si elle se trouve du côté cohérent. Le buffer reste de 0,25 ATR. Suppression de l’élargissement automatique à 0,8 ATR qui pouvait agrandir inutilement le stop. Le plafond de 3 ATR reste un filtre de rejet, non une promesse de performance.
- Liquidité : BSL et SSL affichent maintenant le niveau le plus proche du prix, au lieu d’afficher le premier élément d’une liste différente de celle utilisée pour la distance.
- IA hybride : OpenAI reste prioritaire si `OPENAI_API_KEY` existe ; à défaut, `DEEPSEEK_API_KEY` peut fournir le second avis. Sans l’une de ces clés, le moteur autonome continue sans avis IA. Les niveaux et la décision de publication restent contrôlés par le moteur de règles.
- Tests ajoutés : sélection du SL BUY/SELL, exclusion des zones invalides et traitement du sweep.
- Validation locale : 20 tests unitaires réussis ; vérification TypeScript réussie avec déclarations temporaires Cloudflare minimales. Les types Cloudflare officiels n’ont pas pu être installés dans cet environnement. Le backtest synthétique a commencé mais n’a pas été terminé ; ses données simulées ne permettent de toute façon aucune conclusion de rentabilité. Aucun backtest historique réel n’a été exécuté.
- Aucun déploiement et aucune modification des identifiants D1/KV.
