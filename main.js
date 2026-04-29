(function () {
  "use strict";

  var RECIPE_PAGE = "recipe.html";

  /**
   * Préfixe vers la racine du site depuis une page recipes/slug/index.html
   * (vide si on est déjà à la racine : index.html, recipe.html).
   */
  function siteRootRelativePrefix() {
    var segs = window.location.pathname.split("/").filter(Boolean);
    if (segs.length && /index\.html?/i.test(segs[segs.length - 1])) {
      segs.pop();
    }
    var ri = segs.indexOf("recipes");
    if (ri < 0 || ri >= segs.length - 1) return "";
    return "../".repeat(segs.length);
  }

  /** recipes.json à la racine du site, même depuis /recipes/slug/. */
  function dataUrl() {
    var p = siteRootRelativePrefix();
    if (p) {
      return new URL(p + "recipes.json", window.location.href).href;
    }
    return new URL("recipes.json", window.location.href).href;
  }

  var state = {
    data: null,
    recipes: [],
    site: {},
    activeCategory: "all",
    searchQuery: "",
    /** Slugs issus de site.recipeCategoryTaxonomy (TheMealDB), si présent */
    recipeCategoryTaxonomyKeys: null,
    /** Slugs de catégories pour nav / filtres / spotlight (après refreshDerivedCategories_) */
    categoryKeys: [],
    /** 'all' + chaque slug (pour ?cat= et nav) */
    validCategorySet: null,
  };

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $$(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str;
    return div.innerHTML;
  }

  var TRENDING_SLIDER_MAX = 12;
  var HERO_CAROUSEL_MAX = 5;
  var HERO_AUTO_MS = 7000;

  var heroCarousel = {
    recipes: [],
    index: 0,
    timer: null,
    interactionPause: false,
    userPrefersReducedMotion: false,
  };

  /** Pour trier le carrousel : date de publication la plus récente d’abord. */
  function recipePublishTimeMs(recipe) {
    var raw = recipe.publishDate || recipe.datePublished || "";
    if (!raw) return 0;
    var s = String(raw).trim();
    if (!s) return 0;
    if (s.length === 10 && s.indexOf("T") === -1) {
      s = s + "T12:00:00";
    }
    try {
      var t = new Date(s).getTime();
      return isNaN(t) ? 0 : t;
    } catch (e) {
      return 0;
    }
  }

  function formatTrendCardDate(recipe) {
    var raw = recipe.datePublished || "";
    if (!raw && recipe.publishDate) {
      raw = String(recipe.publishDate).slice(0, 10);
    }
    if (!raw) return "";
    try {
      var s = String(raw).trim();
      var d = new Date(s.length === 10 ? s + "T12:00:00" : s);
      if (isNaN(d.getTime())) return "";
      return d.toLocaleDateString(undefined, {
        month: "short",
        day: "numeric",
        year: "numeric",
      });
    } catch (e) {
      return "";
    }
  }

  function youtubeVideoId(url) {
    if (!url || typeof url !== "string") return "";
    var u = url.trim();
    var m = u.match(
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/)([\w-]{11})/
    );
    return m ? m[1] : "";
  }

  /** Tags sous l’intro + vidéo (sans bloc métadonnées feuille). */
  function renderRecipeTagsAndVideo(recipe) {
    var tagSection = $("#recipe-tags-section");
    var tagList = $("#recipe-tag-list");
    if (tagList && tagSection) {
      var tags = recipe.tags || [];
      tagList.innerHTML = tags
        .map(function (t) {
          return "<li><span>" + escapeHtml(String(t)) + "</span></li>";
        })
        .join("");
      tagSection.hidden = !tags.length;
    }

    var ytWrap = $("#recipe-youtube-wrap");
    var ytInner = $("#recipe-youtube-inner");
    if (!ytWrap || !ytInner) return;

    var yid = youtubeVideoId(recipe.youtube || "");
    if (yid) {
      ytWrap.hidden = false;
      ytInner.innerHTML =
        '<iframe title="Recipe video" src="https://www.youtube.com/embed/' +
        escapeHtml(yid) +
        '" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture" allowfullscreen loading="lazy"></iframe>';
    } else if (recipe.youtube && String(recipe.youtube).trim()) {
      ytWrap.hidden = false;
      ytInner.innerHTML =
        '<a class="recipe-youtube__link" href="' +
        escapeHtml(recipe.youtube.trim()) +
        '" target="_blank" rel="noopener noreferrer">Watch on YouTube</a>';
    } else {
      ytWrap.hidden = true;
      ytInner.innerHTML = "";
    }
  }

  function recipeUrl(id) {
    var rid = String(id || "").trim();
    var recipe = state.recipes.find(function (r) {
      return r.id === rid;
    });
    if (!recipe) {
      recipe = state.recipes.find(function (r) {
        return String(r.slug || "") === rid;
      });
    }
    var slug = recipe && String(recipe.slug || recipe.id || "").trim();
    if (!slug) return RECIPE_PAGE + "?id=" + encodeURIComponent(rid);
    return siteRootRelativePrefix() + "recipes/" + encodeURIComponent(slug) + "/";
  }

  /** URL canonique absolue pour SEO / Open Graph (recipes/slug/). */
  function absoluteRecipePageUrl(recipe) {
    var slug = String(recipe.slug || recipe.id || "").trim();
    var path = "recipes/" + encodeURIComponent(slug) + "/";
    var co =
      state.site &&
      state.site.canonicalOrigin &&
      String(state.site.canonicalOrigin).replace(/\/+$/, "");
    if (co) return co + "/" + path;
    var base = getBaseUrl().replace(/\/+$/, "");
    return base + "/" + path;
  }

  /**
   * Détection par le DOM (fiable sur GitHub Pages : /repo/ sert index.html mais
   * l’URL ne se termine pas par index.html — l’ancienne logique pathname cassait l’accueil).
   */
  function isRecipePage() {
    return !!document.getElementById("recipe-main");
  }

  function isHomePage() {
    return !!document.getElementById("recipe-grid");
  }

  function getBaseUrl() {
    var p = siteRootRelativePrefix();
    if (p) {
      return new URL(p, window.location.href).href;
    }
    return new URL(".", window.location.href).href;
  }

  /** index.html depuis la page courante (racine ou recipes/slug/). */
  function homeIndexFileUrl() {
    return siteRootRelativePrefix() + "index.html";
  }

  /**
   * Slug stable depuis la colonne Category du sheet (TheMealDB) — même clé pour
   * filtres, ?cat=, JSON-LD et pages statiques (build-recipe-pages.mjs).
   */
  function slugifyCategoryKey(raw) {
    var s = String(raw || "")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, "-");
    s = s
      .replace(/[^a-z0-9-]/g, "")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, "");
    return s || "uncategorized";
  }

  function normalizeRecipeCategoryKey(raw) {
    return slugifyCategoryKey(raw);
  }

  function prettyCategoryDisplay(raw, normalizedKey) {
    var r = String(raw || "").trim();
    if (r) {
      return r.charAt(0).toUpperCase() + r.slice(1).toLowerCase();
    }
    return categoryLabel(normalizedKey);
  }

  function loadData() {
    return fetch(dataUrl())
      .then(function (res) {
        if (!res.ok) throw new Error("Failed to load recipes");
        return res.json();
      })
      .then(function (data) {
        var recipes;
        var site;
        if (Array.isArray(data)) {
          recipes = data;
          site = {};
        } else {
          site = data.site || {};
          recipes = data.recipes || [];
        }
        state.data = Array.isArray(data) ? { site: site, recipes: recipes } : data;
        state.site = site;
        state.recipeCategoryTaxonomyKeys = null;
        if (
          site &&
          Array.isArray(site.recipeCategoryTaxonomy) &&
          site.recipeCategoryTaxonomy.length
        ) {
          state.recipeCategoryTaxonomyKeys = site.recipeCategoryTaxonomy.map(function (t) {
            return slugifyCategoryKey(t);
          });
        }
        state.recipes = recipes.map(function (r) {
          var rawCat = r.category || "";
          var key = normalizeRecipeCategoryKey(rawCat);
          r.categoryDisplay = prettyCategoryDisplay(rawCat, key);
          r.category = key;
          if (!r.datePublished && r.publishDate) {
            r.datePublished = String(r.publishDate).slice(0, 10);
          }
          if (!r.mealId && r.id && /^\d+$/.test(String(r.id).trim())) {
            r.mealId = String(r.id).trim();
          }
          return r;
        });
        return state.data;
      });
  }

  function initTheme() {
    var stored = localStorage.getItem("theme");
    var prefersDark =
      window.matchMedia &&
      window.matchMedia("(prefers-color-scheme: dark)").matches;
    var theme = stored || (prefersDark ? "dark" : "light");
    document.documentElement.setAttribute("data-theme", theme);
    updateThemeToggle(theme);
  }

  function updateThemeToggle(theme) {
    var btn = $("#theme-toggle");
    if (!btn) return;
    var isDark = theme === "dark";
    btn.setAttribute("aria-label", isDark ? "Switch to light mode" : "Switch to dark mode");
    btn.setAttribute("title", isDark ? "Light mode" : "Dark mode");
    var moon = btn.querySelector("[data-icon='moon']");
    var sun = btn.querySelector("[data-icon='sun']");
    if (moon) moon.hidden = isDark;
    if (sun) sun.hidden = !isDark;
  }

  function toggleTheme() {
    var next =
      document.documentElement.getAttribute("data-theme") === "dark"
        ? "light"
        : "dark";
    document.documentElement.setAttribute("data-theme", next);
    localStorage.setItem("theme", next);
    updateThemeToggle(next);
  }

  function initMobileNav() {
    var header = $(".site-header");
    var toggle = $("#nav-menu-toggle");
    var panel = $("#nav-panel");
    if (!toggle || !panel || !header) return;

    function isDesktop() {
      return window.matchMedia("(min-width: 960px)").matches;
    }

    function syncPanelAria() {
      if (isDesktop()) {
        panel.setAttribute("aria-hidden", "false");
        toggle.setAttribute("aria-expanded", "false");
        header.classList.remove("site-header--menu-open");
      } else {
        var open = header.classList.contains("site-header--menu-open");
        panel.setAttribute("aria-hidden", open ? "false" : "true");
        toggle.setAttribute("aria-expanded", open ? "true" : "false");
      }
    }

    function setOpen(open) {
      header.classList.toggle("site-header--menu-open", open);
      syncPanelAria();
    }

    syncPanelAria();

    toggle.addEventListener("click", function () {
      if (isDesktop()) return;
      var open = !header.classList.contains("site-header--menu-open");
      setOpen(open);
    });

    $$(".nav__link", panel).forEach(function (link) {
      link.addEventListener("click", function () {
        if (!isDesktop()) setOpen(false);
      });
    });

    window.addEventListener("resize", function () {
      if (isDesktop()) {
        header.classList.remove("site-header--menu-open");
      }
      syncPanelAria();
    });
  }

  function initBackToTop() {
    var btn = $("#back-to-top");
    if (!btn) return;

    function onScroll() {
      var y = window.scrollY || document.documentElement.scrollTop;
      btn.classList.toggle("is-visible", y > 400);
    }

    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    btn.addEventListener("click", function () {
      window.scrollTo({ top: 0, behavior: "smooth" });
    });
  }

  function initScrollFadeIn() {
    var nodes = $$(".io-fade");
    if (!nodes.length || !("IntersectionObserver" in window)) {
      nodes.forEach(function (el) {
        el.classList.add("is-visible");
      });
      return;
    }

    var io = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add("is-visible");
            io.unobserve(entry.target);
          }
        });
      },
      { rootMargin: "0px 0px -40px 0px", threshold: 0.08 }
    );

    nodes.forEach(function (el) {
      io.observe(el);
    });
  }

  function initPwaInstall() {
    var deferredPrompt = null;
    var banner = null;
    var installBtn = null;
    var closeBtn = null;
    var DISMISS_KEY = "pwaInstallDismissedAt";
    var DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

    function canShowBanner() {
      if (window.matchMedia && !window.matchMedia("(display-mode: browser)").matches) {
        return false;
      }
      if (window.navigator.standalone) return false;
      var dismissedAt = Number(localStorage.getItem(DISMISS_KEY) || 0);
      if (!dismissedAt) return true;
      return Date.now() - dismissedAt > DISMISS_TTL_MS;
    }

    function ensureBanner() {
      if (banner) return;
      banner = document.createElement("aside");
      banner.className = "pwa-install-banner";
      banner.setAttribute("role", "dialog");
      banner.setAttribute("aria-live", "polite");
      banner.setAttribute("aria-label", "Install app");
      banner.hidden = true;
      banner.setAttribute("aria-hidden", "true");
      banner.innerHTML =
        '<p class="pwa-install-banner__text">Install Akkous for faster access and offline support.</p>' +
        '<div class="pwa-install-banner__actions">' +
        '<button type="button" class="pwa-install-banner__btn pwa-install-banner__btn--primary" id="pwa-install-action">Install</button>' +
        '<button type="button" class="pwa-install-banner__btn" id="pwa-install-close">Later</button>' +
        "</div>";
      document.body.appendChild(banner);
      installBtn = banner.querySelector("#pwa-install-action");
      closeBtn = banner.querySelector("#pwa-install-close");
      closeBtn.addEventListener("click", function () {
        banner.hidden = true;
        banner.setAttribute("aria-hidden", "true");
        localStorage.setItem(DISMISS_KEY, String(Date.now()));
      });
      installBtn.addEventListener("click", function () {
        if (!deferredPrompt) return;
        banner.hidden = true;
        banner.setAttribute("aria-hidden", "true");
        var promptEvent = deferredPrompt;
        deferredPrompt = null;
        promptEvent.prompt();
        promptEvent.userChoice.finally(function () {});
      });
    }

    window.addEventListener("beforeinstallprompt", function (e) {
      e.preventDefault();
      deferredPrompt = e;
      if (!canShowBanner()) return;
      ensureBanner();
      banner.hidden = false;
      banner.setAttribute("aria-hidden", "false");
    });

    window.addEventListener("appinstalled", function () {
      if (banner) {
        banner.hidden = true;
        banner.setAttribute("aria-hidden", "true");
      }
      localStorage.removeItem(DISMISS_KEY);
    });
  }

  function registerServiceWorker() {
    if (!("serviceWorker" in navigator)) return;
    var p = siteRootRelativePrefix();
    var swUrl = new URL((p || "./") + "sw.js", window.location.href).href;
    var scopeUrl = new URL(p || "./", window.location.href);
    navigator.serviceWorker.register(swUrl, { scope: scopeUrl.pathname }).catch(function (err) {
      console.warn("Service worker registration failed:", err);
    });
  }

  function applyBranding() {
    var name = state.site.name || "Akkous";
    $$("[data-site-name]").forEach(function (el) {
      el.textContent = name;
    });
    if (isHomePage()) {
      document.title = name + " — From your kitchen to the world";
    }

    var nh = $("#newsletter-heading");
    if (nh && state.site.newsletterHeading)
      nh.textContent = state.site.newsletterHeading;
    var ns = $("#newsletter-subtext");
    if (ns && state.site.newsletterSubtext)
      ns.textContent = state.site.newsletterSubtext;
  }

  function sortRecipesByPublishDateDesc(recipes) {
    return recipes.slice().sort(function (a, b) {
      var tb = recipePublishTimeMs(b);
      var ta = recipePublishTimeMs(a);
      if (tb !== ta) return tb - ta;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
  }

  function getHeroCarouselRecipes() {
    var max = HERO_CAROUSEL_MAX;
    if (!state.recipes.length) return [];
    var sorted = sortRecipesByPublishDateDesc(state.recipes);
    return sorted.slice(0, max);
  }

  function heroRecipeMetaLine(recipe) {
    var parts = [];
    if (recipe.author && recipe.author.name) {
      parts.push("By " + recipe.author.name);
    } else if (recipe.origin && String(recipe.origin).trim()) {
      parts.push("By " + String(recipe.origin).trim());
    }
    var time = recipe.cookTime || recipe.totalTime || "";
    if (time) parts.push(time);
    return parts.join(" · ");
  }

  function renderHeroEmptyState() {
    var img = $("#hero-image");
    var cta = $("#hero-cta");
    var cta2 = $("#hero-cta-secondary");
    var dek = $("#hero-dek");
    var tagEl = $("#hero-tag");
    if (img) {
      img.removeAttribute("src");
      img.alt = "";
      img.classList.remove("is-hero-dim");
    }
    if (tagEl) tagEl.textContent = "Featured";
    if (dek) {
      dek.textContent =
        "Publish recipes in your sheet to populate the homepage carousel and latest sections.";
    }
    $("#hero-title").textContent = "No recipes yet";
    $("#hero-meta").textContent =
      "recipes.json is empty or could not be read. Check the file and try again.";
    if (cta) {
      cta.href = "index.html";
      cta.textContent = "Reload";
      cta.hidden = false;
    }
    if (cta2) {
      cta2.hidden = true;
    }
    var dots = $("#hero-dots");
    var controls = $("#hero-carousel-controls");
    if (dots) {
      dots.hidden = true;
      dots.innerHTML = "";
    }
    if (controls) controls.hidden = true;
  }

  function paintHeroSlide(recipe, animate) {
    var img = $("#hero-image");
    var cta = $("#hero-cta");
    var cta2 = $("#hero-cta-secondary");
    var tagEl = $("#hero-tag");
    var dek = $("#hero-dek");
    if (!recipe) return;
    if (animate && heroCarousel.userPrefersReducedMotion) {
      animate = false;
    }

    function applyTextAndLink() {
      $("#hero-title").textContent = recipe.title || "";
      $("#hero-meta").textContent = heroRecipeMetaLine(recipe);
      if (dek) {
        var d = String(recipe.description || "").trim();
        if (!d) {
          d =
            "Cook " +
            (recipe.title || "this recipe") +
            " with clear ingredients and practical step-by-step guidance.";
        }
        dek.textContent = d.length > 170 ? d.slice(0, 167) + "..." : d;
      }
      if (tagEl) {
        tagEl.textContent = recipe.featured ? "Featured" : "Latest";
      }
      if (cta) {
        cta.hidden = false;
        cta.textContent = "Read Recipe";
        cta.href = recipeUrl(recipe.id);
      }
      if (cta2) {
        cta2.hidden = false;
      }
    }

    function setImgSrc() {
      if (!img) return;
      var src = recipe.image || "";
      if (src) {
        img.src = src;
        img.alt = recipe.title ? "Hero image for " + recipe.title : "";
      } else {
        img.removeAttribute("src");
        img.alt = "";
      }
    }

    if (!img || !animate) {
      setImgSrc();
      applyTextAndLink();
      return;
    }

    img.classList.add("is-hero-dim");
    window.setTimeout(function () {
      setImgSrc();
      applyTextAndLink();
      window.setTimeout(function () {
        img.classList.remove("is-hero-dim");
      }, 40);
    }, 220);
  }

  function clearHeroCarouselTimer() {
    if (heroCarousel.timer) {
      clearInterval(heroCarousel.timer);
      heroCarousel.timer = null;
    }
  }

  function scheduleHeroCarouselTimer() {
    clearHeroCarouselTimer();
    if (heroCarousel.recipes.length <= 1) return;
    if (heroCarousel.userPrefersReducedMotion) return;
    heroCarousel.timer = setInterval(function () {
      if (document.hidden || heroCarousel.interactionPause) return;
      advanceHeroCarousel(1);
    }, HERO_AUTO_MS);
  }

  function renderHeroDots() {
    var dots = $("#hero-dots");
    var controls = $("#hero-carousel-controls");
    if (!dots || !controls) return;
    var n = heroCarousel.recipes.length;
    if (n <= 1) {
      dots.hidden = true;
      controls.hidden = true;
      dots.innerHTML = "";
      return;
    }
    dots.hidden = false;
    controls.hidden = false;
    dots.innerHTML = heroCarousel.recipes
      .map(function (_r, i) {
        return (
          '<button type="button" class="hero__dot" aria-label="Slide ' +
          (i + 1) +
          " of " +
          n +
          '"' +
          (i === heroCarousel.index ? ' aria-current="true"' : "") +
          ' data-hero-dot="' +
          i +
          '"></button>'
        );
      })
      .join("");
    dots.querySelectorAll(".hero__dot").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var idx = parseInt(btn.getAttribute("data-hero-dot"), 10);
        if (!isNaN(idx)) goHeroCarouselIndex(idx);
      });
    });
  }

  function goHeroCarouselIndex(i) {
    var n = heroCarousel.recipes.length;
    if (!n) return;
    heroCarousel.index = ((i % n) + n) % n;
    paintHeroSlide(heroCarousel.recipes[heroCarousel.index], true);
    renderHeroDots();
    scheduleHeroCarouselTimer();
  }

  function advanceHeroCarousel(delta) {
    goHeroCarouselIndex(heroCarousel.index + delta);
  }

  function initHeroCarousel() {
    heroCarousel.userPrefersReducedMotion =
      window.matchMedia &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var recs = getHeroCarouselRecipes();
    heroCarousel.recipes = recs;
    heroCarousel.index = 0;
    heroCarousel.interactionPause = false;
    clearHeroCarouselTimer();

    var root = $("#hero-section");
    var prev = $("#hero-prev");
    var next = $("#hero-next");

    if (!recs.length) {
      renderHeroEmptyState();
      return;
    }

    paintHeroSlide(recs[0], false);
    renderHeroDots();
    scheduleHeroCarouselTimer();

    if (prev) {
      prev.addEventListener("click", function () {
        advanceHeroCarousel(-1);
      });
    }
    if (next) {
      next.addEventListener("click", function () {
        advanceHeroCarousel(1);
      });
    }

    if (root) {
      root.addEventListener("mouseenter", function () {
        heroCarousel.interactionPause = true;
      });
      root.addEventListener("mouseleave", function () {
        heroCarousel.interactionPause = false;
      });
      root.addEventListener("focusin", function () {
        heroCarousel.interactionPause = true;
      });
      root.addEventListener("focusout", function (e) {
        if (!root.contains(e.relatedTarget)) {
          heroCarousel.interactionPause = false;
        }
      });
    }

    if (window.matchMedia) {
      var mq = window.matchMedia("(prefers-reduced-motion: reduce)");
      var onMotion = function () {
        heroCarousel.userPrefersReducedMotion = mq.matches;
        if (mq.matches) clearHeroCarouselTimer();
        else scheduleHeroCarouselTimer();
      };
      if (mq.addEventListener) mq.addEventListener("change", onMotion);
      else if (mq.addListener) mq.addListener(onMotion);
    }
  }

  function renderTrending() {
    var track = $("#trending-track");
    if (!track) return;

    if (!state.recipes.length) {
      track.innerHTML = "";
      return;
    }

    var sorted = sortRecipesByPublishDateDesc(state.recipes);
    var latest = sorted.slice(0, TRENDING_SLIDER_MAX);

    track.innerHTML = latest
      .map(function (r) {
        var tag =
          r.categoryDisplay ||
          (r.tags && r.tags[0]) ||
          categoryLabel(r.category) ||
          "Recipe";
        var imgSrc = r.imageCard || r.image || "";
        var whenLabel =
          formatTrendCardDate(r) || r.cookTime || r.totalTime || "";
        return (
          '<article class="trend-card io-fade" role="listitem">' +
          '<a class="trend-card__link" href="' +
          escapeHtml(recipeUrl(r.id)) +
          '">' +
          '<div class="trend-card__img">' +
          '<img src="' +
          escapeHtml(imgSrc) +
          '" alt="' +
          escapeHtml((r.title || "Recipe") + " photo") +
          '" loading="lazy" width="400" height="300">' +
          "</div>" +
          '<div class="trend-card__body">' +
          "<h3 class=\"trend-card__title\">" +
          escapeHtml(r.title || "") +
          "</h3>" +
          '<div class="trend-card__meta">' +
          "<span>" +
          escapeHtml(whenLabel) +
          "</span>" +
          '<span class="trend-card__tag">' +
          escapeHtml(tag) +
          "</span>" +
          "</div>" +
          "</div>" +
          "</a>" +
          "</article>"
        );
      })
      .join("");
  }

  function initTrendingSlider() {
    var track = $("#trending-track");
    var prev = $("#trending-prev");
    var next = $("#trending-next");
    if (!track) return;

    function scrollAmount() {
      return Math.min(Math.max(260, track.clientWidth * 0.75), 520);
    }

    if (prev) {
      prev.addEventListener("click", function () {
        track.scrollBy({ left: -scrollAmount(), behavior: "smooth" });
      });
    }
    if (next) {
      next.addEventListener("click", function () {
        track.scrollBy({ left: scrollAmount(), behavior: "smooth" });
      });
    }
  }

  function categoryLabel(key) {
    if (!key || key === "all") return "All";
    var map = {
      uncategorized: "Uncategorized",
    };
    if (map[key]) return map[key];
    return key
      .split("-")
      .filter(Boolean)
      .map(function (w) {
        return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
      })
      .join(" ");
  }

  function refreshDerivedCategories_() {
    var fromRecipes = [];
    var seen = {};
    state.recipes.forEach(function (r) {
      var k = r.category;
      if (!k || seen[k]) return;
      seen[k] = true;
      fromRecipes.push(k);
    });

    var tax = state.recipeCategoryTaxonomyKeys;
    if (tax && tax.length) {
      var ordered = [];
      var used = {};
      tax.forEach(function (k) {
        if (!k || used[k]) return;
        used[k] = true;
        ordered.push(k);
      });
      fromRecipes.forEach(function (k) {
        if (!used[k]) {
          used[k] = true;
          ordered.push(k);
        }
      });
      state.categoryKeys = ordered;
    } else {
      state.categoryKeys = fromRecipes.slice().sort(function (a, b) {
        return categoryLabel(a).localeCompare(categoryLabel(b));
      });
    }
    state.validCategorySet = new Set(state.categoryKeys);
    state.validCategorySet.add("all");
  }

  function categoryRowMeta(key) {
    var sample = state.recipes.find(function (r) {
      return r.category === key;
    });
    var label =
      (sample && sample.categoryDisplay) || categoryLabel(key);
    var count = state.recipes.filter(function (r) {
      return r.category === key;
    }).length;
    return { key: key, label: label, count: count };
  }

  var SPOTLIGHT_BLURB = {
    chicken: "From quick sautés to slow roasts",
    beef: "Steaks, stews, and bold flavors",
    seafood: "Fish, shellfish, and coastal dishes",
    pasta: "Noodles, sauces, and baked classics",
    vegetarian: "Plant-forward plates full of flavor",
    vegan: "Fully plant-based favorites",
    goat: "Rich curries and tender cuts",
    pork: "Roasts, chops, and weekday meals",
    lamb: "Roasts, chops, and aromatic dishes",
    side: "Sides that complete the meal",
    dessert: "Sweet endings for any occasion",
    desserts: "Sweet endings for any occasion",
    breakfast: "Morning favorites",
    miscellaneous: "More ideas to explore",
    starter: "Small plates to open the meal",
  };

  function spotlightBlurb(key, label, count) {
    if (SPOTLIGHT_BLURB[key]) return SPOTLIGHT_BLURB[key];
    var n = count || 0;
    return (
      n +
      (n === 1 ? " recipe" : " recipes") +
      " — explore " +
      label
    );
  }

  function renderCategorySpotlight() {
    var grid = $("#category-spotlight-grid");
    if (!grid) return;
    if (!state.categoryKeys.length) {
      grid.innerHTML =
        '<p class="empty-state" role="status">No categories yet. Publish recipes or sync TheMealDB taxonomy in Apps Script.</p>';
      return;
    }
    grid.innerHTML = state.categoryKeys
      .map(function (key) {
        var meta = categoryRowMeta(key);
        var href =
          homeIndexFileUrl() +
          "?cat=" +
          encodeURIComponent(meta.key) +
          "#recipe-grid";
        var desc = spotlightBlurb(meta.key, meta.label, meta.count);
        return (
          '<a class="category-spotlight__card" role="listitem" href="' +
          escapeHtml(href) +
          '">' +
          "<strong>" +
          escapeHtml(meta.label) +
          "</strong><span>" +
          escapeHtml(desc) +
          "</span></a>"
        );
      })
      .join("");
  }

  function renderFilterPills() {
    var inner = $("#category-filter-pills");
    if (!inner) return;
    var pills = [
      '<button type="button" class="filter-pill" data-category="all" aria-pressed="true">All</button>',
    ];
    state.categoryKeys.forEach(function (key) {
      var meta = categoryRowMeta(key);
      pills.push(
        '<button type="button" class="filter-pill" data-category="' +
        escapeHtml(meta.key) +
        '" aria-pressed="false">' +
        escapeHtml(meta.label) +
        "</button>"
      );
    });
    inner.innerHTML = pills.join("");
  }

  function renderNavCategoryLinks() {
    var wrap = $("#nav-category-links");
    if (!wrap) return;
    var home = homeIndexFileUrl();
    var parts = [
      '<a class="nav__link" href="' +
        escapeHtml(home + "#recipe-grid") +
        '" data-nav-cat="all">All</a>',
    ];
    state.categoryKeys.forEach(function (key) {
      var meta = categoryRowMeta(key);
      parts.push(
        '<a class="nav__link" href="' +
        escapeHtml(
          home + "?cat=" + encodeURIComponent(meta.key) + "#recipe-grid"
        ) +
        '" data-nav-cat="' +
        escapeHtml(meta.key) +
        '">' +
        escapeHtml(meta.label) +
        "</a>"
      );
    });
    wrap.innerHTML = parts.join("");
  }

  function initGlobalCategoryNav_() {
    renderNavCategoryLinks();
    initNavCategoryLinks();
  }

  function matchesFilters(recipe) {
    if (state.activeCategory !== "all") {
      if (recipe.category !== state.activeCategory) return false;
    }
    if (state.searchQuery) {
      var q = state.searchQuery;
      var blob =
        (recipe.title || "") +
        " " +
        (recipe.description || "") +
        " " +
        (recipe.tags || []).join(" ") +
        " " +
        ((recipe.author && recipe.author.name) || "") +
        " " +
        (recipe.origin || "") +
        " " +
        (recipe.slug || "");
      if (blob.toLowerCase().indexOf(q) === -1) return false;
    }
    return true;
  }

  function updateGridHeading() {
    var heading = $("#grid-heading");
    if (!heading) return;
    if (state.activeCategory === "all") {
      heading.textContent = "All Recipes";
    } else {
      var meta = categoryRowMeta(state.activeCategory);
      heading.textContent = (meta.label || categoryLabel(state.activeCategory)) + " Recipes";
    }
  }

  function renderGrid() {
    var grid = $("#recipe-grid");
    if (!grid) return;

    updateGridHeading();

    var list = sortRecipesByPublishDateDesc(state.recipes.filter(matchesFilters));

    if (!list.length) {
      var msg =
        state.recipes.length === 0
          ? "No recipes in recipes.json yet. Publish from your sheet and push the updated file."
          : "No recipes match your filters.";
      grid.innerHTML = '<p class="empty-state" role="status">' + msg + "</p>";
      return;
    }

    grid.innerHTML = list
      .map(function (r) {
        var imgSrc = r.imageCard || r.image || "";
        var avatar =
          (r.author && r.author.avatar) ||
          "https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=96&h=96&fit=crop&q=80";
        return (
          '<article class="recipe-card">' +
          '<a class="recipe-card__link" href="' +
          escapeHtml(recipeUrl(r.id)) +
          '">' +
          '<div class="recipe-card__img">' +
          '<span class="recipe-card__badge">' +
          escapeHtml(r.difficulty || "") +
          "</span>" +
          '<img src="' +
          escapeHtml(imgSrc) +
          '" alt="' +
          escapeHtml((r.title || "Recipe") + " photo") +
          '" loading="lazy" width="600" height="750">' +
          "</div>" +
          '<div class="recipe-card__body">' +
          "<h3 class=\"recipe-card__title\">" +
          escapeHtml(r.title || "") +
          "</h3>" +
          '<p class="recipe-card__category">' +
          escapeHtml(r.categoryDisplay || categoryLabel(r.category)) +
          "</p>" +
          '<div class="recipe-card__author">' +
          '<img src="' +
          escapeHtml(avatar) +
          '" alt="' +
          escapeHtml(
            ((r.author && r.author.name) || "Recipe author") + " avatar"
          ) +
          '" loading="lazy" width="32" height="32">' +
          "<span>" +
          escapeHtml((r.author && r.author.name) || "") +
          "</span>" +
          "</div>" +
          (r.origin
            ? '<p class="recipe-card__origin">' +
              escapeHtml(r.origin) +
              "</p>"
            : "") +
          '<p class="recipe-card__time">' +
          escapeHtml(r.cookTime || r.totalTime || "") +
          "</p>" +
          '<div class="recipe-card__footer">' +
          '<span class="recipe-card__cta">View recipe</span>' +
          "</div>" +
          "</div>" +
          "</a>" +
          "</article>"
        );
      })
      .join("");
  }

  function setFilter(category) {
    state.activeCategory = category;
    $$(".filter-pill").forEach(function (btn) {
      var cat = btn.getAttribute("data-category") || "all";
      btn.setAttribute("aria-pressed", cat === category ? "true" : "false");
    });
    renderGrid();
    initScrollFadeIn();
  }

  function initFilters() {
    $$(".filter-pill").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var cat = btn.getAttribute("data-category") || "all";
        setFilter(cat);
      });
    });
  }

  function initSearch() {
    var input = $("#site-search");
    if (!input) return;

    function apply() {
      state.searchQuery = (input.value || "").trim().toLowerCase();
      renderGrid();
      initScrollFadeIn();
      if (isHomePage() && typeof history !== "undefined" && history.replaceState) {
        var u = new URL(window.location.href);
        if (state.searchQuery) u.searchParams.set("q", (input.value || "").trim());
        else u.searchParams.delete("q");
        history.replaceState({}, "", u.pathname + u.search + u.hash);
      }
    }

    input.addEventListener("input", apply);
    input.addEventListener("search", apply);
  }

  function initSearchQueryFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var q = params.get("q");
    if (!q) return;
    var input = $("#site-search");
    if (input) input.value = q;
    state.searchQuery = q.trim().toLowerCase();
  }

  function initRecipePageSearchRedirect() {
    if (!isRecipePage()) return;
    var input = $("#site-search");
    if (!input) return;
    input.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      e.preventDefault();
      var raw = (input.value || "").trim();
      var href =
        siteRootRelativePrefix() +
        "index.html" +
        (raw ? "?q=" + encodeURIComponent(raw) : "") +
        "#recipe-grid";
      window.location.href = href;
    });
  }

  function initNewsletter() {
    var form = $("#newsletter-form");
    if (!form) return;
    var status = $("#newsletter-status");
    var iframe = $("#newsletter-iframe");

    function newsletterEndpoint() {
      var fromAttr = (form.getAttribute("data-newsletter-endpoint") || "").trim();
      if (fromAttr) return fromAttr;
      if (state.site && state.site.newsletterWebAppUrl) {
        return String(state.site.newsletterWebAppUrl).trim();
      }
      return "";
    }

    form.addEventListener("submit", function (e) {
      var input = $("#newsletter-email");
      var email = input && input.value ? String(input.value).trim() : "";
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        e.preventDefault();
        if (status) {
          status.textContent = "Please enter a valid email address.";
          status.setAttribute("role", "alert");
        }
        return;
      }

      var endpoint = newsletterEndpoint();
      if (!endpoint) {
        e.preventDefault();
        if (status) {
          status.textContent =
            "Thanks! (Configure the newsletter: Google Sheet menu ⑪–⑫, then push recipes.json or set data-newsletter-endpoint on the form.)";
          status.setAttribute("role", "status");
        }
        form.reset();
        return;
      }

      form.setAttribute("method", "post");
      form.setAttribute("action", endpoint);
      form.setAttribute("target", "newsletter-iframe");
      if (status) {
        status.textContent = "Sending…";
        status.setAttribute("role", "status");
      }

      var finished = false;
      function done(ok) {
        if (finished) return;
        finished = true;
        if (status) {
          status.textContent = ok
            ? "Thanks — you're on the list."
            : "Could not subscribe. Try again later.";
          status.setAttribute("role", ok ? "status" : "alert");
        }
        form.reset();
        if (iframe) iframe.onload = null;
      }

      var timeoutId = setTimeout(function () {
        done(false);
      }, 25000);

      if (iframe) {
        iframe.onload = function () {
          clearTimeout(timeoutId);
          done(true);
        };
      } else {
        clearTimeout(timeoutId);
        e.preventDefault();
        done(false);
      }
    });
  }

  function findRecipeById(rawId) {
    if (rawId == null || rawId === "") return null;
    var id = String(rawId).trim();
    try {
      id = decodeURIComponent(id);
    } catch (e) {}
    id = id.trim();
    return (
      state.recipes.find(function (r) {
        if (r.id === id) return true;
        if (r.slug != null && String(r.slug) === id) return true;
        if (r.mealId != null && String(r.mealId) === id) return true;
        return false;
      }) || null
    );
  }

  function minutesFromTimeLabel(label) {
    if (!label || typeof label !== "string") return undefined;
    var m = label.match(/(\d+)\s*min/i);
    if (m) return parseInt(m[1], 10);
    return undefined;
  }

  function injectJsonLd(json) {
    var existing = $("#recipe-jsonld");
    if (existing) existing.remove();
    var script = document.createElement("script");
    script.type = "application/ld+json";
    script.id = "recipe-jsonld";
    script.textContent = JSON.stringify(json);
    document.head.appendChild(script);
  }

  function setMeta(name, content, isProperty) {
    if (content == null || content === "") return;
    var attr = isProperty ? "property" : "name";
    var sel = "meta[" + attr + '="' + name + '"]';
    var el = $(sel);
    if (!el) {
      el = document.createElement("meta");
      el.setAttribute(attr, name);
      document.head.appendChild(el);
    }
    el.setAttribute("content", content);
  }

  function metaDescriptionFromRecipe(recipe) {
    var h = recipe.hook && String(recipe.hook).trim();
    if (h) {
      return h.length > 158 ? h.slice(0, 155) + "…" : h;
    }
    var d = recipe.description && String(recipe.description).trim();
    if (d && !d.includes("recipe with") && !d.includes("ingredients and")) {
      return d.length > 158 ? d.slice(0, 155) + "…" : d;
    }
    var bits = [];
    if (recipe.title) bits.push(recipe.title);
    var cat = recipe.categoryDisplay || categoryLabel(recipe.category);
    if (cat) bits.push(cat);
    if (recipe.origin) bits.push(String(recipe.origin) + " recipe");
    var out =
      bits.join(" · ") +
      ". Ingredients, steps, and tips — easy recipe on " +
      (state.site.name || "Akkous") +
      ".";
    return out.length > 158 ? out.slice(0, 155) + "…" : out;
  }

  function updateRecipeMeta(recipe) {
    var url = absoluteRecipePageUrl(recipe);
    var title = recipe.title + " — " + (state.site.name || "Recipes");
    document.title = title;

    var desc = metaDescriptionFromRecipe(recipe);
    setMeta("description", desc);
    setMeta("og:title", title, true);
    setMeta("og:description", desc, true);
    setMeta("og:type", "article", true);
    setMeta("og:url", url, true);
    if (recipe.image) setMeta("og:image", recipe.image, true);
    setMeta("twitter:card", "summary_large_image", true);
    setMeta("twitter:title", title, true);
    setMeta("twitter:description", desc, true);
    if (recipe.image) setMeta("twitter:image", recipe.image, true);

    var canonical = $("#canonical-url");
    if (canonical) canonical.setAttribute("href", url);
  }

  function buildRecipeInstructionsSchema(recipe) {
    var steps = recipe.steps;
    if (!steps || !steps.length) {
      var instr = recipe.instructions;
      if (typeof instr === "string" && instr.trim()) {
        steps = instr
          .split(/\n+/)
          .map(function (s) {
            return s.trim();
          })
          .filter(Boolean);
      }
    }
    return (steps || []).map(function (text, i) {
      return {
        "@type": "HowToStep",
        position: i + 1,
        text: text,
      };
    });
  }

  /** JSON-LD : ne pas confondre cuisine (origin) et auteur (aligné build-recipe-pages.mjs + export Sheet). */
  function schemaAuthorName(recipe) {
    var site = state.site.name || "Akkous";
    var raw = recipe.author && recipe.author.name;
    if (!raw || !String(raw).trim()) return site;
    var name = String(raw).trim();
    var origin = recipe.origin && String(recipe.origin).trim();
    if (origin && origin.toLowerCase() === name.toLowerCase()) return site;
    return name;
  }

  function buildRecipeSchemaNode(recipe) {
    var base = getBaseUrl().replace(/\/+$/, "");
    var url = absoluteRecipePageUrl(recipe);
    var cookMin = minutesFromTimeLabel(recipe.cookTime);
    var prepMin = minutesFromTimeLabel(recipe.prepTime);
    var desc =
      (recipe.description && String(recipe.description).trim()) ||
      metaDescriptionFromRecipe(recipe);

    var canon =
      state.site &&
      state.site.canonicalOrigin &&
      String(state.site.canonicalOrigin).trim();
    var orgGraphId = canon
      ? String(canon).replace(/\/+$/, "") + "/#organization"
      : "";
    var publisher = orgGraphId
      ? { "@id": orgGraphId }
      : {
          "@type": "Organization",
          name: state.site.name || "Akkous",
          url: base || undefined,
        };

    var obj = {
      "@type": "Recipe",
      "@id": url + "#recipe",
      name: recipe.title,
      description: desc,
      inLanguage: "en",
      image: recipe.image ? [recipe.image] : undefined,
      author: {
        "@type": "Person",
        name: schemaAuthorName(recipe),
      },
      publisher: publisher,
      datePublished:
        (recipe.datePublished && String(recipe.datePublished).slice(0, 10)) ||
        (recipe.publishDate && String(recipe.publishDate).slice(0, 10)) ||
        "2026-01-01",
      recipeCategory:
        recipe.categoryDisplay || categoryLabel(recipe.category),
      keywords: (recipe.tags || []).length
        ? (recipe.tags || []).join(", ")
        : undefined,
      recipeIngredient: recipe.ingredients || [],
      recipeInstructions: buildRecipeInstructionsSchema(recipe),
      mainEntityOfPage: {
        "@type": "WebPage",
        "@id": url,
      },
    };

    if (recipe.servings != null && String(recipe.servings).trim() !== "") {
      obj.recipeYield = String(recipe.servings) + " servings";
    }
    if (recipe.origin && String(recipe.origin).trim()) {
      obj.recipeCuisine = String(recipe.origin).trim();
    }
    if (cookMin) obj.cookTime = "PT" + cookMin + "M";
    if (prepMin) obj.prepTime = "PT" + prepMin + "M";
    if (cookMin && prepMin) {
      obj.totalTime = "PT" + (cookMin + prepMin) + "M";
    }

    var yid = youtubeVideoId(recipe.youtube || "");
    if (yid) {
      obj.video = {
        "@type": "VideoObject",
        name: recipe.title || "Recipe video",
        description: desc,
        thumbnailUrl: recipe.image || undefined,
        embedUrl: "https://www.youtube.com/embed/" + yid,
        contentUrl: String(recipe.youtube || "").trim() || undefined,
      };
    }

    return obj;
  }

  function buildRecipeBreadcrumbSchema(recipe) {
    var canon =
      state.site &&
      state.site.canonicalOrigin &&
      String(state.site.canonicalOrigin).trim().replace(/\/+$/, "");
    var base = getBaseUrl();
    var home = canon ? canon + "/" : String(base || "").replace(/\/+$/, "") + "/";
    var itemUrl = absoluteRecipePageUrl(recipe);
    return {
      "@type": "BreadcrumbList",
      itemListElement: [
        {
          "@type": "ListItem",
          position: 1,
          name: "Home",
          item: home,
        },
        {
          "@type": "ListItem",
          position: 2,
          name: recipe.title || "Recipe",
          item: itemUrl,
        },
      ],
    };
  }

  function buildRecipeFaqItems(recipe) {
    var t = recipe.title || "this recipe";
    var total = recipe.totalTime || "";
    var cook = recipe.cookTime || "";
    var prep = recipe.prepTime || "";
    var servings = recipe.servings || 4;
    var ingredientHint = (recipe.ingredients || [])
      .slice(0, 2)
      .map(function (s) {
        return String(s || "").trim();
      })
      .filter(Boolean)
      .join(", ");

    var timeAnswer = total
      ? t + " usually takes around " + total + " from prep to serving."
      : cook || prep
      ? t +
        " usually takes about " +
        (prep && cook ? prep + " prep + " + cook + " cooking time." : cook || prep)
      : "Timing depends on your pace, but most home cooks can finish " + t + " in under one hour.";

    var serveAnswer =
      "Serve " +
      t +
      " with simple sides like salad, rice, or roasted vegetables. " +
      "Plan for about " +
      servings +
      " serving" +
      (servings === 1 ? "" : "s") +
      ".";
    if (ingredientHint) {
      serveAnswer += " Main ingredients include " + ingredientHint + ".";
    }

    return [
      {
        q: "How long does it take to make " + t + "?",
        a: timeAnswer,
      },
      {
        q: "Can I make " + t + " ahead of time?",
        a: "Yes. You can cook it ahead and store it in an airtight container in the fridge for up to 3 days. Reheat gently before serving.",
      },
      {
        q: "What should I serve with " + t + "?",
        a: serveAnswer,
      },
      {
        q: "Can I substitute ingredients in " + t + "?",
        a: "Yes. Use ingredients with similar texture and flavor, then adjust seasoning gradually to keep balance in the final dish.",
      },
    ];
  }

  function buildRecipeFaqSchema(recipe) {
    var items = buildRecipeFaqItems(recipe);
    if (!items.length) return null;
    return {
      "@type": "FAQPage",
      mainEntity: items.map(function (it) {
        return {
          "@type": "Question",
          name: it.q,
          acceptedAnswer: {
            "@type": "Answer",
            text: it.a,
          },
        };
      }),
    };
  }

  function renderRecipeFaq(recipe) {
    var root = $("#recipe-faq-list");
    if (!root) return;
    var items = buildRecipeFaqItems(recipe);
    root.innerHTML = items
      .map(function (it, i) {
        return (
          '<details class="recipe-faq__item"' +
          (i === 0 ? " open" : "") +
          ">" +
          "<summary>" +
          escapeHtml(it.q) +
          "</summary>" +
          '<p class="recipe-faq__answer">' +
          escapeHtml(it.a) +
          "</p>" +
          "</details>"
        );
      })
      .join("");
  }

  function renderRecipeTip(recipe) {
    var tip = recipe.tip && String(recipe.tip).trim();
    var existing = $("#recipe-tip-box");
    if (existing) existing.remove();

    if (!tip) return;

    var steps = $("#recipe-steps");
    if (!steps) return;

    var box = document.createElement("div");
    box.id = "recipe-tip-box";
    box.className = "recipe-tip";
    box.innerHTML =
      '<div class="recipe-tip__icon" aria-hidden="true">💡</div>' +
      '<div class="recipe-tip__content">' +
      "<strong>Chef's Tip:</strong> " +
      escapeHtml(tip) +
      "</div>";

    steps.parentNode.insertBefore(box, steps.nextSibling);
  }

  function buildRecipeJsonLdGraph(recipe) {
    var faq = buildRecipeFaqSchema(recipe);
    var graph = [
      buildRecipeSchemaNode(recipe),
      buildRecipeBreadcrumbSchema(recipe),
    ];
    if (faq) graph.push(faq);
    return {
      "@context": "https://schema.org",
      "@graph": graph,
    };
  }

  function recipeIdFromLocation() {
    var params = new URLSearchParams(window.location.search);
    var id = params.get("id");
    if (id) {
      try {
        id = decodeURIComponent(id);
      } catch (e) {}
      id = id.trim();
      if (id) return id;
    }
    var segs = window.location.pathname.split("/").filter(Boolean);
    if (segs.length && /index\.html?/i.test(segs[segs.length - 1])) {
      segs.pop();
    }
    var ri = segs.indexOf("recipes");
    if (ri >= 0 && segs[ri + 1]) {
      try {
        return decodeURIComponent(segs[ri + 1]);
      } catch (e) {
        return segs[ri + 1];
      }
    }
    return "";
  }

  function renderRecipePage() {
    var id = recipeIdFromLocation();
    var recipe = findRecipeById(id);
    var main = $("#recipe-main");

    if (!recipe) {
      if (main) {
        main.innerHTML =
          '<div class="container error-page">' +
          "<h1>Recipe not found</h1>" +
          '<p>The link may be outdated.</p>' +
          '<p><a href="index.html">Back to home</a></p>' +
          "</div>";
      }
      document.title = "Not found — " + (state.site.name || "Recipes");
      return;
    }

    var loadBanner = $("#recipe-loading-banner");
    if (loadBanner) loadBanner.hidden = true;

    updateRecipeMeta(recipe);
    injectJsonLd(buildRecipeJsonLdGraph(recipe));

    var heroImg = $("#recipe-hero-image");
    if (heroImg) {
      heroImg.src = recipe.image || "";
      heroImg.alt = recipe.title ? "Photo of " + recipe.title : "";
    }

    $("#recipe-title").textContent = recipe.title || "";
    var bc = $("#breadcrumb-current");
    if (bc) bc.textContent = recipe.title || "Recipe";
    var catHero = $("#recipe-category");
    if (catHero) {
      catHero.textContent =
        recipe.categoryDisplay || categoryLabel(recipe.category);
    }
    var originHero = $("#recipe-origin");
    if (originHero) {
      originHero.textContent = recipe.origin || "";
    }
    $("#recipe-read-time").textContent = estimateReadMinutes(recipe) + " min read";
    $("#recipe-servings").textContent =
      (recipe.servings || 1) +
      " serving" +
      ((recipe.servings || 1) === 1 ? "" : "s");

    var introEl = $("#recipe-intro");
    if (introEl) {
      introEl.textContent = recipe.hook || recipe.description || "";
    }

    renderRecipeTip(recipe);
    renderRecipeTagsAndVideo(recipe);
    renderRecipeFaq(recipe);

    var aff = $("#affiliate-cta");
    if (aff) {
      try {
        var base = "https://0f32e8wh-e0m7t1bzvreoy2m9r.hop.clickbank.net";
        var u = new URL(base);
        u.searchParams.set("utm_source", "akkous");
        u.searchParams.set("utm_medium", "affiliate");
        u.searchParams.set("utm_campaign", "vegan-cookbook");
        u.searchParams.set("utm_content", String(recipe.slug || recipe.id || ""));
        aff.href = u.toString();
      } catch (e) {
        // keep static href
      }
    }

    var ingList = $("#ingredient-list");
    if (ingList) {
      ingList.innerHTML = (recipe.ingredients || [])
        .map(function (ing, i) {
          var sid = "ing-" + recipe.id + "-" + i;
          return (
            "<li>" +
            '<label for="' +
            escapeHtml(sid) +
            '">' +
            '<input type="checkbox" id="' +
            escapeHtml(sid) +
            '">' +
            "<span>" +
            escapeHtml(ing) +
            "</span>" +
            "</label>" +
            "</li>"
          );
        })
        .join("");
    }

    var stepsOl = $("#recipe-steps");
    if (stepsOl) {
      var stepLines = recipe.steps;
      if (!stepLines || !stepLines.length) {
        var instr = recipe.instructions;
        if (typeof instr === "string" && instr.trim()) {
          stepLines = instr
            .split(/\n+/)
            .map(function (s) {
              return s.trim();
            })
            .filter(Boolean);
        }
      }
      stepsOl.innerHTML = (stepLines || [])
        .map(function (step) {
          return "<li>" + escapeHtml(step) + "</li>";
        })
        .join("");
    }

    var relatedIds = recipe.relatedRecipeIds || [];
    var related = relatedIds
      .map(function (rid) {
        return findRecipeById(rid);
      })
      .filter(Boolean)
      .slice(0, 3);

    if (!related.length) {
      related = sortRecipesByPublishDateDesc(
        state.recipes.filter(function (r) {
          return r.id !== recipe.id && r.category === recipe.category;
        })
      ).slice(0, 3);
      if (!related.length) {
        related = sortRecipesByPublishDateDesc(
          state.recipes.filter(function (r) { return r.id !== recipe.id; })
        ).slice(0, 3);
      }
    }

    var relRoot = $("#related-grid");
    if (relRoot) {
      relRoot.innerHTML = related
        .map(function (r) {
          var imgSrc = r.imageCard || r.image || "";
          return (
            '<article class="related-card io-fade">' +
            '<a href="' +
            escapeHtml(recipeUrl(r.id)) +
            '">' +
            '<div class="related-card__img">' +
            '<img src="' +
            escapeHtml(imgSrc) +
            '" alt="' +
            escapeHtml((r.title || "Related recipe") + " photo") +
            '" loading="lazy" width="400" height="250">' +
            "</div>" +
            '<div class="related-card__body">' +
            "<h3>" +
            escapeHtml(r.title || "") +
            "</h3>" +
            "</div>" +
            "</a>" +
            "</article>"
          );
        })
        .join("");
    }

    initShare(recipe);
  }

  function estimateReadMinutes(recipe) {
    var stepText = (recipe.steps || []).join(" ");
    if (!stepText && typeof recipe.instructions === "string") {
      stepText = recipe.instructions;
    }
    var words =
      ((recipe.description || "").split(/\s+/).length || 0) +
      (recipe.ingredients || []).join(" ").split(/\s+/).length +
      stepText.split(/\s+/).length;
    return Math.max(2, Math.round(words / 200));
  }

  function initShare(recipe) {
    var title = recipe.title || "";
    var canon = document.querySelector('link[rel="canonical"]');
    var url =
      canon && canon.href ? canon.href : window.location.href;
    var ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];

    var xBtn = $("#share-x");
    if (xBtn) {
      xBtn.addEventListener("click", function () {
        var text = encodeURIComponent(title);
        var u = encodeURIComponent(url);
        window.open(
          "https://twitter.com/intent/tweet?text=" + text + "&url=" + u,
          "_blank",
          "noopener,noreferrer,width=600,height=400"
        );
      });
    }

    var pinBtn = $("#share-pinterest");
    if (pinBtn) {
      pinBtn.addEventListener("click", function () {
        var u = encodeURIComponent(url);
        var media = encodeURIComponent(recipe.image || "");
        var desc = encodeURIComponent(title);
        window.open(
          "https://pinterest.com/pin/create/button/?url=" +
            u +
            "&media=" +
            media +
            "&description=" +
            desc,
          "_blank",
          "noopener,noreferrer,width=750,height=550"
        );
      });
    }

    var whatsappBtn = $("#share-whatsapp");
    if (whatsappBtn) {
      whatsappBtn.addEventListener("click", function () {
        var ingredientsText = ingredients.length
          ? ingredients.map(function (item) { return "- " + item; }).join("\n")
          : "- (No ingredients listed)";
        var message =
          "Try this recipe: " +
          title +
          "\n\nIngredients:\n" +
          ingredientsText +
          "\n\nLink: " +
          url;
        var waUrl = "https://wa.me/?text=" + encodeURIComponent(message);
        window.open(waUrl, "_blank", "noopener,noreferrer");
      });
    }

    var copyBtn = $("#share-copy");
    if (copyBtn) {
      copyBtn.addEventListener("click", function () {
        function done() {
          var orig = copyBtn.textContent;
          copyBtn.textContent = "Copied!";
          setTimeout(function () {
            copyBtn.textContent = orig;
          }, 2000);
        }

        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(url).then(done).catch(function () {
            fallbackCopy(url, done);
          });
        } else {
          fallbackCopy(url, done);
        }
      });
    }
  }

  function fallbackCopy(text, cb) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {}
    document.body.removeChild(ta);
    if (cb) cb();
  }

  function scrollToRecipeGrid() {
    var el = $("#recipe-grid");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  function initNavCategoryLinks() {
    $$("a[data-nav-cat]").forEach(function (link) {
      link.addEventListener("click", function (e) {
        var cat = link.getAttribute("data-nav-cat") || "all";
        if (!state.validCategorySet || !state.validCategorySet.has(cat)) return;
        if (isHomePage()) {
          e.preventDefault();
          if (typeof history !== "undefined" && history.replaceState) {
            var u = new URL(window.location.href);
            if (cat === "all") u.searchParams.delete("cat");
            else u.searchParams.set("cat", cat);
            history.replaceState({}, "", u.pathname + u.search + u.hash);
          }
          setFilter(cat);
          scrollToRecipeGrid();
        }
      });
    });
  }

  function initCategoryFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var cat = (params.get("cat") || "all").toLowerCase();
    if (!state.validCategorySet || !state.validCategorySet.has(cat)) {
      cat = "all";
    }
    setFilter(cat);
  }

  function initHomePage() {
    applyBranding();
    renderCategorySpotlight();
    renderFilterPills();
    initHeroCarousel();
    renderTrending();
    initSearchQueryFromUrl();
    initCategoryFromUrl();
    initFilters();
    initSearch();
    initNewsletter();
    initTrendingSlider();
  }

  function boot() {
    initTheme();
    initMobileNav();
    initBackToTop();
    initPwaInstall();
    registerServiceWorker();

    var themeBtn = $("#theme-toggle");
    if (themeBtn) themeBtn.addEventListener("click", toggleTheme);

    loadData()
      .then(function () {
        refreshDerivedCategories_();
        initRecipePageSearchRedirect();
        initGlobalCategoryNav_();
        if (isRecipePage()) {
          applyBranding();
          renderRecipePage();
        } else {
          initHomePage();
        }
        initScrollFadeIn();
      })
      .catch(function (err) {
        console.error(err);
        var grid = $("#recipe-grid");
        if (grid) {
          grid.innerHTML =
            '<p class="empty-state" role="alert">Could not load recipes. Check that recipes.json is available.</p>';
        }
        var main = $("#recipe-main");
        if (main) {
          main.innerHTML =
            '<div class="container error-page"><h1>Something went wrong</h1><p>Could not load recipe data.</p></div>';
        }
      });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
