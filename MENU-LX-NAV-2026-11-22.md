# Menu horizontal Lucide v2 — « verre néon »
- Fichiers : public/lx-nav.css, public/lx-nav.js (partagés), balisage .lx-nav dans les 11 pages HTML.
- Pastille active unique qui glisse d'un onglet à l'autre (animation entre les pages, désactivée si « réduire les animations »).
- Capsule en verre dépoli, liseré dégradé violet/cyan/magenta, témoin cyan sous l'onglet actif.
- Modes clair et nuit gérés ; masqué sur ordinateur (le menu du haut reste).
- Ajouter une page : copier le bloc .lx-nav, changer --i (0 à 4) et aria-current.

## Thème partagé v2 (lx-theme.css)
- Chargé en dernier sur les 11 pages : jetons clair/nuit, cartes, boutons (principal = dégradé du menu, secondaire = verre), champs avec halo cyan, onglets/filtres actifs en dégradé, tableaux à chiffres alignés, menu du haut en verre.
- Corrections mobile : bouton Mode nuit ne recouvre plus « Mon compte », liens du menu du haut sans soulignement.
- Pour retoucher tout le site : modifier uniquement public/lx-theme.css.

## Menu du haut : bouton soleil + boutons compte (lx-header.js)
- Bouton rond « soleil » intégré au menu du haut (clair = soleil plein, nuit = soleil en contour). Il réutilise la logique existante : l'ancien bouton flottant est masqué quand un menu du haut existe.
- Rangée « Créer un compte / Se connecter » juste sous le menu (« Mon compte » si l'utilisateur est connecté). Absente sur dashboard.html et admin.html.
- Liens directs : /dashboard.html#register et /dashboard.html#login ouvrent le bon onglet.
- Pages sans menu du haut (backtest-report, backtest-replay) : l'ancien bouton flottant reste, restylé en pastille ronde sans texte.
- Fichiers : public/lx-header.js (nouveau), public/lx-theme.css (styles ajoutés), balise <script> ajoutée dans les 11 pages.

## Correctifs pages de backtest
- backtest-replay.html : plus de débordement horizontal sur petit mobile (champs « Fichier » limités à la largeur de l'écran).
- backtest-replay.html et backtest-report.html : ces deux pages ont leur propre thème sombre ; lx-theme.css n'y est plus chargé (il rendait le titre quasi invisible en mode clair). Le bouton jour/nuit y est masqué, car il n'a pas d'effet sur ces pages.

## Version ordinateur identique au mobile (2026-11-25)
- Capsule du bas (.lx-nav) désormais visible sur ordinateur : centrée, plus grande et plus aérée (700 px max).
- En-tête épuré sur tous les écrans : logo + bouton soleil ; les liens du haut sont masqués (la navigation est dans la capsule).
- Bouton soleil centré verticalement dans l'en-tête.
- Fichiers modifiés : public/lx-nav.css, public/lx-theme.css. Moteur, API, D1/KV : inchangés.

## Effets visuels « cockpit néon » (lx-fx.css + lx-fx.js, 2026-11-25)
- Fond aurore animé (3 halos qui dérivent + fine ligne radar), en pause quand l'onglet est caché.
- Lumière qui suit le curseur (ordinateur), barre de progression de lecture en haut.
- Entrée en scène (une fois par session) : en-tête qui descend, boutons compte qui apparaissent, capsule du bas qui monte.
- Apparition progressive des blocs au défilement (flou → net), bandeau d'en-tête en cascade.
- Boutons principaux : reflet qui traverse au survol ; cartes : halo néon au survol ; cartes d'abonnement : inclinaison 3D légère.
- Capsule du bas : lueur qui respire, témoin cyan qui clignote, icône active qui rebondit, onde au toucher + vibration légère sur mobile.
- Changement de page fluide (View Transitions, Chrome/Android) ; bascule clair/nuit en cercle qui s'étend depuis le soleil (repli : fondu des couleurs).
- Respecte « réduire les animations » : aucun effet, aucun élément masqué. Sans JavaScript, le site reste intact.
- Pages sans effets : backtest-report.html et backtest-replay.html (thème sombre propre).
- Pour retirer un effet : supprimer son bloc dans public/lx-fx.css ; pour tout couper : retirer les balises lx-fx.css et lx-fx.js des pages.
