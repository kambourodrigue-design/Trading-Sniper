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
