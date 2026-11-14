# Lucide — Backend + site (Cloudflare Workers)

Un seul projet Cloudflare : le Worker (`src/`) fournit l'API et le moteur de signaux ; le dossier `public/` contient le site
(landing `index.html`, `dashboard.html`, `admin.html`), servi gratuitement par Cloudflare. Seules les adresses `/api/*` passent par le code.

## Actifs, sources de données et séances
| Actif | Sources (essayées dans l'ordre, repli automatique) | Séance analysée |
|---|---|---|
| XAU/USD | OANDA `XAU_USD` → TwelveData → Yahoo | dimanche 22h → vendredi 22h (UTC) |
| US30 | OANDA `US30_USD` → Yahoo `^DJI` | avec OANDA : CFD ~23 h/jour ; sans OANDA : 9h30-16h New York seulement |
| USTEC | OANDA `NAS100_USD` → Yahoo `^NDX` | idem |
| BTC/USD | Binance → Kraken → OANDA → TwelveData → Yahoo | 24h/24, 7j/7 |

Sources gratuites (secrets Cloudflare) :
- **OANDA** *(recommandé : forex, or, indices)* — crée un compte **démo** gratuit sur oanda.com, puis génère un jeton API (« Gérer l'accès API ») et ajoute-le comme secret `OANDA_API_TOKEN`. Prix de CFD (proches de ceux d'un courtier MT5), H4 natif, aucune limite gênante. Sans compte démo : pas d'OANDA. Les données du compte démo peuvent avoir un léger décalage, sans conséquence pour des bougies H1. `OANDA_ENV = live` seulement si tu utilises un jeton de compte réel.
- **TwelveData** — clé gratuite (`TWELVEDATA_API_KEY`) : forex, or, crypto ; **pas** les indices ; 800 crédits/jour.
- **Binance / Kraken** — Bitcoin, sans clé.
- **Yahoo** — sans clé mais non officiel : bloque souvent les serveurs ; dernier recours.
- **Admin → Signaux → « Tester les données »** montre, source par source, ce qui répond (✔/✖ et la raison). Si une source échoue (429, 401, blocage…), la suivante prend le relais ; si toutes échouent, l'actif est mis en pause 30 min.
- Pour une offre payante aux abonnés, vérifie les conditions d'usage de chaque fournisseur (ou utilise le flux de ton courtier via MT5).
- Ajouter du forex ou d'autres actifs : `src/engine/config.ts` (exemples EUR/USD, GBP/JPY, USD/JPY prêts à décommenter).

## Profils de sélectivité (`PROFILE`)
| Profil | Seuil de score | Tendance H4/D1 | Zone d'intérêt | Espace vers l'obstacle |
|---|---|---|---|---|
| `strict` (v1) | 55 | H4 aligné, ou D1 aligné + H4 neutre + cassure H1 | prix à ≤ 0,25 ATR d'une zone | ≥ 2 R |
| `balanced` | 45 | H4 aligné, ou D1 aligné + H4 neutre | ≤ 0,5 ATR, ou zone touchée dans les 3 dernières bougies | ≥ 1,5 R |
| `active` (défaut) | 38 | idem | ≤ 0,75 ATR, ou zone touchée dans les 5 dernières bougies | ≥ 1,2 R |
Les conditions fixes restent : un déclencheur, SL ≤ 3 ATR, pas de news à fort impact, séance ouverte, 1 seul trade ouvert par actif. Les IA (validation par consensus) sont le second filtre.

## Mesurer avant de régler : backtest local
`npm install` puis `npx tsx scripts/backtest.ts` (sur ton ordinateur, avec Internet) : rejoue les règles sur ~2 ans d'historique Yahoo et affiche, par actif et par profil, le nombre de setups par semaine, les résultats TP/SL, le R moyen et les conditions qui bloquent le plus. Options : `--symbols XAU/USD,US30`, `--profiles balanced,active`, `--synthetic` (test hors-ligne sans valeur statistique). Limites : règles seules (sans IA ni news), pas de spread, bougies H1.

## Comment le moteur décide
1. **Règles** : MM 50/200 (H1/H4/D1), structure (BOS/CHoCH), order blocks, FVG, sweeps, offre/demande, Wyckoff, figures, premium/discount, RSI. Conditions obligatoires : tendance HTF alignée, prix en zone d'intérêt, un déclencheur, SL ≤ 3 ATR, espace ≥ 2R, pas de news à fort impact (−45/+20 min), séance ouverte, **aucun trade déjà ouvert sur l'actif**, score ≥ `MIN_SCORE`.
2. **Validation IA** : DeepSeek, Gemini, Claude jugent le setup avec le contexte macro/géopolitique. Niveaux toujours calculés par les règles.
3. **Analyse indépendante** : si les règles n'ont rien publié, les IA lisent elles-mêmes les bougies et proposent leur trade ; niveaux = médiane des IA, puis garde-fous (entrée au marché, SL 0,5-3 ATR, TP croissants, R/R ≥ 1,5 sur TP2, TP3 ≤ 10 ATR). Signaux marqués `source = 'ai'`, résultats comptés à part.
4. **Une seule IA suffit** : seules les IA qui répondent comptent (une panne est relancée une fois, puis ignorée). 1 IA → elle décide avec un seuil de confiance relevé (75 au lieu de 60/65) ; 2 → les deux d'accord ; 3 → au moins 2. Un veto bloque toujours.
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

## Quotas (estimations pour 4 actifs, à vérifier à l'usage)
| Ressource | Limite gratuite | Consommation estimée / jour |
|---|---|---|
| TwelveData crédits | 800 / jour, 8 / minute | ~85 pour l'analyse + ≤ ~190 pour le suivi (pire cas) ; espacement automatique de 7,6 s entre appels |
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
| Modèles | v4-pro / gemini-3.1-pro-preview / claude-sonnet-5-5 | Secrets/variables optionnels `DEEPSEEK_MODEL`, `GEMINI_MODEL`, `CLAUDE_MODEL`. |

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
2. Données de marché : les conditions du plan gratuit TwelveData semblent limitées à un usage interne ; vérifier auprès d'eux (offres Business) avant de vendre des abonnements. Les indices exigent un plan supérieur.
3. Sécurité : rate limiting sur `/api/auth/*`, confirmation d'email, restreindre les accès à ton domaine.
4. Valider le moteur dans la durée (quelques semaines) avec `/api/stats` et le journal d'analyse avant d'annoncer des performances. Il n'a pas été backtesté sur données réelles.
5. Le calendrier économique utilise un flux public non officiel ; s'il tombe, le filtre news est désactivé (les IA en sont informées).

## Graphique du dashboard
Chaque signal débloqué a un bouton « Voir le graphique » : bougies (H1 / H4 / D1) avec les niveaux **Entry, SL, TP1, TP2, TP3** tracés et une flèche à l'émission du signal. Bibliothèque : TradingView Lightweight Charts v4.2.0 (Apache 2.0), hébergée dans `public/vendor/` ; l'attribution « TradingView Lightweight Charts™ » (lien) est affichée sous le graphique, comme l'exige la licence — garde-la. Les bougies viennent de la même source que le moteur (OANDA, etc.) : pour un service payant, vérifie que la licence de ta source autorise l'affichage à des tiers.
