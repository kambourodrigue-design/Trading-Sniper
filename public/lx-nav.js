/* Lucide — menu du bas : la pastille part de l'onglet précédent et glisse vers l'onglet courant. */
(function () {
  var nav = document.querySelector(".lx-nav");
  if (!nav) return;
  var pill = nav.querySelector(".lx-pill");
  var cur = parseInt(nav.style.getPropertyValue("--i"), 10);
  if (isNaN(cur)) return;

  var prev = null;
  try {
    var raw = sessionStorage.getItem("lx_nav_prev");
    if (raw !== null) prev = parseInt(raw, 10);
    sessionStorage.setItem("lx_nav_prev", String(cur));
  } catch (e) { /* stockage indisponible : pas d'animation, pas d'erreur */ }

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  if (reduce || prev === null || isNaN(prev) || prev === cur) return;

  pill.style.transition = "none";
  nav.style.setProperty("--i", prev);
  void pill.offsetWidth; /* force l'application de la position de départ */
  requestAnimationFrame(function () {
    pill.style.transition = "";
    nav.style.setProperty("--i", cur);
  });
})();
