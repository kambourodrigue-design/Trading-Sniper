/* Lucide — effets visuels (voir lx-fx.css). Tout est facultatif : si ce script échoue, le site reste entièrement utilisable. */
(function () {
  "use strict";
  var root = document.documentElement;
  var reduce = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var fine = window.matchMedia && matchMedia("(hover: hover) and (pointer: fine)").matches;
  root.classList.add("lx-fx");
  if (reduce) return; /* mouvement réduit : aucun effet, aucun élément masqué */
  root.classList.add("lx-js");

  /* Entrée en scène : une seule fois par session */
  var seen = false;
  try { seen = sessionStorage.getItem("lx_intro") === "1"; sessionStorage.setItem("lx_intro", "1"); } catch (e) { /* ignore */ }
  if (!seen) {
    root.classList.add("lx-intro");
    setTimeout(function () { root.classList.remove("lx-intro"); }, 1800);
  }

  function make(tag, cls, html) {
    var e = document.createElement(tag);
    e.className = cls;
    if (html) e.innerHTML = html;
    return e;
  }
  function ready(fn) {
    if (document.body) fn(); else document.addEventListener("DOMContentLoaded", fn);
  }

  ready(function () {
    var body = document.body;

    /* ---------- Fond aurore + pause quand l'onglet est caché ---------- */
    body.insertBefore(make("div", "lx-aurora", "<i></i><i></i><i></i>"), body.firstChild);
    document.addEventListener("visibilitychange", function () { root.classList.toggle("lx-paused", document.hidden); });

    /* ---------- Barre de progression de lecture ---------- */
    var bar = make("div", "lx-progress");
    bar.setAttribute("aria-hidden", "true");
    body.appendChild(bar);
    if (!(window.CSS && CSS.supports && CSS.supports("animation-timeline", "scroll()"))) {
      var tick = false;
      var upd = function () {
        tick = false;
        var h = root.scrollHeight - innerHeight;
        bar.style.transform = "scaleX(" + (h > 0 ? Math.min(1, scrollY / h) : 0) + ")";
      };
      addEventListener("scroll", function () { if (!tick) { tick = true; requestAnimationFrame(upd); } }, { passive: true });
      upd();
    }

    /* ---------- Lumière qui suit le curseur ---------- */
    if (fine) {
      var glow = make("div", "lx-cursor");
      glow.setAttribute("aria-hidden", "true");
      body.appendChild(glow);
      var gx = 0, gy = 0, queued = false;
      addEventListener("pointermove", function (e) {
        gx = e.clientX; gy = e.clientY;
        if (!queued) {
          queued = true;
          requestAnimationFrame(function () { queued = false; glow.style.transform = "translate3d(" + gx + "px," + gy + "px,0)"; glow.classList.add("on"); });
        }
      }, { passive: true });
      document.addEventListener("pointerleave", function () { glow.classList.remove("on"); });
    }

    /* ---------- Apparition progressive des blocs ---------- */
    var SEL = ".hero .wrap > *, main > section, .wrap > section, section.panel, .card, .plan, .stat, .step, .feature, .hero-stat, .module";
    var candidates = [].slice.call(document.querySelectorAll(SEL)).filter(function (el) {
      if (el.closest("nav, .lx-nav, .lx-auth, table, [data-lx-reveal]")) return false; /* pas de doublon imbriqué */
      return true;
    });
    candidates.forEach(function (el) {
      var parent = el.parentElement && el.parentElement.closest("[data-lx-reveal]");
      if (!parent) el.setAttribute("data-lx-reveal", "");
    });
    /* Les enfants du bandeau d'en-tête arrivent en cascade */
    [].forEach.call(document.querySelectorAll(".hero .wrap"), function (wrap) {
      [].forEach.call(wrap.children, function (child, i) {
        if (child.hasAttribute("data-lx-reveal")) child.style.setProperty("--lx-d", 120 + i * 110 + "ms");
      });
    });
    var pending = [].slice.call(document.querySelectorAll("[data-lx-reveal]"));
    function show(el, delay) {
      if (delay != null && !el.style.getPropertyValue("--lx-d")) el.style.setProperty("--lx-d", delay + "ms");
      el.classList.add("lx-in");
      var done = function () { el.removeAttribute("data-lx-reveal"); el.classList.remove("lx-in"); el.style.removeProperty("--lx-d"); };
      el.addEventListener("animationend", function onEnd(ev) { if (ev.target === el) { el.removeEventListener("animationend", onEnd); done(); } });
      setTimeout(function () { if (el.hasAttribute("data-lx-reveal")) done(); }, 2500); /* filet de sécurité */
    }
    if ("IntersectionObserver" in window) {
      var io = new IntersectionObserver(function (entries) {
        var vis = entries.filter(function (e) { return e.isIntersecting; })
          .sort(function (a, b) { return a.boundingClientRect.top - b.boundingClientRect.top; });
        vis.forEach(function (e, i) { io.unobserve(e.target); show(e.target, Math.min(i * 70, 350)); });
      }, { threshold: 0.08, rootMargin: "0px 0px -6% 0px" });
      pending.forEach(function (el) { io.observe(el); });
    } else {
      pending.forEach(function (el) { show(el, 0); });
    }

    /* ---------- Inclinaison 3D des cartes d'abonnement ---------- */
    if (fine) {
      var tiltEls;
      try { tiltEls = document.querySelectorAll(".plan, .card:has(.metric)"); } catch (err) { tiltEls = document.querySelectorAll(".plan"); } /* :has() absent sur de vieux navigateurs */
      [].forEach.call(tiltEls, function (el) {
        el.addEventListener("pointermove", function (e) {
          if (el.hasAttribute("data-lx-reveal")) return;
          var r = el.getBoundingClientRect();
          var px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
          el.style.transition = "transform .1s linear, box-shadow .35s ease, border-color .35s ease";
          el.style.transform = "perspective(900px) rotateX(" + (-py * 5).toFixed(2) + "deg) rotateY(" + (px * 7).toFixed(2) + "deg) translateY(-3px)";
        });
        el.addEventListener("pointerleave", function () { el.style.transform = ""; el.style.transition = ""; });
      });
    }

    /* ---------- Capsule du bas : onde au toucher + petit retour haptique ---------- */
    [].forEach.call(document.querySelectorAll(".lx-item"), function (item) {
      item.addEventListener("pointerdown", function (e) {
        var r = item.getBoundingClientRect(), size = Math.max(r.width, r.height) * 1.6;
        var rip = make("span", "lx-ripple");
        rip.style.cssText = "width:" + size + "px;height:" + size + "px;left:" + (e.clientX - r.left - size / 2) + "px;top:" + (e.clientY - r.top - size / 2) + "px";
        item.appendChild(rip);
        setTimeout(function () { rip.remove(); }, 700);
        try { if (navigator.vibrate) navigator.vibrate(8); } catch (err) { /* ignore */ }
      });
    });
  });

  /* ---------- Bascule clair/nuit : cercle qui s'étend depuis le bouton soleil ---------- */
  window.lxThemeTransition = function (change, ev, btn) {
    if (!document.startViewTransition) {
      root.classList.add("lx-theming");
      change();
      setTimeout(function () { root.classList.remove("lx-theming"); }, 550);
      return;
    }
    var r = (btn || ev.currentTarget).getBoundingClientRect();
    var x = r.left + r.width / 2, y = r.top + r.height / 2;
    var end = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));
    root.classList.add("lx-theme-vt");
    var t = document.startViewTransition(change);
    t.ready.then(function () {
      root.animate(
        { clipPath: ["circle(0px at " + x + "px " + y + "px)", "circle(" + end + "px at " + x + "px " + y + "px)"] },
        { duration: 700, easing: "cubic-bezier(.2,.7,.2,1)", pseudoElement: "::view-transition-new(root)" }
      );
    }).catch(function () { /* transition annulée : le thème est déjà changé */ });
    t.finished.then(function () { root.classList.remove("lx-theme-vt"); }, function () { root.classList.remove("lx-theme-vt"); });
  };
})();
