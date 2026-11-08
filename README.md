# Lucide — Backend + site (Cloudflare Workers)

Un seul projet Cloudflare : le Worker (`src/`) fournit l'API et le moteur de signaux ; le dossier `public/` contient le site
(landing `index.html`, `dashboard.html`, `admin.html`), servi gratuitement par Cloudflare. Seules les adresses `/api/*` passent par le code.

## Actifs et séances
| Actif | Source de prix (TwelveData) | Séance analysée |
|---|---|---|
| XAU/USD | XAU/USD | dimanche 22h → vendredi 22h (UTC) |
| US30 | DJI (indice Dow Jones) | 9h30-16h New York, jours ouvrés (heure d'été gérée) |
| USTEC | NDX (indice Nasdaq 100) | 9h30-16h New York, jours ouvrés |
| BTC/USD | BTC/USD | 24h/24, 7j/7 |

⚠ Les indices ne sont pas inclus dans le plan gratuit TwelveData : tant que ton plan ne les inclut pas, le moteur désactive l'actif 12 h
(message dans l'admin) et continue avec les autres. Les niveaux US30/USTEC sont ceux de l'indice : ils peuvent différer de quelques points du CFD de ton courtier.
Modifier les actifs : `src/engine/config.ts`.

## Fréquence d'analyse
- Le cron passe **toutes les 5 minutes** ; un actif est analysé **une fois par heure, dès que sa bougie H1 est clôturée** (donc à partir de :05), seulement pendant sa séance.
- H4 et D1 sont rechargées à leur clôture. Analyser plus souvent n'apporterait aucune information nouvelle (les décisions reposent sur des bougies clôturées) et gaspillerait des crédits.
- Les trades ouverts sont suivis (bougies M15) toutes les ~25 min. Contexte macro rafraîchi toutes les 3 h ; calendrier économique toutes les heures.
- Si les données ne sont pas à jour (flux en retard, jour férié), le moteur réessaie 3 fois puis ignore l'actif jusqu'à l'heure suivante.

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
| `MIN_SCORE` | 55 | Score de confluence minimal. Plus bas = plus de signaux, moins sélectifs. |
| `AI_INDEPENDENT` | prefilter | `off` / `prefilter` (si score moteur ≥ `AI_PREFILTER_SCORE`) / `always`. |
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
