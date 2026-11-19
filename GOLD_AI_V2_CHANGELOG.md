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


## Modèle Luna et couche fondamentale GPT-6 Sol (19/11/2026)
- Modèle par défaut du second avis GPT : `gpt-6-luna` (le plus économique de la famille GPT-6) ; `OPENAI_MODEL = "gpt-6-luna"` est déclaré dans `wrangler.toml`. L'ancien défaut `gpt-6` est abandonné.
- Nouvelle 2e couche d'analyse fondamentale : `askFundamentalSol` (`src/lib/ai.ts`) appelle `gpt-6-sol` (variable `OPENAI_SOL_MODEL`, effort `OPENAI_SOL_EFFORT`, interrupteur `FUNDAMENTAL_SOL`). Elle ne lit que les données macro mesurées (aucune bougie, aucun niveau) et rend un biais haussier/baissier/neutre, ses facteurs, ses risques et les données manquantes.
- Appelée seulement pour les signaux publiés, en parallèle du second avis Luna. Sans veto et sans effet sur les niveaux ; résultat stocké dans `ai_votes` (`openai-sol`), dans le raisonnement, sur Telegram et dans le dashboard. En cas d'échec, publication normale avec la mention « Sol indisponible ».
- L'alignement du biais de Sol avec la direction du moteur (aligné / contraire / neutre) est calculé par le code, pas par le modèle.
- Aucune migration D1 ; aucun identifiant D1/KV modifié ; aucun déploiement effectué.
