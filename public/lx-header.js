/* Lucide — menu du haut
   1) Bouton « soleil » (clair / nuit) intégré au menu du haut, à la place du bouton flottant.
   2) Rangée « Créer un compte / Se connecter » juste sous le menu (« Mon compte » si connecté).
   Les pages sans menu du haut (backtest) gardent le bouton flottant d'origine, restylé en CSS. */
(function () {
  var root = document.documentElement;
  var page = (location.pathname.split("/").pop() || "index").replace(/\.html$/, "");

  /* Lien direct vers l'onglet « Créer un compte » ou « Connexion » du tableau de bord */
  function openDashboardTab() {
    if (page !== "dashboard") return;
    var want = location.hash === "#register" ? "register" : location.hash === "#login" ? "login" : null;
    var tab = want && document.querySelector('.tab[data-tab="' + want + '"]');
    if (tab) tab.click();
  }
  openDashboardTab();
  window.addEventListener("hashchange", openDashboardTab);

  var nav = document.querySelector("nav");
  if (!nav) return;
  root.classList.add("lx-has-nav");
  if (getComputedStyle(nav).position === "static") nav.style.position = "relative";

  /* ---------- Bouton soleil ---------- */
  var SUN = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle class="lx-sun-core" cx="12" cy="12" r="4.2"/>' +
    '<g class="lx-sun-rays"><path d="M12 2.5v2.2M12 19.3v2.2M2.5 12h2.2M19.3 12h2.2M5.3 5.3l1.6 1.6M17.1 17.1l1.6 1.6M5.3 18.7l1.6-1.6M17.1 6.9l1.6-1.6"/></g></svg>';
  var t = document.createElement("button");
  t.type = "button";
  t.className = "lx-theme";
  t.innerHTML = SUN;
  function label() {
    var dark = root.dataset.theme === "dark";
    t.setAttribute("aria-label", dark ? "Passer en mode clair" : "Passer en mode nuit");
    t.setAttribute("aria-pressed", String(dark));
    t.title = dark ? "Mode clair" : "Mode nuit";
  }
  function toggleTheme() {
    var orig = document.getElementById("lucide-theme-toggle"); /* réutilise la logique existante de la page */
    if (orig) { orig.click(); return; }
    var next = root.dataset.theme === "dark" ? "light" : "dark";
    root.dataset.theme = next;
    root.style.colorScheme = next;
    try { localStorage.setItem("lucide_theme", next); } catch (e) { /* stockage indisponible */ }
  }
  t.addEventListener("click", function (ev) {
    if (window.lxThemeTransition) window.lxThemeTransition(toggleTheme, ev, t); /* défini par lx-fx.js */
    else toggleTheme();
  });
  new MutationObserver(label).observe(root, { attributes: true, attributeFilter: ["data-theme"] });
  label();
  nav.appendChild(t);

  /* ---------- Boutons compte, juste après le menu ---------- */
  if (page === "dashboard" || page === "admin") return; /* ces pages contiennent déjà la connexion */
  var logged = false;
  try { logged = !!localStorage.getItem("lucide_token"); } catch (e) { /* ignore */ }
  var IC_PLUS = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1"/><circle cx="9" cy="7.5" r="3.5"/><path d="M19 8v6M16 11h6"/></svg>';
  var IC_IN = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 3h3a3 3 0 0 1 3 3v12a3 3 0 0 1-3 3h-3"/><path d="m10 17 5-5-5-5M15 12H3"/></svg>';
  var IC_USER = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21v-1a6 6 0 0 1 6-6h4a6 6 0 0 1 6 6v1"/></svg>';
  var row = document.createElement("div");
  row.className = "lx-auth";
  row.innerHTML = logged
    ? '<a class="lx-btn lx-btn-main" href="/dashboard.html">' + IC_USER + "<span>Mon compte</span></a>"
    : '<a class="lx-btn lx-btn-main" href="/dashboard.html#register">' + IC_PLUS + "<span>Créer un compte</span></a>" +
      '<a class="lx-btn lx-btn-ghost" href="/dashboard.html#login">' + IC_IN + "<span>Se connecter</span></a>";
  var z = parseInt(getComputedStyle(nav).zIndex, 10); /* juste sous le menu, mais au-dessus du bandeau d'en-tête qui remonte sous lui */
  row.style.zIndex = String(isNaN(z) ? 1 : Math.max(1, z - 1));
  nav.insertAdjacentElement("afterend", row);
  /* Évite le doublon : « Mon compte » et « Essayer gratuitement » sont remplacés par la rangée */
  Array.prototype.forEach.call(nav.querySelectorAll('a[href^="/dashboard"]'), function (a) {
    if (/^\s*(mon compte|essayer gratuitement)\s*$/i.test(a.textContent)) a.style.display = "none";
  });
})();
