# Trading Sniper — GOLD AI autonome

## Vue d’ensemble

Le Worker Cloudflare sert le site, l’API, les abonnements, les signaux et le moteur d’analyse. Cette version conserve la base D1 et le namespace KV existants et remplace uniquement le code applicatif lors du déploiement.

## Marchés activés

- **Gold** : XAU/USD.
- **12 paires Forex** : EUR/USD, GBP/USD, USD/JPY, USD/CAD, USD/CHF, AUD/USD, NZD/USD, EUR/GBP, EUR/JPY, EUR/CAD, GBP/JPY et GBP/CAD.
- **Crypto** : BTC/USD et ETH/USD.

## Sources de données

| Usage | Fournisseur | Authentification |
|---|---|---|
| Forex et Gold | biquote | Aucune clé |
| Crypto – source principale | biquote | Aucune clé |
| Crypto – secours | Kraken et Binance | Aucune clé |
| Calendrier économique | ShowMyTrades | Aucune clé |

Les symboles sont configurés dans `src/engine/config.ts`. Les symboles de marché doivent être validés dans Admin → Signaux → **Tester les données**. Si un symbole n’est pas coté par le fournisseur, aucun signal n’est généré pour cet actif jusqu’à correction de son identifiant ou rétablissement du flux.

**Droits d’utilisation :** vérifie les conditions commerciales et de redistribution de biquote avant d’afficher ou de redistribuer ses cotations et graphiques à tes abonnés payants. Le calendrier ShowMyTrades peut être transmis à tes propres clients sous licence propre, mais ne doit pas être revendu comme calendrier autonome.

## Architecture technique

- Cloudflare Workers : application et tâches planifiées.
- D1 : base existante `trading-sniper-db`, binding `DB`.
- KV : namespace existant, binding `CACHE`.
- Cache applicatif des données : table `kv_cache` de D1.
- Cron : toutes les 2 minutes, un actif analysé par passage. Les 15 marchés sont parcourus sur environ 30 minutes, sous réserve de la disponibilité des flux.
- `MAX_PER_RUN=1` : limite les traitements simultanés et le temps CPU par invocation.

## Analyse technique

- H1 : MM50 et MM100.
- H4 : MM50 et MM100.
- D1 : MM50 et MM200.
- SMC : BOS/CHoCH, Order Blocks, FVG, sweeps, offre/demande, Wyckoff, figures, premium/discount et RSI.
- Gestion du risque : SL basé sur la structure et l’ATR, TP1/TP2/TP3, un seul signal ouvert par actif.

Les limites d’historique biquote documentées sont 168 bougies H1, 180 H4 et 500 D1. Le moteur exige au moins 105 bougies H1/H4 et 205 bougies D1 afin de calculer les moyennes mobiles et de garder une petite marge.

## Moteur fondamental autonome

## Mode hybride autonome + GPT

La configuration livrée active `HYBRID_GPT=true`, `AUTONOMOUS_ONLY=false` et `AI_INDEPENDENT=off`. Le moteur de règles conserve la décision de publication et les niveaux (entrée/SL/TP). Si `OPENAI_API_KEY` est configurée, GPT apporte un second avis macro/technique enregistré avec le signal. Cet avis ne peut ni bloquer le signal autonome, ni modifier ses niveaux. Si l’API est absente, en erreur ou indisponible, le moteur autonome continue seul.

Dans Cloudflare Worker > Settings > Variables and Secrets, ajoute `OPENAI_API_KEY` comme **Secret**. `OPENAI_MODEL` peut être défini comme variable simple avec l’identifiant exact d’un modèle disponible dans ton compte API (valeur par défaut : `gpt-6-luna`, le modèle GPT-6 le plus économique ; déjà déclarée dans `wrangler.toml`). L’abonnement ChatGPT ne comprend pas les crédits API.

`AI_INDEPENDENT=off` empêche GPT de générer des trades indépendants. Les autres fournisseurs IA ne sont pas nécessaires pour ce mode.

### Deuxième couche d'analyse fondamentale : GPT-6 Sol
Quand un signal est publié, deux appels OpenAI partent **en parallèle** avec la même clé `OPENAI_API_KEY` :
- **GPT-6 Luna** (`OPENAI_MODEL`) : second avis sur le setup complet (technique + macro).
- **GPT-6 Sol** (`OPENAI_SOL_MODEL`, activé par `FUNDAMENTAL_SOL=true`) : analyse **uniquement fondamentale**. Il reçoit les données macro mesurées (taux directeurs BIS, Treasuries, TIPS, COT, pétrole, VIX, indice dollar, scores macro autonomes, surprises du calendrier, actualités GDELT, intermarchés), sans bougies ni niveaux, et rend un biais haussier / baissier / neutre avec ses facteurs, ses risques et les données manquantes. L'alignement avec la direction du moteur est calculé par le code (aligné / contraire / neutre).
- Le résultat de Sol est enregistré dans `ai_votes` (fournisseur `openai-sol`), ajouté au raisonnement du signal, au dashboard et à Telegram. **Il ne bloque jamais le signal et ne modifie aucun niveau.** S'il échoue, le signal est publié avec la mention « Sol indisponible ».
- Coût indicatif (tarifs OpenAI : Sol 2 $ / 10 $ par million de tokens en entrée / sortie, Luna 0,10 $ / 0,50 $) : un appel Sol coûte de l'ordre de quelques centimes, et il n'a lieu que pour les signaux effectivement publiés. `OPENAI_SOL_EFFORT` règle le niveau de raisonnement ; `FUNDAMENTAL_SOL=false` désactive la couche.

Le moteur gratuit utilise :

1. Les surprises entre valeurs réelles et prévisions du calendrier économique, lorsque les deux valeurs numériques sont disponibles.
2. Un blocage des nouveaux signaux autour des événements High touchant les devises de l’actif (45 minutes avant et 20 minutes après).
3. Un proxy EUR/USD D1 pour estimer la force relative du dollar sur Gold et Crypto. Ce proxy n’est pas un indice DXY officiel.

**Limite importante :** cette version gratuite ne modélise pas encore complètement les différentiels de taux directeurs, les rendements souverains, les courbes de taux et les tendances historiques d’inflation/emploi. Si aucune surprise macro exploitable n’est publiée, le biais fondamental reste neutre. Si le calendrier est indisponible, la publication automatique est suspendue (fail closed).

## Installation et déploiement

1. Décompresse le ZIP et installe les dépendances : `npm install`.
2. Vérifie le nom du Worker dans `wrangler.toml` (`trading-sniper`) avant toute publication. Le fichier Wrangler d’origine indiquait `lucide-backend`, alors que l’URL communiquée est `trading-sniper.trading-snipersignal.workers.dev` : cette archive cible le nom déduit de l’URL, mais arrête-toi si le nom affiché dans Cloudflare est différent.
3. Vérifie que les identifiants D1 et KV correspondent exactement à ceux du Worker de production. Dans cette archive, les identifiants existants ont été conservés. Le fichier `wrangler.original.backup.toml` conserve aussi la configuration Wrangler reçue à l’origine.
4. Vérifie les secrets déjà nécessaires à l’application : `JWT_SECRET` et `ADMIN_EMAILS`. Configure au besoin `TELEGRAM_BOT_TOKEN` et `TELEGRAM_CHAT_ID`.
5. Contrôle le code : `npm run typecheck` puis `npm test`.
6. Déploie seulement après sauvegarde de la version active : `npm run deploy`.

**Aucun déploiement n’a été effectué lors de la préparation de cette archive.** Le code a été modifié localement uniquement. N’exécute pas `npm run deploy` avant d’avoir vérifié le nom du Worker, les bindings D1/KV et les secrets dans ton tableau de bord Cloudflare.

## Moteur ICT / SMC / CRT

Le moteur autonome inclut désormais les détections suivantes, calculées à partir des bougies OHLC disponibles :

- Structure : BOS, CHoCH et MSS (MSS identifié par une cassure de structure avec déplacement relatif à la range récente).
- Liquidité : Equal Highs / Equal Lows, repères BSL (buy-side liquidity) et SSL (sell-side liquidity), sweeps de pivots et réintégration.
- Zones : Order Blocks, Fair Value Gaps, zones offre/demande et Breaker Blocks après invalidation puis reprise de zone.
- Premium / Discount : dealing range glissant, équilibre 50 % (EQ) et position du prix.
- Kill Zones ICT : Londres 07:00–10:00 et New York 07:00–10:00 en heure locale, avec changement été/hiver géré par les fuseaux IANA.
- CRT : bougie de référence, range high/low, sweep d'un extrême et clôture de réintégration dans la range.

Ces détections sont des règles quantitatives opérationnelles, pas une reproduction exhaustive de toutes les variantes discrétionnaires ICT/SMC/CRT. Elles doivent être contrôlées par backtests et observation en marché démo avant toute utilisation en réel. La Kill Zone ajoute une confluence, mais ne force pas à elle seule un trade.

## Backtest et limites

`npx tsx scripts/backtest.ts` permet de rejouer les règles sur les bougies réellement disponibles. biquote expose une fenêtre glissante et non deux années d’historique : le backtest réel est donc un contrôle récent, pas une validation statistique de rentabilité. `--synthetic` utilise des données simulées sans valeur statistique ; `--live` teste des sorties M15 avec une profondeur courte. Aucun résultat de backtest ne garantit une rentabilité future.

## Vérifications dans le Dashboard

1. Admin → Signaux → sélectionner un actif → **Tester les données**.
2. Vérifier que la source biquote retourne assez de bougies H1, H4 et D1.
3. Vérifier le calendrier économique et Telegram.
4. Lancer une analyse manuelle sur un seul actif.
5. Examiner le journal d’analyse avant de laisser le Cron publier automatiquement.

### Macro data enrichment status

The autonomous macro context now includes BIS policy rates, US Treasury yields, CFTC TFF positioning, FRED daily WTI/Brent/VIX/broad-dollar and US-yield series, plus an optional Stooq DX-futures CSV attempt. FRED and BIS data are cached; market series are daily observations, not 15-minute live quotes. `DTWEXBGS` is a broad trade-weighted USD proxy, not the ICE DXY. The score currently reports data coverage and is a prototype pending historical calibration/backtesting; do not use it as a standalone execution trigger.
