# Lucide — Backend + site (Cloudflare Workers)

Un seul projet Cloudflare : le Worker (`src/`) fournit l'API et le moteur de signaux ; le dossier `public/` contient le site
(landing `index.html`, `dashboard.html`, `admin.html`), servi gratuitement par Cloudflare. Seules les adresses `/api/*` passent par le code.

## Actifs, source de données et séances
Source unique : **LSE Data** (London Strategic Edge), API REST avec bougies M15, H1, H4 et D1 natives.

| Actif | Symbole LSE (marché : symbole) | Séance analysée |
|---|---|---|
| XAU/USD | `forex:XAU_USD`, sinon `commodities:XAU_USD`, `commodities:XAUUSD`, `commodities:GOLD` (essayés dans l'ordre) | dimanche 22h → vendredi 22h (UTC) |
| BTC/USD | `crypto:BTCUSDT` (Bitcoin coté en Tether) | 24h/24, 7j/7 |

Configuration :
- Crée un compte sur londonstrategicedge.com, génère une clé sur la page « Data » et ajoute-la comme secret Cloudflare `LSE_API_KEY`. Plan gratuit : 60 appels/minute, forex, crypto et matières premières inclus ; la clé est envoyée dans l'en-tête `X-API-Key`.
- Le symbole exact de l'or dans le catalogue LSE n'a pas pu être vérifié à l'écriture du code : si « Tester les données » échoue pour XAU/USD, le message affiche les symboles proches du catalogue ; corrige alors `id` et `market` dans `src/engine/config.ts`.
- **Admin → Signaux → « Tester les données »** montre si LSE Data répond pour l'actif (✔/✖ et la raison). Si la source échoue (429, 401, symbole inconnu…), l'actif est mis en pause 30 min.
- **Conditions d'usage LSE** : les données peuvent servir à ta recherche et à ton trading, y compris commercial, mais **pas être redistribuées ni mises à disposition de tiers**. Le bouton « Voir le graphique » (bougies affichées aux abonnés) est donc à vérifier avec LSE avant toute offre payante (londonstrategicedge.com/terms).
- Ajouter du forex ou d'autres actifs : `src/engine/config.ts` (exemples EUR/USD, GBP/JPY, USD/JPY prêts à décommenter).

## Profils de sélectivité (`PROFILE`)
| Profil | Seuil de score | Tendance H4/D1 | Zone d'intérêt | Espace vers l'obstacle |
|---|---|---|---|---|
| `strict` (v1) | 55 | H4 aligné, ou D1 aligné + H4 neutre + cassure H1 | prix à ≤ 0,25 ATR d'une zone | ≥ 2 R |
| `balanced` | 45 | H4 aligné, ou D1 aligné + H4 neutre | ≤ 0,5 ATR, ou zone touchée dans les 3 dernières bougies | ≥ 1,5 R |
| `active` (défaut) | 38 | idem | ≤ 0,75 ATR, ou zone touchée dans les 5 dernières bougies | ≥ 1,2 R |
Les conditions fixes restent : un déclencheur, SL ≤ 3 ATR, pas de news à fort impact, séance ouverte, 1 seul trade ouvert par actif. Les IA (validation par consensus) sont le second filtre.

## Mesurer avant de régler : backtest local
`npm install` puis `npx tsx scripts/backtest.ts` (sur ton ordinateur, avec Internet) : rejoue les règles sur ~2 ans d'historique LSE Data (clé `LSE_API_KEY` requise en variable d'environnement) et affiche, par actif et par profil, le nombre de setups par semaine, les résultats TP/SL, le R moyen et les conditions qui bloquent le plus. Options : `--symbols XAU/USD,BTC/USD`, `--profiles balanced,active`, `--synthetic` (test hors-ligne sans valeur statistique). Limites : règles seules (sans IA ni news), pas de spread, bougies H1.

## Comment le moteur décide
1. **Règles** : MM 50/200 (H1/H4/D1), structure (BOS/CHoCH), order blocks, FVG, sweeps, offre/demande, Wyckoff, figures, premium/discount, RSI. Conditions obligatoires : tendance HTF alignée, prix en zone d'intérêt, un déclencheur, SL ≤ 3 ATR, espace ≥ 2R, pas de news à fort impact (−45/+20 min), séance ouverte, **aucun trade déjà ouvert sur l'actif**, score ≥ `MIN_SCORE`. **Intermarchés (fondamental chiffré)** : le dollar (proxy EUR/USD en D1) et les taux US à 10 ans (LSE, série `US10Y`) sont mesurés sur 10 séances ; dollar et taux en hausse pèsent sur l'or et le Bitcoin, en baisse ils les soutiennent. Le biais ajuste le score de ± 6 points au plus, et les chiffres sont transmis aux IA. Si ces données manquent, le biais est neutre. Les poids par actif sont dans `src/lib/intermarket.ts` ; Admin → Signaux → « Tester les données » vérifie aussi ces deux flux.
2. **Validation IA** : GPT-6, DeepSeek, Gemini, Claude (celles dont la clé est configurée) jugent le setup avec le contexte macro/géopolitique. Niveaux toujours calculés par les règles.
3. **Analyse indépendante** : si les règles n'ont rien publié, les IA lisent elles-mêmes les bougies et proposent leur trade ; niveaux = médiane des IA, puis garde-fous (entrée au marché, SL 0,5-3 ATR, TP croissants, R/R ≥ 1,5 sur TP2, TP3 ≤ 10 ATR). Signaux marqués `source = 'ai'`, résultats comptés à part.
4. **Une seule IA suffit** : seules les IA qui répondent comptent (une panne est relancée une fois, puis ignorée). 1 IA → elle décide avec un seuil de confiance relevé (75 au lieu de 60/65) ; 2 → les deux d'accord ; 3 → au moins 2 ; 4 → au moins 3 (majorité stricte). Un veto bloque toujours.
5. **1 trade à la fois par actif** : tant qu'un trade n'a pas atteint son résultat (SL, TP3, stop suiveur ou expiration à `expiryHours` = 120 h), aucun autre signal n'est émis sur cet actif. Garantie par la base de données (index unique) — même si deux analyses tournent en même temps. L'admin peut **clôturer** un trade manuellement (ni gagnant ni perdant) pour libérer l'actif.
6. **Suivi** : TP1 → SL à l'entrée ; TP2 → SL à TP1 ; si le stop et un TP sont touchés dans la même bougie, le stop est compté en premier.

## Notifications Telegram (usage personnel)
Chaque nouveau signal, chaque TP atteint (avec le déplacement du SL), chaque SL, expiration et clôture manuelle est envoyé sur ton Telegram, avec notification sur le téléphone (les messages restent disponibles hors ligne).
1. Dans Telegram, ouvre **@BotFather** → `/newbot` → choisis un nom puis un identifiant finissant par `bot` → copie le **token**.
2. Récupère ton **chat id** : envoie `/start` à ton bot (obligatoire pour qu'il puisse t'écrire), puis ouvre dans ton navigateur `https://api.telegram.org/bot<TOKEN>/getUpdates` et repère `"chat":{"id":123456789 ...}`. (Pour un canal privé : crée le canal, ajoute le bot comme **administrateur** avec le droit de publier, publie un message, puis `getUpdates` affiche un identifiant du type `-100…`.)
3. Cloudflare → Worker → Variables et secrets (type Secret) : `TELEGRAM_BOT_TOKEN` et `TELEGRAM_CHAT_ID` (plusieurs destinataires : séparés par des virgules).
4. Admin → onglet Signaux → **Tester Telegram**. En cas d'erreur, le message de Telegram s'affiche (ex. « chat not found » = tu n'as pas encore écrit `/start` au bot).
Le token est un secret : ne le partage pas. Les messages sont envoyés en « contenu protégé » (pas de transfert depuis l'application). Plans, canaux par abonnement et invitations automatiques : plus tard.
Ton compte admin voit tous les niveaux de signaux sans abonnement.

## Quotas (estimations pour 2 actifs, à vérifier à l'usage)
| Ressource | Limite gratuite | Consommation estimée / jour |
|---|---|---|
| LSE Data appels | 60 / minute (plan gratuit) ; quota hebdomadaire de volume très large pour des bougies | 3 appels par analyse (H1, H4, D1) + 1 par trade ouvert pour le suivi ; espacement automatique de 1,1 s entre appels |
| Cloudflare Workers requêtes | 100 000 / jour | ~290 (cron) + visites API ; pages statiques gratuites |
| Workers CPU (plan Free) | 10 ms / passage | **juste** : voir Workers Paid (5 $/mois) si erreur 1102 dans les logs |
| Appels externes par passage (Free) | 50 | ≤ ~20 avec `MAX_PER_RUN = 1` |
| D1 | 100 000 écritures, 5 M lectures | ~500-800 écritures |
| KV | 1 000 écritures / jour | ~20 (cache invalidé seulement si un signal change) |
| IA | payant selon fournisseur | validation : 0-3 setups/jour × 3 IA ; indépendante : ~10-25 analyses/jour × 3 IA (réglable : `AI_INDEPENDENT`) |
| Alpha Vantage (optionnel) | 25 / jour | 8 |

## Réglages (`wrangler.toml` > `[vars]` — à modifier sur GitHub, pas dans le dashboard)
| Réglage | Défaut | Effet |
|---|---|---|
| `MAX_PER_RUN` | 1 | Actifs analysés par passage. Free : 1 (le 4e actif est analysé ~15 min après la clôture). Paid : 4. |
| `PROFILE` | active | `strict` / `balanced` / `active` (voir ci-dessus). `MIN_SCORE` (facultatif) remplace le seuil du profil. |
| `AI_INDEPENDENT` | h4 | `off` / `prefilter` (score moteur ≥ `AI_PREFILTER_SCORE`) / `h4` (prefilter + à chaque clôture H4, soit 6 fois par jour et par actif) / `always` (chaque heure). |
| `AI_PREFILTER_SCORE` | 30 | Seuil de déclenchement de l'analyse indépendante. |
| Modèles | gpt-6-astra / v4-pro / gemini-3.1-pro-preview / claude-sonnet-5-5 | Optionnels : `OPENAI_MODEL`, `DEEPSEEK_MODEL`, `GEMINI_MODEL`, `CLAUDE_MODEL`. |
| `OPENAI_EFFORT` | medium | Effort de raisonnement de GPT-6 : `low`, `medium`, `high`, `xhigh`, `max`. Plus haut = analyse plus poussée, mais plus lente et plus chère. |

## Routes
| Route | Accès |
|---|---|
| `POST /api/auth/register`, `/api/auth/login` | public |
| `GET /api/me` | Bearer |
| `GET /api/signals/latest` | public ; niveaux **verrouillés** sans abonnement (Starter : XAU/USD + BTC/USD ; Pro/Elite : tout + explication + avis IA) |
| `GET /api/candles?symbol=XAU/USD&tf=H1` | compte requis ; bougies clôturées (H1 : 200, H4 : 160, D1 : 120) servies depuis le cache horaire du moteur (aucun appel supplémentaire aux fournisseurs de données) — alimente le graphique du dashboard |
| `GET /api/stats` | public — résultats réels suivis (90 j), séparés règles+IA / IA seule |
| `GET /api/candles?symbol=XAU/USD&tf=H1` | compte requis — bougies clôturées (H1 / H4 / D1) pour le graphique du dashboard, servies depuis le cache horaire du moteur (aucune requête supplémentaire aux fournisseurs de données) |
| `/api/admin/*` | admin (`ADMIN_EMAILS`) : stats, utilisateurs, abonnements manuels, signaux (création, masquage, suppression, clôture), journal d'analyse, analyse d'un actif à la demande |
| `POST /api/webhooks/stripe`, `/api/webhooks/cinetpay` | squelette — **signature à vérifier avant la production** |

## Graphique du dashboard
Sur chaque signal débloqué, « Voir le graphique » ouvre un graphique en bougies (H1 / H4 / D1) avec les lignes **Entry, SL, TP1, TP2, TP3** et une flèche à l'émission du signal. Bibliothèque : TradingView Lightweight Charts™ 4.2.0 (Apache-2.0), hébergée dans `public/vendor/` avec sa licence ; la mention « TradingView Lightweight Charts™ » avec lien doit rester affichée sous le graphique. Les bougies sont celles de ta source de données (OANDA, etc.) : pour une offre payante, vérifie que ses conditions autorisent l'affichage aux abonnés.

## Avant la mise en production
1. Paiements : vérifier les signatures des webhooks ; en attendant, activer les abonnements depuis l'admin.
2. Données de marché : les données LSE ne peuvent pas être redistribuées à des tiers ; vérifier auprès de LSE si l'affichage des bougies (graphiques) aux abonnés est autorisé.
3. Sécurité : rate limiting sur `/api/auth/*`, confirmation d'email, restreindre les accès à ton domaine.
4. Valider le moteur dans la durée (quelques semaines) avec `/api/stats` et le journal d'analyse avant d'annoncer des performances. Il n'a pas été backtesté sur données réelles.
5. Le calendrier économique utilise un flux public non officiel ; s'il tombe, le filtre news est désactivé (les IA en sont informées).

## Graphique du dashboard
Chaque signal débloqué a un bouton « Voir le graphique » : bougies (H1 / H4 / D1) avec les niveaux **Entry, SL, TP1, TP2, TP3** tracés et une flèche à l'émission du signal. Bibliothèque : TradingView Lightweight Charts v4.2.0 (Apache 2.0), hébergée dans `public/vendor/` ; l'attribution « TradingView Lightweight Charts™ » (lien) est affichée sous le graphique, comme l'exige la licence — garde-la. Les bougies viennent de la même source que le moteur (OANDA, etc.) : pour un service payant, vérifie que la licence de ta source autorise l'affichage à des tiers.

## GPT-6 (OpenAI)
- Secret : `OPENAI_API_KEY` (clé créée sur platform.openai.com). Modèle par défaut `gpt-6-astra` (API Responses) ; si ta clé n'y a pas accès, repli automatique sur `gpt-5.6-sol`. `OPENAI_MODEL` permet d'en choisir un autre.
- Il participe à la **validation** des setups (avis + niveau de confiance) **et** à l'**analyse indépendante** : il lit lui-même les bougies D1/H4/H1 et le contexte macro, puis propose son propre trade (sens, SL, TP) ou « aucun trade ».
- L'analyse propre de chaque IA est conservée : visible dans le dashboard (« Avis des IA », plans Pro/Elite et admin), dans les messages Telegram, et dans le journal de l'admin (même quand aucun signal n'est publié).
- Coût : GPT-6 est facturé à l'usage (tarif par million de jetons, à vérifier sur openai.com) ; le raisonnement consomme des jetons de sortie. Commence par `OPENAI_EFFORT = medium`, surveille la facture la première semaine, et ajuste `AI_INDEPENDENT` (`off` / `prefilter` / `h4` / `always`) si besoin.
