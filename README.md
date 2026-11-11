# Lucide — Backend + site (Cloudflare Workers)

Un seul projet Cloudflare : le Worker (`src/`) fournit l'API et le moteur de signaux ; le dossier `public/` contient le site
(landing `index.html`, `dashboard.html`, `admin.html`), servi gratuitement par Cloudflare. Seules les adresses `/api/*` passent par le code.

## Actifs, sources de données et séances
| Actif | Sources (essayées dans l'ordre, repli automatique) | Séance analysée |
|---|---|---|
| XAU/USD | Yahoo `XAUUSD=X` → TwelveData | dimanche 22h → vendredi 22h (UTC) |
| US30 | Yahoo `^DJI` → TwelveData `DJI` | 9h30-16h New York, jours ouvrés (heure d'été gérée) |
| USTEC | Yahoo `^NDX` → TwelveData `NDX` | 9h30-16h New York, jours ouvrés |
| BTC/USD | Binance `BTCUSDT` → Yahoo `BTC-USD` → TwelveData | 24h/24, 7j/7 |

- **Aucune clé de données n'est nécessaire** : Yahoo Finance et Binance sont gratuits sans compte. `TWELVEDATA_API_KEY` est facultative (dernier recours).
- ⚠ **Yahoo est un service non officiel**, réservé à un usage personnel, sans garantie ; depuis les serveurs il renvoie parfois des erreurs `429`. Le moteur essaie alors la source suivante et met l'actif en pause 30 min sans marteler le fournisseur. **Admin → Signaux → « Tester les données »** montre, source par source, ce qui répond. Pour une offre payante aux abonnés, il faudra une source licenciée (ou un flux de ton courtier via MT5).
- Les niveaux US30/USTEC sont ceux de l'indice « cash » (Yahoo) : ils peuvent différer de quelques points du CFD de ton courtier.
- Modifier les actifs ou les sources : `src/engine/config.ts`.

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
| `GET /api/stats` | public — résultats réels suivis (90 j), séparés règles+IA / IA seule |
| `/api/admin/*` | admin (`ADMIN_EMAILS`) : stats, utilisateurs, abonnements manuels, signaux (création, masquage, suppression, clôture), journal d'analyse, analyse d'un actif à la demande |
| `POST /api/webhooks/stripe`, `/api/webhooks/cinetpay` | squelette — **signature à vérifier avant la production** |

## Avant la mise en production
1. Paiements : vérifier les signatures des webhooks ; en attendant, activer les abonnements depuis l'admin.
2. Données de marché : les conditions du plan gratuit TwelveData semblent limitées à un usage interne ; vérifier auprès d'eux (offres Business) avant de vendre des abonnements. Les indices exigent un plan supérieur.
3. Sécurité : rate limiting sur `/api/auth/*`, confirmation d'email, restreindre les accès à ton domaine.
4. Valider le moteur dans la durée (quelques semaines) avec `/api/stats` et le journal d'analyse avant d'annoncer des performances. Il n'a pas été backtesté sur données réelles.
5. Le calendrier économique utilise un flux public non officiel ; s'il tombe, le filtre news est désactivé (les IA en sont informées).
