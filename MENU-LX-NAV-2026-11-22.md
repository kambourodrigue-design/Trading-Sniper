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
