/**
 * ============================================================================
 * FOOD RECIPE BLOG — TheMealDB → Google Sheets → (optional) GitHub Pages
 * ============================================================================
 *
 * SETUP
 * -----
 * 1. Recommended: open your Google Sheet → Extensions → Apps Script → paste
 *    this file. No spreadsheet ID needed: leave CONFIG.SHEET_ID as "".
 *    (Alternative: standalone script at script.google.com → then you must set
 *    SHEET_ID to the long ID from the sheet URL.)
 * 2. Fill CONFIG below. For a bound script, keep SHEET_ID: '' — rien à copier.
 * 3. Save. Run `testFetch()` once → authorize when prompted (external URL
 *    access for TheMealDB + optional GitHub).
 * 4. Open the Sheet → menu « 🍳 Akkous (tests) » lists every action, or run
 *    functions from the Apps Script editor. First run creates the "Recipes" tab.
 * 5. Déclencheurs automatiques :
 *    - Menu Sheet → « ⑨ Installer les déclencheurs » (une fois, puis accepter
 *      l’autorisation « gérer les déclencheurs »). Par défaut : un pipeline quotidien
 *      fetch → mark PUBLISHED → push GitHub (CONFIG.USE_CHAINED_PIPELINE_TRIGGER + TRIGGER_PIPELINE_HOUR).
 *    - Ou manuellement : éditeur Apps Script → Déclencheurs (icône horloge) →
 *      Ajouter un déclencheur → Type « Dans le temps » → fonction + horaire.
 *    - « ⑩ Supprimer les déclencheurs Akkous » enlève ceux créés par ⑨.
 * 6. Dashboard : onglet « AutomationLog » + menu « ⑦ Rapport » (panneau).
 *    Copie aussi automation-dashboard.html du repo vers Apps Script sous le nom
 *    AutomationDashboard.html pour le panneau latéral (voir fichier à la racine du projet).
 * 7. Push GitHub : sans token/repo → message « skipped ». Remplir CONFIG ou
 *    Propriétés du script : GITHUB_TOKEN (PAT), GITHUB_REPO (ex. INVOOFFICE/Akkous).
 *    recipes.json + sitemap : uniquement les lignes PUBLISHED. Si l’export est vide, le push
 *    est annulé (évite d’écraser le site avec recipes: []). Les pages HTML recipes/<slug>/
 *    sont régénérées sur GitHub par l’action « Build static recipe pages » après chaque push
 *    de recipes.json (ou en local : node scripts/build-recipe-pages.mjs).
 * 8. Newsletter : menu « ⑪ Feuille newsletter » puis Déployer → Application Web (doPost).
 *    Propriété du script NEWSLETTER_WEB_APP_URL = URL /exec → incluse dans recipes.json au push.
 * 9. SEO Groq : propriété GROQ_API_KEY + menu ② (nouvelles lignes uniquement). Modèle CONFIG.GROQ_MODEL (OpenAI-compatible).
 *    Menu ⑯ = sélection ; ⑰ = masse SCHEDULED si GEMINI_MANUAL_ENRICH_ALL_SCHEDULED.
 *
 * PUBLICATION vs REMPLISSAGE
 * --------------------------
 * PUBLISH_STAGGER (CONFIG) :
 * - 'batch' : chaque run de ② assigne la même Publish Date à toutes les recettes
 *   du lot (RECIPES_PER_DAY), comme 5 lignes le même jour — puis markPublished
 *   les passe ensemble quand la date/heure est dépassée.
 * - 'day' : une date différente par recette (file ~1 article / jour calendaire).
 * - 'hour' : même jour calendaire, heures 9h, 10h, 11h… (décalage horaire).
 *
 * PERMISSIONS
 * -----------
 * - External URL fetch (TheMealDB, api.github.com, api.groq.com)
 * - Google Sheets (read/write bound or by ID)
 *
 * ============================================================================
 */

const CONFIG = {
  /**
   * Laisser vide ('') si le script est lié au classeur (Extensions → Apps Script).
   * Le code utilise automatiquement ce fichier. Renseigner l’ID seulement pour un
   * projet Apps Script autonome (l’ID est dans l’URL du Sheet).
   */
  SHEET_ID: '',
  SHEET_NAME: 'Recipes',
  RECIPES_PER_DAY: 5,
  /** First article hour (local script timezone) */
  PUBLISH_HOUR: 9,
  /**
   * 'batch' = même date/heure pour tout le lot du jour (RECIPES_PER_DAY lignes).
   * 'hour'  = même jour calendaire : 9h, 10h, 11h… (mark dépend de l’heure).
   * 'day'   = une date par recette : J+1, J+2… (~1 article / jour).
   */
  PUBLISH_STAGGER: 'batch',
  /** Optional; default Session.getScriptTimeZone() */
  TIMEZONE: '',
  /**
   * Jeton d’accès GitHub (PAT). Laisser '' et utiliser plutôt les propriétés du script
   * (Réglages du projet → Propriétés du script → clé GITHUB_TOKEN) pour ne pas
   * coller le secret dans le code.
   * GitHub → Settings → Developer settings → Personal access tokens :
   * classique : scope « repo » ; fine-grained : accès au repo + Contents read/write.
   */
  GITHUB_TOKEN: '',
  /**
   * Dépôt cible « propriétaire/nom » (ex. INVOOFFICE/Akkous). Peut aussi être défini
   * en propriété du script GITHUB_REPO.
   */
  GITHUB_REPO: '',
  /** Path in repo, e.g. recipes.json */
  GITHUB_FILE: 'recipes.json',
  /** Sitemap poussé avec recipes.json ; URLs recettes = recipeSeoUrl_ → /recipes/{slug}/ */
  GITHUB_SITEMAP_FILE: 'sitemap.xml',
  /** Branche GitHub ciblée par le push (un seul commit JSON + sitemap évite deux déploiements Pages annulés) */
  GITHUB_BRANCH: 'main',
  /** Origine canonique (sitemap + Indexing API) ; doit matcher site.canonicalOrigin dans recipes.json */
  SITE_ORIGIN: 'https://akkous.com',
  API_BASE: 'https://www.themealdb.com/api/json/v1/1/',
  /**
   * Noms de catégories TheMealDB (filter.php?c=…) — liste de secours si l’API
   * categories.php est indisponible. Ordre aligné sur l’API v1.
   * @see fetchTheMealDbCategoryNamesFromApi_ — sync automatique + cache properties.
   */
  CATEGORIES: [
    'Beef',
    'Chicken',
    'Dessert',
    'Lamb',
    'Miscellaneous',
    'Pasta',
    'Pork',
    'Seafood',
    'Side',
    'Starter',
    'Vegan',
    'Vegetarian',
    'Breakfast',
    'Goat',
  ],
  /** Cache script properties THE_MEALDB_CATEGORIES_* (heures). */
  CATEGORIES_API_CACHE_HOURS: 168,
  /** Milliseconds between API calls */
  API_SLEEP_MS: 300,
  /** Days after publish to archive then remove PUBLISHED rows from Recipes */
  CLEANUP_DAYS: 90,
  /** Copie des lignes expirées avant suppression (cleanOldRecipes) — mêmes colonnes que Recipes */
  RECIPES_ARCHIVE_SHEET_NAME: 'RecipesArchive',
  /** Max random.php attempts when filling slots */
  MAX_RANDOM_ATTEMPTS: 25,
  HEADERS: [
    'ID',
    'Title',
    'Category',
    'Origin',
    'Image URL',
    'Ingredients',
    'Instructions',
    'Tags',
    'Publish Date',
    'Status',
    'Slug',
    'YouTube',
    'Added Date',
  ],
  COL: {
    ID: 1,
    TITLE: 2,
    CATEGORY: 3,
    ORIGIN: 4,
    IMAGE: 5,
    INGREDIENTS: 6,
    INSTRUCTIONS: 7,
    TAGS: 8,
    PUBLISH_DATE: 9,
    STATUS: 10,
    SLUG: 11,
    YOUTUBE: 12,
    ADDED_DATE: 13,
  },
  STATUS_SCHEDULED: 'SCHEDULED',
  STATUS_PUBLISHED: 'PUBLISHED',
  /** Journal d’automatisation (suivi / rapport) */
  AUTOMATION_LOG_SHEET_NAME: 'AutomationLog',
  AUTOMATION_LOG_MAX_ROWS_RETURN: 500,
  LOG_LEVEL_INFO: 'INFO',
  LOG_LEVEL_WARN: 'WARN',
  LOG_LEVEL_ERROR: 'ERROR',
  /**
   * Déclencheurs (menu ⑨) — alignés GitHub Pages : recipes.json → Actions → pages statiques.
   *
   * USE_CHAINED_PIPELINE_TRIGGER : un seul trigger quotidien enchaîne dans l’ordre
   *   fetch TheMealDB → markPublishedRecipes → pushRecipesToGitHub (plus de course entre triggers).
   *   Heure = TRIGGER_PIPELINE_HOUR (fuseau script).
   *
   * Si false : trois triggers séparés aux heures TRIGGER_FETCH_HOUR, TRIGGER_MARK_PUBLISHED_HOUR,
   * TRIGGER_PUSH_GITHUB_HOUR (l’ordre le même jour n’est pas garanti par Google si mêmes heures).
   * TRIGGER_PUSH_GITHUB_HOUR : -1 pour désactiver uniquement le push planifié (mode 3 triggers).
   */
  USE_CHAINED_PIPELINE_TRIGGER: true,
  /** Heure du pipeline quotidien (fetch + mark + push) quand USE_CHAINED_PIPELINE_TRIGGER est true. */
  TRIGGER_PIPELINE_HOUR: 4,
  /** Fetch TheMealDB (si pipeline désactivé : trigger séparé) */
  TRIGGER_FETCH_HOUR: 2,
  /** SCHEDULED → PUBLISHED (si pipeline désactivé) */
  TRIGGER_MARK_PUBLISHED_HOUR: 3,
  /** Push recipes.json + sitemap (si pipeline désactivé) */
  TRIGGER_PUSH_GITHUB_HOUR: 4,
  /** Indexation GSC (batch) — 5 h Maroc ≈ minuit EST (début journée calendaire US) */
  TRIGGER_GSC_INDEX_HOUR: 5,
  GSC_DAILY_INDEX_COUNT: 5,
  /** Nettoyage hebdo : SUNDAY | MONDAY | … | SATURDAY */
  TRIGGER_CLEAN_WEEKDAY: 'SUNDAY',
  /** Archivage / nettoyage (hebdo) — 1 h Maroc ≈ 20 h EST (veille) */
  TRIGGER_CLEAN_HOUR: 1,
  /** Active/désactive la soumission Indexing API (batch journalier) */
  GSC_INDEXING_ENABLED: true,
  /** Service account e-mail (optionnel ici, recommandé via propriété script GSC_CLIENT_EMAIL) */
  GSC_CLIENT_EMAIL: '',
  /** Private key PEM (optionnel ici, recommandé via propriété script GSC_PRIVATE_KEY) */
  GSC_PRIVATE_KEY: '',
  /** OAuth2 scope for URL notifications */
  GSC_SCOPE: 'https://www.googleapis.com/auth/indexing',
  /**
   * Si true : évalue le SEO à l’export et log des WARN — ne bloque plus l’inclusion dans recipes.json
   * (toutes les lignes PUBLISHED partent sur GitHub ; le gate sert au suivi / menu ⑭).
   */
  SEO_QUALITY_GATE_ENABLED: true,
  SEO_MIN_TITLE_LEN: 8,
  SEO_MIN_INGREDIENTS: 3,
  SEO_MIN_STEPS: 3,
  SEO_RELATED_MAX: 3,
  /** Onglet créé par ⑪ — e-mails du formulaire site (Web App POST) */
  NEWSLETTER_SHEET_NAME: 'NewsletterSubscribers',
  /**
   * URL /exec du déploiement Web App (newsletter). Peut être surchargée par la
   * propriété du script NEWSLETTER_WEB_APP_URL.
   */
  NEWSLETTER_WEB_APP_URL:
    'https://script.google.com/macros/s/AKfycbyUZCxHWAoYAyMdSnk2gOjZWfGaoV4W38Tm7MFRmdocyiaVdqg0aAv7kSkhNeRZrW1D/exec',
  /**
   * SEO Groq (chat/completions). Clé API uniquement via propriété du script GROQ_API_KEY.
   * Doc : https://console.groq.com/
   */
  GROQ_MODEL: 'llama-3.3-70b-versatile',
  /** Pause entre chaque ligne enrichie */
  GEMINI_API_SLEEP_MS: 2500,
  GEMINI_MAX_TITLE_LEN: 60,
  /** Après HTTP 429 Groq, tentatives supplémentaires (backoff exponentiel) */
  GROQ_429_MAX_RETRIES: 4,
  /** Attente de base (ms) avant 1re relance 429, puis ×2 */
  GROQ_429_BASE_SLEEP_MS: 3000,
  /**
   * true : après ②, appel Groq sur les seules nouvelles lignes insérées (recommandé).
   * false : pas d’enrichissement automatique au fetch (tu peux utiliser ⑯ sur une sélection).
   */
  GEMINI_ENRICH_AFTER_FETCH: true,
  /**
   * true : menu ⑰ autorise l’enrichissement de toutes les lignes SCHEDULED (peut retoucher
   * d’anciennes lignes). false : ⑰ affiche un message — évite d’enrichir tout le sheet par erreur.
   */
  GEMINI_MANUAL_ENRICH_ALL_SCHEDULED: false,
};

// ---------------------------------------------------------------------------
// Menu dans le classeur (script lié : Extensions → Apps Script)
// ---------------------------------------------------------------------------

/**
 * Affiche le menu « 🍳 Akkous (tests) » à l’ouverture du Sheet.
 * Si le menu n’apparaît pas : recharge l’onglet du classeur (F5).
 * getUi() ne marche pas depuis l’éditeur sans classeur → ignoré silencieusement.
 */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('🍳 Akkous (tests)')
      .addItem('① Test API : 1 recette aléatoire → Journal', 'testFetch')
      .addSeparator()
      .addItem('② Récupérer & planifier (RECIPES_PER_DAY)', 'fetchAndScheduleRecipes')
      .addItem('③ Marquer PUBLISHED (dates déjà passées)', 'markPublishedRecipes')
      .addItem('④ Pousser recipes.json + sitemap.xml sur GitHub', 'pushRecipesToGitHub')
      .addItem('⑤ Nettoyer lignes publiées (> CLEANUP_DAYS)', 'cleanOldRecipes')
      .addSeparator()
      .addItem('▶ Enchaîner ② puis ③ (test chaîne)', 'testRunFetchThenMarkPublished')
      .addItem('▶ Pipeline complet ②→③→④ (comme auto / GitHub)', 'testRunFetchMarkPushPipeline')
      .addSeparator()
      .addItem('⑦ Rapport automatisation (panneau)', 'showAutomationDashboard')
      .addItem('⑧ Ouvrir onglet AutomationLog', 'openAutomationLogSheet')
      .addSeparator()
      .addItem('⑨ Installer les déclencheurs (auto)', 'installFeastablyTriggers')
      .addItem('⑩ Supprimer déclencheurs Akkous', 'removeFeastablyTriggers')
      .addSeparator()
      .addItem('⑪ Feuille inscriptions newsletter', 'setupNewsletterSheet')
      .addItem('⑫ Aide déploiement Web App newsletter', 'showNewsletterDeployHelp')
      .addItem('⑬ Indexation GSC (batch manuel)', 'submitDailyIndexingBatchToGsc')
      .addItem('⑭ Audit SEO export (aperçu)', 'runSeoAuditPreview')
      .addItem('⑮ Export Pinterest (Title/Image/Ingredients/URL)', 'buildPinterestExportSheet')
      .addItem('⑯ Enrichir SEO (Groq) — lignes sélectionnées (Recipes)', 'runGroqSeoEnrichSelectedRows')
      .addItem('⑰ Enrichir SEO (Groq) — toutes les SCHEDULED (option avancée)', 'runGroqSeoEnrichAllScheduled')
      .addToUi();
  } catch (e) {
    Logger.log('onOpen: %s', e);
  }
}

/**
 * Pour tester la chaîne sans déclencheur : import puis mise à jour des statuts.
 */
function testRunFetchThenMarkPublished() {
  logAutomation_(CONFIG.LOG_LEVEL_INFO, 'testRunFetchThenMarkPublished', 'Démarrage chaîne test');
  try {
    fetchAndScheduleRecipes();
    markPublishedRecipes();
    logAutomation_(CONFIG.LOG_LEVEL_INFO, 'testRunFetchThenMarkPublished', 'Chaîne test terminée');
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Terminé : fetch + markPublished.',
      'Akkous',
      5
    );
  } catch (e) {
    logAutomation_(CONFIG.LOG_LEVEL_ERROR, 'testRunFetchThenMarkPublished', String(e));
    throw e;
  }
}

/**
 * Même ordre et même robustesse que le déclencheur quotidien (dailyAkkousChainedPipeline_) :
 * fetch → mark PUBLISHED → push recipes.json + sitemap sur GitHub.
 * Pour tester bout en bout sans attendre l’heure du trigger.
 */
function testRunFetchMarkPushPipeline() {
  logAutomation_(
    CONFIG.LOG_LEVEL_INFO,
    'testRunFetchMarkPushPipeline',
    'Test manuel pipeline complet (fetch → mark → push)'
  );
  dailyAkkousChainedPipeline_();
  SpreadsheetApp.getActiveSpreadsheet().toast(
    'Pipeline terminé : fetch → mark → push. Voir AutomationLog et le dépôt GitHub.',
    'Akkous',
    10
  );
}

/**
 * Panneau latéral : nécessite le fichier AutomationDashboard.html dans le projet Apps Script
 * (copie de automation-dashboard.html à la racine du dépôt).
 */
function showAutomationDashboard() {
  try {
    const html = HtmlService.createHtmlOutputFromFile('AutomationDashboard')
      .setTitle('Akkous')
      .setWidth(420);
    SpreadsheetApp.getUi().showSidebar(html);
  } catch (e) {
    SpreadsheetApp.getUi().alert(
      'Ajoute le fichier HTML « AutomationDashboard » au projet Apps Script (copie automation-dashboard.html depuis le repo). Détail : ' +
        e
    );
  }
}

/**
 * Web App (optionnel) : si tu déploies le script comme « Application web » et tu ouvres
 * l’URL …/exec, Google appelle doGet. Sans cette fonction → « doGet introuvable ».
 * Déploiement : Déployer → Nouveau déploiement → Type : Application web → Exécuter en tant que : Moi → Accès : Tout le monde (ou compte Google).
 * Pour un usage normal, le menu ⑦ (panneau latéral) suffit et ne nécessite pas de déploiement.
 * Si le rapport Web App ne charge pas les données : Propriétés du script → SPREADSHEET_ID = l’ID du classeur (segment de l’URL docs.google.com/spreadsheets/d/ICI/…).
 *
 * Paramètre ?callback=nomFn : renvoie du JSONP pour un rapport HTML local (lecture seule),
 * ex. …/exec?callback=akkousReportCb — évite le blocage CORS du navigateur.
 */
function doGet(e) {
  e = e || {};
  const cbRaw = e.parameter && e.parameter.callback;
  if (cbRaw) {
    const cb = String(cbRaw).replace(/[^a-zA-Z0-9_$]/g, '');
    if (!cb || cb.length > 48) {
      return ContentService.createTextOutput('invalid callback').setMimeType(
        ContentService.MimeType.TEXT
      );
    }
    let payload;
    try {
      payload = getAutomationLogData();
    } catch (err) {
      payload = {
        error: true,
        message: String(err && err.message ? err.message : err),
      };
    }
    const json = JSON.stringify(payload);
    return ContentService.createTextOutput(cb + '(' + json + ');').setMimeType(
      ContentService.MimeType.JAVASCRIPT
    );
  }
  return HtmlService.createHtmlOutputFromFile('AutomationDashboard')
    .setTitle('Akkous — Rapport')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

/** Active l’onglet du journal dans le classeur. */
function openAutomationLogSheet() {
  const ss = getSpreadsheet_();
  const sh = ensureAutomationLogSheet_(ss);
  ss.setActiveSheet(sh);
}

/**
 * Données pour le tableau de bord HTML (dernières lignes, plus récent en premier).
 * @returns {Array<{timestamp:string,level:string,action:string,detail:string}>}
 */
function getAutomationLogData() {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(CONFIG.AUTOMATION_LOG_SHEET_NAME);
  if (!sh || sh.getLastRow() < 2) return [];

  const last = sh.getLastRow();
  const max = CONFIG.AUTOMATION_LOG_MAX_ROWS_RETURN;
  const start = Math.max(2, last - max + 1);
  const data = sh.getRange(start, 1, last, 4).getValues();
  const out = data.map((row) => ({
    timestamp:
      row[0] instanceof Date
        ? row[0].toISOString()
        : String(row[0] != null ? row[0] : ''),
    level: String(row[1] != null ? row[1] : ''),
    action: String(row[2] != null ? row[2] : ''),
    detail: String(row[3] != null ? row[3] : ''),
  }));
  out.reverse();
  return out;
}

/**
 * Weekly SEO monitoring summary for dashboard (last 7 days).
 * @returns {{
 *   generatedAt:string,
 *   windowDays:number,
 *   kpis:Object,
 *   indexing:Object,
 *   topErrors:Array<{timestamp:string,action:string,detail:string}>,
 *   pagesToImprove:Array<{id:string,title:string,issues:Array<string>,score:number}>
 * }}
 */
function getSeoMonitoringReport() {
  const rows = getAutomationLogData();
  const nowMs = Date.now();
  const windowDays = 7;
  const fromMs = nowMs - windowDays * 24 * 60 * 60 * 1000;
  const weekly = rows.filter((r) => {
    const t = Date.parse(r.timestamp || '');
    return !isNaN(t) && t >= fromMs;
  });

  const kpis = {
    totalLogs7d: weekly.length,
    errors7d: 0,
    warns7d: 0,
    recipesPushed7d: 0,
    sitemapPushed7d: 0,
    indexingRuns7d: 0,
    indexedOk7d: 0,
    indexedKo7d: 0,
  };

  const topErrors = [];
  weekly.forEach((r) => {
    const lv = String(r.level || '').toUpperCase();
    const action = String(r.action || '');
    const detail = String(r.detail || '');
    if (lv === 'ERROR') {
      kpis.errors7d++;
      if (topErrors.length < 12) {
        topErrors.push({
          timestamp: r.timestamp,
          action: action,
          detail: detail.slice(0, 240),
        });
      }
    } else if (lv === 'WARN') {
      kpis.warns7d++;
    }
    if (action === 'pushRecipesToGitHub' && detail.indexOf('OK') !== -1) {
      kpis.recipesPushed7d++;
      if (detail.indexOf('sitemap.xml') !== -1) kpis.sitemapPushed7d++;
    }
    if (action === 'submitDailyIndexingBatchToGsc') {
      if (detail.indexOf('Démarrage batch indexation') !== -1) kpis.indexingRuns7d++;
      const m = detail.match(/Terminé\s*:\s*(\d+)\s*OK,\s*(\d+)\s*erreur/);
      if (m) {
        kpis.indexedOk7d += parseInt(m[1], 10) || 0;
        kpis.indexedKo7d += parseInt(m[2], 10) || 0;
      }
    }
  });

  const sheet = getRecipesSheetOrThrow_();
  const payload = buildExportPayload_(sheet);
  const pagesToImprove = rankPagesToImprove_(payload.recipes || []).slice(0, 8);

  return {
    generatedAt: new Date().toISOString(),
    windowDays: windowDays,
    kpis: kpis,
    indexing: {
      successRate:
        kpis.indexedOk7d + kpis.indexedKo7d > 0
          ? Math.round((kpis.indexedOk7d * 100) / (kpis.indexedOk7d + kpis.indexedKo7d))
          : null,
    },
    topErrors: topErrors,
    pagesToImprove: pagesToImprove,
  };
}

function rankPagesToImprove_(recipes) {
  return (recipes || [])
    .map((r) => {
      const issues = [];
      let score = 100;
      const title = String(r.title || '').trim();
      const desc = String(r.description || '').trim();
      const ingredients = r.ingredients || [];
      const steps = r.steps || [];
      const tags = r.tags || [];
      const image = String(r.image || '').trim();

      if (!title || title.length < 12) {
        issues.push('Title too short');
        score -= 18;
      }
      if (!desc || desc.length < 110) {
        issues.push('Description too short');
        score -= 16;
      }
      if (ingredients.length < 4) {
        issues.push('Few ingredients');
        score -= 12;
      }
      if (steps.length < 4) {
        issues.push('Few instructions steps');
        score -= 14;
      }
      if (tags.length < 2) {
        issues.push('Not enough tags');
        score -= 10;
      }
      if (!/^https?:\/\//i.test(image)) {
        issues.push('Image URL invalid');
        score -= 20;
      }
      if (!r.cookTime && !r.totalTime) {
        issues.push('Missing time label');
        score -= 8;
      }
      if (!r.relatedRecipeIds || !r.relatedRecipeIds.length) {
        issues.push('No related links');
        score -= 8;
      }
      if (!r.youtube) {
        issues.push('No video link');
        score -= 4;
      }
      if (score < 0) score = 0;
      return {
        id: String(r.id || ''),
        title: title || 'Untitled',
        issues: issues,
        score: score,
      };
    })
    .filter((x) => x.issues.length > 0)
    .sort((a, b) => a.score - b.score || a.title.localeCompare(b.title));
}

// ---------------------------------------------------------------------------
// Journal automation (onglet + rapport)
// ---------------------------------------------------------------------------

function ensureAutomationLogSheet_(ss) {
  let sh = ss.getSheetByName(CONFIG.AUTOMATION_LOG_SHEET_NAME);
  if (sh) return sh;

  sh = ss.insertSheet(CONFIG.AUTOMATION_LOG_SHEET_NAME);
  const headers = [['Horodatage', 'Niveau', 'Action', 'Détail']];
  const hr = sh.getRange(1, 1, 1, 4);
  hr.setValues(headers);
  hr.setFontWeight('bold');
  hr.setFontColor('#FFFFFF');
  hr.setBackground('#E8572A');
  sh.setFrozenRows(1);
  sh.setColumnWidth(1, 180);
  sh.setColumnWidth(2, 72);
  sh.setColumnWidth(3, 220);
  sh.setColumnWidth(4, 400);
  return sh;
}

/**
 * @param {string} level  INFO | WARN | ERROR
 * @param {string} action  nom de la fonction / étape
 * @param {string} detail  texte libre (tronqué si très long)
 */
function logAutomation_(level, action, detail) {
  try {
    const ss = getSpreadsheet_();
    const sh = ensureAutomationLogSheet_(ss);
    const ts = new Date();
    const msg = String(detail != null ? detail : '').slice(0, 49000);
    sh.appendRow([ts, level, action, msg]);
  } catch (e) {
    Logger.log('logAutomation_: %s', e);
  }
}

// ---------------------------------------------------------------------------
// Déclencheurs (triggers) — menu ⑨ / ⑩
// ---------------------------------------------------------------------------

const FEASTABLY_TRIGGER_HANDLERS_ = [
  'fetchAndScheduleRecipes',
  'markPublishedRecipes',
  'pushRecipesToGitHub',
  'dailyAkkousChainedPipeline_',
  'submitDailyIndexingBatchToGsc',
  'cleanOldRecipes',
];

function clampTriggerHour_(h, fallback) {
  const n = parseInt(h, 10);
  if (isNaN(n) || n < 0 || n > 23) return fallback;
  return n;
}

function weekDayFromConfig_(name) {
  const map = {
    MONDAY: ScriptApp.WeekDay.MONDAY,
    TUESDAY: ScriptApp.WeekDay.TUESDAY,
    WEDNESDAY: ScriptApp.WeekDay.WEDNESDAY,
    THURSDAY: ScriptApp.WeekDay.THURSDAY,
    FRIDAY: ScriptApp.WeekDay.FRIDAY,
    SATURDAY: ScriptApp.WeekDay.SATURDAY,
    SUNDAY: ScriptApp.WeekDay.SUNDAY,
  };
  return map[String(name || '').toUpperCase()] || ScriptApp.WeekDay.SUNDAY;
}

function removeFeastablyTriggersOnly_() {
  const want = {};
  FEASTABLY_TRIGGER_HANDLERS_.forEach(function (n) {
    want[n] = true;
  });
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (want[t.getHandlerFunction()]) ScriptApp.deleteTrigger(t);
  });
}

/**
 * Crée les déclencheurs horaires Akkous (supprime d’abord les anciens du même type).
 * À lancer une fois depuis le menu ⑨ ; accepter l’autorisation « gérer les déclencheurs ».
 */
/**
 * Pipeline quotidien : ordre fixe pour TheMealDB → feuille → PUBLISHED → GitHub (recipes.json + sitemap).
 * À utiliser avec un seul déclencheur (CONFIG.USE_CHAINED_PIPELINE_TRIGGER).
 */
function dailyAkkousChainedPipeline_() {
  logAutomation_(CONFIG.LOG_LEVEL_INFO, 'dailyAkkousChainedPipeline_', 'Démarrage (fetch → mark → push)');
  try {
    fetchAndScheduleRecipes();
  } catch (e1) {
    logAutomation_(CONFIG.LOG_LEVEL_ERROR, 'dailyAkkousChainedPipeline_', 'fetch: ' + String(e1));
  }
  try {
    markPublishedRecipes();
  } catch (e2) {
    logAutomation_(CONFIG.LOG_LEVEL_ERROR, 'dailyAkkousChainedPipeline_', 'markPublished: ' + String(e2));
  }
  try {
    pushRecipesToGitHub();
  } catch (e3) {
    logAutomation_(CONFIG.LOG_LEVEL_ERROR, 'dailyAkkousChainedPipeline_', 'push: ' + String(e3));
  }
  logAutomation_(CONFIG.LOG_LEVEL_INFO, 'dailyAkkousChainedPipeline_', 'Fin pipeline');
}

function installFeastablyTriggers() {
  removeFeastablyTriggersOnly_();
  const tz = getTimezone_();
  const hFetch = clampTriggerHour_(CONFIG.TRIGGER_FETCH_HOUR, 6);
  const hMark = clampTriggerHour_(CONFIG.TRIGGER_MARK_PUBLISHED_HOUR, 7);
  const hPush = CONFIG.TRIGGER_PUSH_GITHUB_HOUR;
  const hIndex = clampTriggerHour_(CONFIG.TRIGGER_GSC_INDEX_HOUR, 9);
  const hClean = clampTriggerHour_(CONFIG.TRIGGER_CLEAN_HOUR, 5);
  const chained = CONFIG.USE_CHAINED_PIPELINE_TRIGGER === true;
  const hPipe = clampTriggerHour_(CONFIG.TRIGGER_PIPELINE_HOUR, 4);

  if (chained) {
    ScriptApp.newTrigger('dailyAkkousChainedPipeline_')
      .timeBased()
      .inTimezone(tz)
      .everyDays(1)
      .atHour(hPipe)
      .create();
  } else {
    ScriptApp.newTrigger('fetchAndScheduleRecipes')
      .timeBased()
      .inTimezone(tz)
      .everyDays(1)
      .atHour(hFetch)
      .create();

    ScriptApp.newTrigger('markPublishedRecipes')
      .timeBased()
      .inTimezone(tz)
      .everyDays(1)
      .atHour(hMark)
      .create();

    if (hPush >= 0 && hPush <= 23) {
      ScriptApp.newTrigger('pushRecipesToGitHub')
        .timeBased()
        .inTimezone(tz)
        .everyDays(1)
        .atHour(clampTriggerHour_(hPush, 8))
        .create();
    }
  }

  if (CONFIG.GSC_INDEXING_ENABLED) {
    ScriptApp.newTrigger('submitDailyIndexingBatchToGsc')
      .timeBased()
      .inTimezone(tz)
      .everyDays(1)
      .atHour(hIndex)
      .create();
  }

  ScriptApp.newTrigger('cleanOldRecipes')
    .timeBased()
    .inTimezone(tz)
    .onWeekDay(weekDayFromConfig_(CONFIG.TRIGGER_CLEAN_WEEKDAY))
    .atHour(hClean)
    .create();

  logAutomation_(
    CONFIG.LOG_LEVEL_INFO,
    'installFeastablyTriggers',
    chained
      ? 'Créés : pipeline chaîné dailyAkkousChainedPipeline_ @' +
          hPipe +
          'h (fetch→mark→push)' +
          (CONFIG.GSC_INDEXING_ENABLED ? ', index @' + hIndex + 'h' : ', index OFF') +
          ', clean ' +
          String(CONFIG.TRIGGER_CLEAN_WEEKDAY) +
          ' @' +
          hClean +
          'h'
      : 'Créés : fetch @' +
          hFetch +
          'h, mark @' +
          hMark +
          'h' +
          (hPush >= 0 && hPush <= 23 ? ', push @' + hPush + 'h' : ', pas de push') +
          (CONFIG.GSC_INDEXING_ENABLED ? ', index @' + hIndex + 'h' : ', index OFF') +
          ', clean ' +
          String(CONFIG.TRIGGER_CLEAN_WEEKDAY) +
          ' @' +
          hClean +
          'h'
  );
  try {
    SpreadsheetApp.getUi().alert(
      'Déclencheurs installés.\n\n' +
        (CONFIG.USE_CHAINED_PIPELINE_TRIGGER === true
          ? 'Mode pipeline : une seule exécution quotidienne enchaîne fetch → mark → push (heure TRIGGER_PIPELINE_HOUR).\n'
          : 'Mode classique : trois déclencheurs séparés (TRIGGER_FETCH / MARK / PUSH).\n') +
        'Vérifie : éditeur Apps Script → Déclencheurs (horloge). Ajuste CONFIG puis relance ⑨.'
    );
  } catch (e) {
    Logger.log('installFeastablyTriggers UI: %s', e);
  }
}

/** Supprime uniquement les déclencheurs liés aux fonctions Akkous. */
function removeFeastablyTriggers() {
  removeFeastablyTriggersOnly_();
  logAutomation_(CONFIG.LOG_LEVEL_INFO, 'removeFeastablyTriggers', 'Déclencheurs Akkous supprimés');
  try {
    SpreadsheetApp.getUi().alert('Déclencheurs Akkous supprimés.');
  } catch (e) {
    Logger.log('removeFeastablyTriggers UI: %s', e);
  }
}

// ---------------------------------------------------------------------------
// Groq SEO (Title / Instructions / Tags) — API OpenAI-compatible
// ---------------------------------------------------------------------------

/**
 * Clé API Groq — uniquement PropertiesService, jamais dans CONFIG.
 */
function getGroqApiKey_() {
  return String(PropertiesService.getScriptProperties().getProperty('GROQ_API_KEY') || '').trim();
}

/**
 * Appelle Groq (chat/completions) pour produire title (SEO), instructions numérotées, tags (5–8).
 * Objectif : visibilité (Google / Bing : titres et structure) + contenu exploitable par les
 * réponses IA (aperçus, assistants) : entités claires, étapes factuelles, tags thématiques.
 * Retourne { title, instructions, tags } (strings). Lève une erreur si HTTP ou JSON invalide.
 */
function callGroqForRecipeSeo_(title, category, origin, ingredients, instructions, tags) {
  const apiKey = getGroqApiKey_();
  if (!apiKey) {
    throw new Error('GROQ_API_KEY manquante (Propriétés du script).');
  }
  const model = String(CONFIG.GROQ_MODEL || 'llama-3.3-70b-versatile').trim();
  const maxTitle = Math.max(20, parseInt(CONFIG.GEMINI_MAX_TITLE_LEN, 10) || 60);

  const prompt =
    'Tu es expert SEO + rédaction web pour akkous.com. Langue : alignée sur le contenu source (FR ou EN), ton naturel et fiable.' +
    '\nObjectifs doubles :' +
    '\n(1) Moteurs de recherche : titre clair pour l’intention "recette", mots-clés principaux (plat, type de cuisine si pertinent), pas de bourrage.' +
    '\n(2) IA de recherche (aperçus, assistants) : instructions structurées et factuelles, faciles à citer ou résumer ; pas de HTML ; pas d’affirmations médicales ou garanties de classement.' +
    '\nRéécris UNIQUEMENT ces trois champs à partir du contexte ci-dessous.' +
    '\nRègles strictes :' +
    '\n- title : accrocheur, contient le nom du plat (ou équivalent clair), peut inclure origine/catégorie si utile et court ; max ' +
    maxTitle +
    ' caractères (compte bien).' +
    '\n- instructions : étapes numérotées 1. 2. 3. … ; une action principale par étape ; temps ou température si connus dans le texte source ; cohérent avec les ingrédients listés.' +
    '\n- tags : exactement entre 5 et 8 tags ; mélange utile pour recherche + IA : type de plat, protéine ou ingrédient principal, méthode (grillé, four, etc.), cuisine ou région si pertinent, occasion (ex. BBQ, rapide) ; virgules, sans #, sans doublons évidents.' +
    '\nRéponds UNIQUEMENT avec un objet JSON valide, sans markdown, sans texte avant/après. Clés exactes : "title", "instructions", "tags".' +
    '\n\nContexte JSON (améliore, ne copie pas mot à mot) :\n' +
    JSON.stringify({
      title: title || '',
      category: category || '',
      origin: origin || '',
      ingredients: ingredients || '',
      instructions: instructions || '',
      tags: tags || '',
    });

  const url = 'https://api.groq.com/openai/v1/chat/completions';
  const body = {
    model: model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.35,
    max_tokens: 1024,
    response_format: { type: 'json_object' },
  };

  const payloadStr = JSON.stringify(body);
  const maxRetries = Math.max(0, parseInt(CONFIG.GROQ_429_MAX_RETRIES, 10) || 4);
  const baseSleep429 = Math.max(500, parseInt(CONFIG.GROQ_429_BASE_SLEEP_MS, 10) || 3000);
  const headers = {
    Authorization: 'Bearer ' + apiKey,
    'Content-Type': 'application/json',
  };
  let resp;
  let code;
  let raw = '';
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    resp = UrlFetchApp.fetch(url, {
      method: 'post',
      contentType: 'application/json',
      headers: headers,
      payload: payloadStr,
      muteHttpExceptions: true,
    });
    code = resp.getResponseCode();
    raw = resp.getContentText() || '';
    if (code === 200) {
      break;
    }
    if (code === 429 && attempt < maxRetries) {
      const waitMs = baseSleep429 * Math.pow(2, attempt);
      logAutomation_(
        CONFIG.LOG_LEVEL_WARN,
        'callGroqForRecipeSeo_',
        'HTTP 429 (Groq) — attente ' +
          Math.round(waitMs / 1000) +
          ' s puis retry ' +
          (attempt + 1) +
          '/' +
          maxRetries
      );
      Utilities.sleep(waitMs);
      continue;
    }
    logAutomation_(CONFIG.LOG_LEVEL_ERROR, 'callGroqForRecipeSeo_', 'HTTP ' + code + ' : ' + raw.slice(0, 500));
    if (code === 429) {
      throw new Error(
        'Groq HTTP 429 : quota ou limite de débit. Voir https://console.groq.com/ — ou augmente GROQ_429_* / GEMINI_API_SLEEP_MS.'
      );
    }
    throw new Error('Groq HTTP ' + code);
  }

  let outer;
  try {
    outer = JSON.parse(raw);
  } catch (e) {
    throw new Error('Réponse Groq enveloppe non JSON : ' + String(e));
  }

  let text = '';
  try {
    const ch0 = outer.choices && outer.choices[0];
    const msg = ch0 && ch0.message;
    if (msg && msg.content != null) {
      text = String(msg.content).trim();
    }
  } catch (e) {
    /* ignore */
  }
  if (!text) {
    throw new Error('Réponse Groq vide (choices[0].message.content manquant).');
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    try {
      parsed = JSON.parse(cleaned);
    } catch (e2) {
      throw new Error('JSON Groq illisible : ' + text.slice(0, 200));
    }
  }

  const outTitle = String(parsed.title || '').trim().replace(/\s+/g, ' ');
  const outInstr = String(parsed.instructions || '').trim();
  let outTags = String(parsed.tags || '').trim();
  if (!outTitle || !outInstr) {
    throw new Error('Groq a renvoyé title ou instructions vide.');
  }
  let titleSeo = outTitle;
  if (titleSeo.length > maxTitle) {
    titleSeo = titleSeo.substring(0, maxTitle - 1).trim() + '…';
  }
  outTags = outTags.replace(/^[\s#,]+|[\s#,]+$/g, '').replace(/\s*,\s*/g, ', ');

  return { title: titleSeo, instructions: outInstr, tags: outTags };
}

/**
 * Lit une ligne Recipes et écrase Title, Instructions, Tags après appel Groq.
 */
function enrichRecipeSheetRowWithGroq_(sheet, rowNum) {
  const nCol = CONFIG.HEADERS.length;
  const row = sheet.getRange(rowNum, 1, 1, nCol).getValues()[0];
  const title = String(row[CONFIG.COL.TITLE - 1] || '').trim();
  const category = String(row[CONFIG.COL.CATEGORY - 1] || '').trim();
  const origin = String(row[CONFIG.COL.ORIGIN - 1] || '').trim();
  const ingredients = String(row[CONFIG.COL.INGREDIENTS - 1] || '').trim();
  const instructions = String(row[CONFIG.COL.INSTRUCTIONS - 1] || '').trim();
  const tags = String(row[CONFIG.COL.TAGS - 1] || '').trim();
  if (!title) {
    throw new Error('Ligne ' + rowNum + ' : titre vide, ignorée.');
  }

  const seo = callGroqForRecipeSeo_(title, category, origin, ingredients, instructions, tags);
  sheet.getRange(rowNum, CONFIG.COL.TITLE).setValue(seo.title);
  sheet.getRange(rowNum, CONFIG.COL.INSTRUCTIONS).setValue(seo.instructions);
  sheet.getRange(rowNum, CONFIG.COL.TAGS).setValue(seo.tags);
}

/**
 * Enrichit un bloc de lignes consécutives (ex. nouvelles lignes après fetch).
 */
function enrichRecipeSheetRowsWithGroq_(sheet, startRow, rowCount) {
  const sleepMs = Math.max(200, parseInt(CONFIG.GEMINI_API_SLEEP_MS, 10) || 2500);
  for (let i = 0; i < rowCount; i++) {
    const rowNum = startRow + i;
    try {
      enrichRecipeSheetRowWithGroq_(sheet, rowNum);
      logAutomation_(CONFIG.LOG_LEVEL_INFO, 'enrichRecipeSheetRowsWithGroq_', 'Ligne ' + rowNum + ' OK (Groq SEO)');
    } catch (e) {
      logAutomation_(CONFIG.LOG_LEVEL_WARN, 'enrichRecipeSheetRowsWithGroq_', 'Ligne ' + rowNum + ' : ' + String(e));
    }
    if (i < rowCount - 1) {
      Utilities.sleep(sleepMs);
    }
  }
}

/**
 * Menu ⑯ : enrichit uniquement les lignes de la plage active dans l’onglet Recipes (pas le header).
 */
function runGroqSeoEnrichSelectedRows() {
  logAutomation_(CONFIG.LOG_LEVEL_INFO, 'runGroqSeoEnrichSelectedRows', 'Démarrage');
  if (!getGroqApiKey_()) {
    try {
      SpreadsheetApp.getUi().alert(
        'Clé API manquante',
        'Ajoute la propriété du script GROQ_API_KEY (console.groq.com).',
        SpreadsheetApp.getUi().ButtonSet.OK
      );
    } catch (e) {
      Logger.log('runGroqSeoEnrichSelectedRows: %s', e);
    }
    return;
  }
  try {
    const ss = getSpreadsheet_();
    const sheet = ss.getActiveSheet();
    if (sheet.getName() !== CONFIG.SHEET_NAME) {
      try {
        SpreadsheetApp.getUi().alert(
          'Mauvais onglet',
          'Ouvre l’onglet « ' + CONFIG.SHEET_NAME + ' », sélectionne une ou plusieurs lignes de données, puis relance ⑯.',
          SpreadsheetApp.getUi().ButtonSet.OK
        );
      } catch (e) {
        Logger.log('runGroqSeoEnrichSelectedRows: %s', e);
      }
      return;
    }
    const range = sheet.getActiveRange();
    if (!range) {
      try {
        SpreadsheetApp.getUi().alert('Sélectionne au moins une ligne dans Recipes.');
      } catch (e) {
        Logger.log('runGroqSeoEnrichSelectedRows: %s', e);
      }
      return;
    }
    let r1 = range.getRow();
    let r2 = range.getLastRow();
    if (r1 < 2) {
      r1 = 2;
    }
    if (r2 < r1) {
      try {
        SpreadsheetApp.getUi().alert('Sélection invalide (en-tête seul ?).');
      } catch (e) {
        Logger.log('runGroqSeoEnrichSelectedRows: %s', e);
      }
      return;
    }
    const sleepMs = Math.max(200, parseInt(CONFIG.GEMINI_API_SLEEP_MS, 10) || 2500);
    let done = 0;
    for (let rowNum = r1; rowNum <= r2; rowNum++) {
      try {
        enrichRecipeSheetRowWithGroq_(sheet, rowNum);
        done++;
        logAutomation_(CONFIG.LOG_LEVEL_INFO, 'runGroqSeoEnrichSelectedRows', 'Ligne ' + rowNum + ' OK');
      } catch (e) {
        logAutomation_(CONFIG.LOG_LEVEL_WARN, 'runGroqSeoEnrichSelectedRows', 'Ligne ' + rowNum + ' : ' + String(e));
      }
      if (rowNum < r2) {
        Utilities.sleep(sleepMs);
      }
    }
    try {
      SpreadsheetApp.getUi().alert(
        'Groq SEO',
        'Terminé : ' + done + ' ligne(s) traitée(s) (lignes ' + r1 + '–' + r2 + ').',
        SpreadsheetApp.getUi().ButtonSet.OK
      );
    } catch (e) {
      Logger.log('runGroqSeoEnrichSelectedRows alert: %s', e);
    }
  } catch (e) {
    logAutomation_(CONFIG.LOG_LEVEL_ERROR, 'runGroqSeoEnrichSelectedRows', String(e));
    try {
      SpreadsheetApp.getUi().alert('Erreur', String(e), SpreadsheetApp.getUi().ButtonSet.OK);
    } catch (e2) {
      throw e;
    }
  }
}

/**
 * Menu ⑰ : toutes les lignes Recipes en statut SCHEDULED — uniquement si CONFIG.GEMINI_MANUAL_ENRICH_ALL_SCHEDULED === true.
 */
function runGroqSeoEnrichAllScheduled() {
  logAutomation_(CONFIG.LOG_LEVEL_INFO, 'runGroqSeoEnrichAllScheduled', 'Démarrage');
  if (CONFIG.GEMINI_MANUAL_ENRICH_ALL_SCHEDULED !== true) {
    try {
      SpreadsheetApp.getUi().alert(
        'Mode masse désactivé',
        'Par défaut, seules les nouvelles lignes ajoutées par « ② Récupérer & planifier » sont enrichies automatiquement (avec GROQ_API_KEY).\n\n' +
          'Pour une ligne précise : onglet Recipes, sélectionne-la puis « ⑯ Enrichir SEO (Groq) — lignes sélectionnées ».\n\n' +
          'Pour tout retraiter en SCHEDULED : mets GEMINI_MANUAL_ENRICH_ALL_SCHEDULED à true dans CONFIG puis relance ⑰.',
        SpreadsheetApp.getUi().ButtonSet.OK
      );
    } catch (e) {
      Logger.log('runGroqSeoEnrichAllScheduled gate: %s', e);
    }
    logAutomation_(
      CONFIG.LOG_LEVEL_INFO,
      'runGroqSeoEnrichAllScheduled',
      'Ignoré : GEMINI_MANUAL_ENRICH_ALL_SCHEDULED !== true'
    );
    return;
  }
  if (!getGroqApiKey_()) {
    try {
      SpreadsheetApp.getUi().alert(
        'Clé API manquante',
        'Ajoute la propriété du script GROQ_API_KEY (console.groq.com).',
        SpreadsheetApp.getUi().ButtonSet.OK
      );
    } catch (e) {
      Logger.log('runGroqSeoEnrichAllScheduled UI: %s', e);
    }
    return;
  }
  let confirm = true;
  try {
    const ui = SpreadsheetApp.getUi();
    const r = ui.alert(
      'Groq SEO',
      'Enrichir Title, Instructions et Tags pour toutes les lignes SCHEDULED ? (peut prendre plusieurs minutes)',
      ui.ButtonSet.YES_NO
    );
    confirm = r === ui.Button.YES;
  } catch (e) {
    Logger.log('runGroqSeoEnrichAllScheduled confirm: %s', e);
  }
  if (!confirm) {
    logAutomation_(CONFIG.LOG_LEVEL_INFO, 'runGroqSeoEnrichAllScheduled', 'Annulé par l’utilisateur');
    return;
  }

  try {
    const sheet = getRecipesSheetOrThrow_();
    const last = sheet.getLastRow();
    if (last < 2) {
      try {
        SpreadsheetApp.getUi().alert('Aucune donnée dans Recipes.');
      } catch (e0) {
        Logger.log('runGroqSeoEnrichAllScheduled: %s', e0);
      }
      return;
    }
    const nCol = CONFIG.HEADERS.length;
    const table = sheet.getRange(2, 1, last - 1, nCol).getValues();
    const statusCol = CONFIG.COL.STATUS - 1;
    let done = 0;
    for (let r = 0; r < table.length; r++) {
      if (String(table[r][statusCol] || '').trim() !== CONFIG.STATUS_SCHEDULED) {
        continue;
      }
      const rowNum = r + 2;
      try {
        enrichRecipeSheetRowWithGroq_(sheet, rowNum);
        done++;
        logAutomation_(CONFIG.LOG_LEVEL_INFO, 'runGroqSeoEnrichAllScheduled', 'Ligne ' + rowNum + ' OK');
      } catch (e) {
        logAutomation_(CONFIG.LOG_LEVEL_WARN, 'runGroqSeoEnrichAllScheduled', 'Ligne ' + rowNum + ' : ' + String(e));
      }
      Utilities.sleep(Math.max(200, parseInt(CONFIG.GEMINI_API_SLEEP_MS, 10) || 2500));
    }
    logAutomation_(CONFIG.LOG_LEVEL_INFO, 'runGroqSeoEnrichAllScheduled', 'Terminé : ' + done + ' ligne(s) traitée(s)');
    try {
      SpreadsheetApp.getUi().alert('Groq SEO', 'Terminé : ' + done + ' ligne(s) SCHEDULED enrichie(s).', SpreadsheetApp.getUi().ButtonSet.OK);
    } catch (e) {
      Logger.log('runGroqSeoEnrichAllScheduled alert: %s', e);
    }
  } catch (e) {
    logAutomation_(CONFIG.LOG_LEVEL_ERROR, 'runGroqSeoEnrichAllScheduled', String(e));
    try {
      SpreadsheetApp.getUi().alert('Erreur', String(e), SpreadsheetApp.getUi().ButtonSet.OK);
    } catch (e2) {
      throw e;
    }
  }
}

// ---------------------------------------------------------------------------
// Public entry points
// ---------------------------------------------------------------------------

/**
 * Main daily job: fetch diverse meals, append rows, no duplicate IDs.
 */
function fetchAndScheduleRecipes() {
  logAutomation_(CONFIG.LOG_LEVEL_INFO, 'fetchAndScheduleRecipes', 'Démarrage (cible ' + CONFIG.RECIPES_PER_DAY + ')');
  try {
    const ss = getSpreadsheet_();
    const sheet = ensureRecipesSheet_(ss);
    const existingIds = readExistingIds_(sheet);
    const target = CONFIG.RECIPES_PER_DAY;
    const picked = [];
    const pickedIds = new Set(existingIds);

    const rotationCats = getCategoryRotationList_();
    const startCatIndex = dayRotationIndex_();
    const rotLen = rotationCats.length || CONFIG.CATEGORIES.length;
    for (let i = 0; i < target && picked.length < target; i++) {
      const catName = rotationCats[(startCatIndex + i) % rotLen];
      const id = pickRandomMealIdFromCategory_(catName, pickedIds);
      Utilities.sleep(CONFIG.API_SLEEP_MS);
      if (!id) continue;
      const meal = lookupMealById_(id);
      Utilities.sleep(CONFIG.API_SLEEP_MS);
      if (!meal || pickedIds.has(String(meal.idMeal))) continue;
      picked.push(meal);
      pickedIds.add(String(meal.idMeal));
    }

    let attempts = 0;
    while (picked.length < target && attempts < CONFIG.MAX_RANDOM_ATTEMPTS) {
      attempts++;
      const meal = fetchRandomMeal_();
      Utilities.sleep(CONFIG.API_SLEEP_MS);
      if (!meal || pickedIds.has(String(meal.idMeal))) continue;
      picked.push(meal);
      pickedIds.add(String(meal.idMeal));
    }

    if (picked.length < target) {
      logAutomation_(
        CONFIG.LOG_LEVEL_WARN,
        'fetchAndScheduleRecipes',
        'Seulement ' + picked.length + '/' + target + ' recettes obtenues'
      );
      Logger.log(
        'fetchAndScheduleRecipes: only got %s of %s meals',
        picked.length,
        target
      );
    }

    const slots = getPublishSlots_(picked.length, sheet);
    const added = new Date();
    const rows = picked.map((meal, idx) =>
      mealToRow_(meal, slots[idx], CONFIG.STATUS_SCHEDULED, added)
    );

    if (rows.length) {
      const startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, rows.length, CONFIG.HEADERS.length).setValues(rows);
      if (getGroqApiKey_() && CONFIG.GEMINI_ENRICH_AFTER_FETCH === true) {
        try {
          enrichRecipeSheetRowsWithGroq_(sheet, startRow, rows.length);
          logAutomation_(
            CONFIG.LOG_LEVEL_INFO,
            'fetchAndScheduleRecipes',
            'Groq SEO sur ' + rows.length + ' nouvelle(s) ligne(s) uniquement (lignes ' + startRow + '–' + (startRow + rows.length - 1) + ')'
          );
        } catch (groqE) {
          logAutomation_(
            CONFIG.LOG_LEVEL_WARN,
            'fetchAndScheduleRecipes',
            'Groq SEO partiel ou échoué : ' + String(groqE)
          );
        }
      } else if (!getGroqApiKey_()) {
        logAutomation_(
          CONFIG.LOG_LEVEL_INFO,
          'fetchAndScheduleRecipes',
          'Groq SEO ignoré (propriété GROQ_API_KEY absente)'
        );
      } else {
        logAutomation_(
          CONFIG.LOG_LEVEL_INFO,
          'fetchAndScheduleRecipes',
          'Groq SEO au fetch désactivé (CONFIG.GEMINI_ENRICH_AFTER_FETCH !== true)'
        );
      }
    }

    logAutomation_(
      CONFIG.LOG_LEVEL_INFO,
      'fetchAndScheduleRecipes',
      'OK : ' + rows.length + ' ligne(s) ajoutée(s) sur Recipes'
    );
  } catch (e) {
    logAutomation_(CONFIG.LOG_LEVEL_ERROR, 'fetchAndScheduleRecipes', String(e));
    throw e;
  }
}

/**
 * SCHEDULED → PUBLISHED when Publish Date is on or before now.
 * Lit tout le bloc de données (A→dernière colonne) pour que le nombre de lignes
 * lues = nombre de lignes écrites (évite l’erreur 15 vs 16 si getLastRow /
 * colonnes isolées ou fusions ne sont pas alignés).
 */
function markPublishedRecipes() {
  logAutomation_(CONFIG.LOG_LEVEL_INFO, 'markPublishedRecipes', 'Démarrage');
  try {
    const sheet = getRecipesSheetOrThrow_();
    const last = sheet.getLastRow();
    if (last < 2) {
      logAutomation_(CONFIG.LOG_LEVEL_INFO, 'markPublishedRecipes', 'Aucune ligne données');
      return;
    }

    const nCol = CONFIG.HEADERS.length;
    const statusCol = CONFIG.COL.STATUS;
    const dateCol = CONFIG.COL.PUBLISH_DATE;

    const rowCount = last - 1; // exclude header
    const table = sheet.getRange(2, 1, rowCount, nCol).getValues();
    const now = new Date();
    const updates = [];
    let publishedCount = 0;

    for (let r = 0; r < table.length; r++) {
      const st = String(table[r][statusCol - 1] || '');
      const pub = parseSheetDate_(table[r][dateCol - 1]);
      if (st !== CONFIG.STATUS_SCHEDULED || !pub) {
        updates.push([st]);
        continue;
      }
      if (pub.getTime() <= now.getTime()) {
        updates.push([CONFIG.STATUS_PUBLISHED]);
        publishedCount++;
      } else {
        updates.push([st]);
      }
    }

    if (updates.length !== table.length) {
      logAutomation_(
        CONFIG.LOG_LEVEL_ERROR,
        'markPublishedRecipes',
        'Échec : incohérence lignes table=' + table.length + ' / updates=' + updates.length
      );
      Logger.log(
        'markPublishedRecipes: mismatch table=%s updates=%s',
        table.length,
        updates.length
      );
      return;
    }

    // Safe write: exact same number of rows/cols as computed updates.
    if (!updates.length) {
      logAutomation_(CONFIG.LOG_LEVEL_INFO, 'markPublishedRecipes', 'Aucune ligne à mettre à jour');
      return;
    }
    sheet.getRange(2, statusCol, updates.length, 1).setValues(updates);

    logAutomation_(
      CONFIG.LOG_LEVEL_INFO,
      'markPublishedRecipes',
      'OK : ' + publishedCount + ' passage(s) SCHEDULED → PUBLISHED'
    );
  } catch (e) {
    logAutomation_(CONFIG.LOG_LEVEL_ERROR, 'markPublishedRecipes', String(e));
    throw e;
  }
}

/**
 * Date depuis une cellule Sheet : objet Date, serial nombre, ou chaîne.
 */
function parseSheetDate_(v) {
  if (v instanceof Date && !isNaN(v.getTime())) return v;
  if (typeof v === 'number' && !isNaN(v)) {
    const utc = Date.UTC(1899, 11, 30) + Math.round(v * 86400000);
    return new Date(utc);
  }
  if (typeof v === 'string' && String(v).trim()) {
    const d = new Date(v);
    if (!isNaN(d.getTime())) return d;
  }
  return null;
}

/**
 * Token + repo : propriétés du script (priorité) puis CONFIG.
 * Propriétés : GITHUB_TOKEN, GITHUB_REPO (même format owner/repo).
 */
function getGitHubCredentials_() {
  const props = PropertiesService.getScriptProperties();
  const token = (props.getProperty('GITHUB_TOKEN') || CONFIG.GITHUB_TOKEN || '').trim();
  const repo = (props.getProperty('GITHUB_REPO') || CONFIG.GITHUB_REPO || '').trim();
  return { token, repo };
}

/**
 * Optional: push recipes.json to GitHub. Runs only if token + repo set.
 */
function pushRecipesToGitHub() {
  const gh = getGitHubCredentials_();
  if (!gh.token || !gh.repo) {
    logAutomation_(
      CONFIG.LOG_LEVEL_WARN,
      'pushRecipesToGitHub',
      'Ignoré : renseigne GITHUB_TOKEN + GITHUB_REPO (CONFIG ou Propriétés du script)'
    );
    Logger.log('pushRecipesToGitHub: skipped (no token or repo).');
    return;
  }

  logAutomation_(
    CONFIG.LOG_LEVEL_INFO,
    'pushRecipesToGitHub',
    'Démarrage PUT ' + CONFIG.GITHUB_FILE + ' + ' + CONFIG.GITHUB_SITEMAP_FILE
  );
  const sheet = getRecipesSheetOrThrow_();
  const payload = buildExportPayload_(sheet);
  if (!payload.recipes || payload.recipes.length === 0) {
    logAutomation_(
      CONFIG.LOG_LEVEL_WARN,
      'pushRecipesToGitHub',
      'Push annulé : 0 ligne PUBLISHED à exporter (dates futures ? ou feuille vide). Le SEO gate ne bloque plus l’export — vérifie statuts / Publish Date.'
    );
    return;
  }
  const [owner, repo] = parseRepo_(gh.repo);
  const tz = getTimezone_();
  const dayStamp = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  const recipesJson = JSON.stringify(payload, null, 2);
  const sitemapXml = buildSitemapXmlFromPayload_(payload);

  const commitMsg = '🍽️ Akkous recipes + sitemap — ' + dayStamp;
  const ok = gitPushRecipesAndSitemapOneCommit_(owner, repo, recipesJson, sitemapXml, commitMsg, gh.token);

  if (ok) {
    logAutomation_(
      CONFIG.LOG_LEVEL_INFO,
      'pushRecipesToGitHub',
      'OK : recipes.json + sitemap.xml (1 commit) sur GitHub — un seul déploiement Pages'
    );
  }
}

/**
 * Un commit Git contenant recipes.json et sitemap.xml.
 * Évite deux commits successifs qui déclenchent deux workflows GitHub Pages ;
 * le second annulait souvent le premier (« Canceling since a higher priority waiting request… »).
 */
function gitPushRecipesAndSitemapOneCommit_(owner, repo, recipesJson, sitemapXml, message, token) {
  const branch = String(CONFIG.GITHUB_BRANCH || 'main').trim() || 'main';
  const apiRoot = 'https://api.github.com/repos/' + encodeURIComponent(owner) + '/' + encodeURIComponent(repo);
  const headers = {
    Authorization: 'Bearer ' + token,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  function ghGet(url) {
    return UrlFetchApp.fetch(url, { method: 'get', muteHttpExceptions: true, headers: headers });
  }
  function ghPost(url, payload) {
    return UrlFetchApp.fetch(url, {
      method: 'post',
      muteHttpExceptions: true,
      contentType: 'application/json',
      headers: headers,
      payload: JSON.stringify(payload),
    });
  }
  function ghPatch(url, payload) {
    return UrlFetchApp.fetch(url, {
      method: 'patch',
      muteHttpExceptions: true,
      contentType: 'application/json',
      headers: headers,
      payload: JSON.stringify(payload),
    });
  }

  try {
    // GET = /git/ref/... (singulier) ; PATCH = /git/refs/... (pluriel) — sinon PATCH renvoie 404.
    const refUrlGet = apiRoot + '/git/ref/heads/' + encodeURIComponent(branch);
    const refUrlPatch = apiRoot + '/git/refs/heads/' + encodeURIComponent(branch);
    const refRes = ghGet(refUrlGet);
    if (refRes.getResponseCode() !== 200) {
      logAutomation_(
        CONFIG.LOG_LEVEL_ERROR,
        'gitPushRecipesAndSitemapOneCommit_',
        'GET ref ' + branch + ' HTTP ' + refRes.getResponseCode() + ' — ' + refRes.getContentText().slice(0, 400)
      );
      return false;
    }
    const parentCommitSha = JSON.parse(refRes.getContentText()).object.sha;

    const commitRes = ghGet(apiRoot + '/git/commits/' + parentCommitSha);
    if (commitRes.getResponseCode() !== 200) {
      logAutomation_(
        CONFIG.LOG_LEVEL_ERROR,
        'gitPushRecipesAndSitemapOneCommit_',
        'GET commit HTTP ' + commitRes.getResponseCode()
      );
      return false;
    }
    const baseTreeSha = JSON.parse(commitRes.getContentText()).tree.sha;

    const treePayload = {
      base_tree: baseTreeSha,
      tree: [
        {
          path: CONFIG.GITHUB_FILE.replace(/^\//, ''),
          mode: '100644',
          type: 'blob',
          content: String(recipesJson || ''),
        },
        {
          path: CONFIG.GITHUB_SITEMAP_FILE.replace(/^\//, ''),
          mode: '100644',
          type: 'blob',
          content: String(sitemapXml || ''),
        },
      ],
    };
    const treeHttp = ghPost(apiRoot + '/git/trees', treePayload);
    if (treeHttp.getResponseCode() !== 201) {
      logAutomation_(
        CONFIG.LOG_LEVEL_ERROR,
        'gitPushRecipesAndSitemapOneCommit_',
        'POST tree HTTP ' + treeHttp.getResponseCode() + ' — ' + treeHttp.getContentText().slice(0, 500)
      );
      return false;
    }
    const newTreeSha = JSON.parse(treeHttp.getContentText()).sha;

    const commitPayload = {
      message: message,
      tree: newTreeSha,
      parents: [parentCommitSha],
    };
    const newCommitRes = ghPost(apiRoot + '/git/commits', commitPayload);
    if (newCommitRes.getResponseCode() !== 201) {
      logAutomation_(
        CONFIG.LOG_LEVEL_ERROR,
        'gitPushRecipesAndSitemapOneCommit_',
        'POST commit HTTP ' + newCommitRes.getResponseCode() + ' — ' + newCommitRes.getContentText().slice(0, 500)
      );
      return false;
    }
    const newCommitSha = JSON.parse(newCommitRes.getContentText()).sha;

    const updateRefPayload = { sha: newCommitSha };
    const patchRes = ghPatch(refUrlPatch, updateRefPayload);
    if (patchRes.getResponseCode() !== 200) {
      logAutomation_(
        CONFIG.LOG_LEVEL_ERROR,
        'gitPushRecipesAndSitemapOneCommit_',
        'PATCH ref HTTP ' + patchRes.getResponseCode() + ' — ' + patchRes.getContentText().slice(0, 500)
      );
      return false;
    }
    return true;
  } catch (e) {
    logAutomation_(CONFIG.LOG_LEVEL_ERROR, 'gitPushRecipesAndSitemapOneCommit_', String(e));
    return false;
  }
}

function putTextFileToGitHub_(owner, repo, path, text, message, token) {
  const cleanPath = String(path || '').replace(/^\//, '');
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${encodeURIComponent(cleanPath)}`;
  const content = Utilities.base64Encode(
    Utilities.newBlob(String(text || ''), 'text/plain', 'UTF-8').getBytes()
  );

  let sha = '';
  try {
    const getRes = UrlFetchApp.fetch(apiUrl, {
      method: 'get',
      muteHttpExceptions: true,
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
    });
    if (getRes.getResponseCode() === 200) {
      const body = JSON.parse(getRes.getContentText());
      sha = body.sha || '';
    }
  } catch (e) {
    logAutomation_(CONFIG.LOG_LEVEL_WARN, 'putTextFileToGitHub_', 'GET SHA ' + cleanPath + ' : ' + e);
    Logger.log('putTextFileToGitHub_ GET error [%s]: %s', cleanPath, e);
  }

  const putBody = { message, content };
  if (sha) putBody.sha = sha;

  try {
    const putRes = UrlFetchApp.fetch(apiUrl, {
      method: 'put',
      muteHttpExceptions: true,
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + token,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      payload: JSON.stringify(putBody),
    });
    const code = putRes.getResponseCode();
    if (code !== 200 && code !== 201) {
      logAutomation_(
        CONFIG.LOG_LEVEL_ERROR,
        'putTextFileToGitHub_',
        'PUT ' + cleanPath + ' HTTP ' + code + ' — ' + putRes.getContentText().slice(0, 500)
      );
      Logger.log('putTextFileToGitHub_ PUT failed %s: %s', code, putRes.getContentText());
      return false;
    }
    return true;
  } catch (e) {
    logAutomation_(CONFIG.LOG_LEVEL_ERROR, 'putTextFileToGitHub_', 'PUT ' + cleanPath + ' : ' + e);
    Logger.log('putTextFileToGitHub_ PUT error [%s]: %s', cleanPath, e);
    return false;
  }
}

/**
 * URL canonique SEO d’une fiche recette.
 *
 * Ancien format (à ne plus utiliser) : base + '/recipe.html?id=' + encodeURIComponent(id)
 * Format actuel (site + générateur Node) : base + '/recipes/' + id + '/'
 * → fichier servi : recipes/<id>/index.html sur GitHub Pages (slash final = même logique que main.js / recipeUrl).
 *
 * Ne pas utiliser '/recipes/<id>.html' : ce fichier n’existe pas dans ce projet.
 */
function recipeSeoUrl_(base, id) {
  const b = String(base || '')
    .trim()
    .replace(/\/+$/, '');
  const slug = String(id || '').trim();
  return b + '/recipes/' + encodeURIComponent(slug) + '/';
}

/**
 * Sitemap XML poussé avec recipes.json (pushRecipesToGitHub).
 * Les entrées recettes utilisent recipeSeoUrl_ (URLs statiques /recipes/{id}/).
 */
function buildSitemapXmlFromPayload_(payload) {
  const site = payload && payload.site ? payload.site : {};
  const recipes = payload && Array.isArray(payload.recipes) ? payload.recipes : [];
  const base =
    String(site.canonicalOrigin || CONFIG.SITE_ORIGIN || 'https://akkous.com')
      .trim()
      .replace(/\/+$/, '') || 'https://akkous.com';

  const lines = [];
  lines.push('<?xml version="1.0" encoding="UTF-8"?>');
  lines.push('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">');
  lines.push('  <url>');
  lines.push('    <loc>' + xmlEscape_(base + '/') + '</loc>');
  lines.push('    <changefreq>daily</changefreq>');
  lines.push('    <priority>1.0</priority>');
  lines.push('  </url>');

  const staticPages = [
    '/conditions-utilisation.html',
    '/politique-confidentialite.html',
    '/contact.html',
  ];
  staticPages.forEach((p) => {
    lines.push('  <url>');
    lines.push('    <loc>' + xmlEscape_(base + p) + '</loc>');
    lines.push('    <changefreq>monthly</changefreq>');
    lines.push('    <priority>0.5</priority>');
    lines.push('  </url>');
  });

  recipes.forEach((r) => {
    const pathSeg = String((r && (r.slug || r.id)) || '').trim();
    if (!pathSeg) return;
    const loc = recipeSeoUrl_(base, pathSeg);
    const lastmod = normalizeIsoDate_(r && (r.datePublished || r.publishDate));
    lines.push('  <url>');
    lines.push('    <loc>' + xmlEscape_(loc) + '</loc>');
    if (lastmod) lines.push('    <lastmod>' + xmlEscape_(lastmod) + '</lastmod>');
    lines.push('  </url>');
  });

  lines.push('</urlset>');
  return lines.join('\n');
}

function normalizeIsoDate_(v) {
  if (v == null) return '';
  const s = String(v).trim();
  if (!s) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) return s.slice(0, 10);
  const d = new Date(s);
  if (isNaN(d.getTime())) return '';
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return y + '-' + m + '-' + day;
}

function xmlEscape_(s) {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// ---------------------------------------------------------------------------
// Google Search Console / Indexing API
// ---------------------------------------------------------------------------

const GSC_INDEXED_IDS_PROP_ = 'GSC_INDEXED_RECIPE_IDS';
const GSC_INDEXED_MAX_IDS_ = 5000;

function submitDailyIndexingBatchToGsc() {
  if (!CONFIG.GSC_INDEXING_ENABLED) {
    logAutomation_(
      CONFIG.LOG_LEVEL_INFO,
      'submitDailyIndexingBatchToGsc',
      'Ignoré : CONFIG.GSC_INDEXING_ENABLED=false'
    );
    return;
  }

  const count = Math.max(1, parseInt(CONFIG.GSC_DAILY_INDEX_COUNT, 10) || 5);
  logAutomation_(
    CONFIG.LOG_LEVEL_INFO,
    'submitDailyIndexingBatchToGsc',
    'Démarrage batch indexation (max ' + count + ' URL)'
  );

  const auth = getGscServiceAccountCredentials_();
  if (!auth.clientEmail || !auth.privateKey) {
    logAutomation_(
      CONFIG.LOG_LEVEL_WARN,
      'submitDailyIndexingBatchToGsc',
      'Ignoré : définir GSC_CLIENT_EMAIL + GSC_PRIVATE_KEY (Propriétés du script)'
    );
    return;
  }

  const sheet = getRecipesSheetOrThrow_();
  const payload = buildExportPayload_(sheet);
  const candidates = getPublishedRecipeCandidatesForIndexing_(payload);
  if (!candidates.length) {
    logAutomation_(
      CONFIG.LOG_LEVEL_INFO,
      'submitDailyIndexingBatchToGsc',
      'Aucune URL publiée à indexer'
    );
    return;
  }

  let token = '';
  try {
    token = fetchGoogleAccessTokenWithServiceAccount_(auth.clientEmail, auth.privateKey, CONFIG.GSC_SCOPE);
  } catch (e) {
    logAutomation_(
      CONFIG.LOG_LEVEL_ERROR,
      'submitDailyIndexingBatchToGsc',
      'Token OAuth impossible : ' + e
    );
    return;
  }

  const already = getIndexedRecipeIdsSet_();
  const toSend = [];
  const fallback = [];
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i];
    if (!already[c.id]) toSend.push(c);
    else fallback.push(c);
    if (toSend.length >= count) break;
  }
  if (toSend.length < count) {
    for (let j = 0; j < fallback.length && toSend.length < count; j++) {
      toSend.push(fallback[j]);
    }
  }

  let ok = 0;
  let ko = 0;
  const sentIds = [];
  for (let k = 0; k < toSend.length; k++) {
    const item = toSend[k];
    const done = notifyUrlUpdatedToIndexingApi_(item.url, token);
    if (done) {
      ok++;
      sentIds.push(item.id);
    } else {
      ko++;
    }
    Utilities.sleep(CONFIG.API_SLEEP_MS);
  }

  if (sentIds.length) rememberIndexedRecipeIds_(sentIds);

  logAutomation_(
    CONFIG.LOG_LEVEL_INFO,
    'submitDailyIndexingBatchToGsc',
    'Terminé : ' + ok + ' OK, ' + ko + ' erreur(s), ' + toSend.length + ' tentative(s)'
  );
}

function getGscServiceAccountCredentials_() {
  const props = PropertiesService.getScriptProperties();
  const clientEmail = (
    props.getProperty('GSC_CLIENT_EMAIL') ||
    CONFIG.GSC_CLIENT_EMAIL ||
    ''
  ).trim();
  let privateKey = props.getProperty('GSC_PRIVATE_KEY') || CONFIG.GSC_PRIVATE_KEY || '';
  privateKey = String(privateKey).replace(/\\n/g, '\n').trim();
  return { clientEmail, privateKey };
}

function fetchGoogleAccessTokenWithServiceAccount_(clientEmail, privateKey, scope) {
  const nowSec = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claims = {
    iss: clientEmail,
    scope: scope,
    aud: 'https://oauth2.googleapis.com/token',
    iat: nowSec,
    exp: nowSec + 3600,
  };
  const headerB64 = base64UrlEncode_(JSON.stringify(header));
  const claimsB64 = base64UrlEncode_(JSON.stringify(claims));
  const unsignedJwt = headerB64 + '.' + claimsB64;
  const sigBytes = Utilities.computeRsaSha256Signature(unsignedJwt, privateKey);
  const sig = base64UrlEncodeBytes_(sigBytes);
  const assertion = unsignedJwt + '.' + sig;

  const res = UrlFetchApp.fetch('https://oauth2.googleapis.com/token', {
    method: 'post',
    muteHttpExceptions: true,
    payload: {
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: assertion,
    },
  });
  const code = res.getResponseCode();
  const text = res.getContentText();
  if (code !== 200) {
    throw new Error('HTTP ' + code + ' — ' + text.slice(0, 300));
  }
  const body = JSON.parse(text);
  if (!body.access_token) {
    throw new Error('Réponse OAuth sans access_token');
  }
  return String(body.access_token);
}

function notifyUrlUpdatedToIndexingApi_(url, accessToken) {
  try {
    const res = UrlFetchApp.fetch('https://indexing.googleapis.com/v3/urlNotifications:publish', {
      method: 'post',
      muteHttpExceptions: true,
      contentType: 'application/json',
      headers: {
        Authorization: 'Bearer ' + accessToken,
      },
      payload: JSON.stringify({
        url: url,
        type: 'URL_UPDATED',
      }),
    });
    const code = res.getResponseCode();
    if (code !== 200) {
      logAutomation_(
        CONFIG.LOG_LEVEL_WARN,
        'notifyUrlUpdatedToIndexingApi_',
        'HTTP ' + code + ' for ' + url + ' — ' + res.getContentText().slice(0, 300)
      );
      return false;
    }
    return true;
  } catch (e) {
    logAutomation_(
      CONFIG.LOG_LEVEL_WARN,
      'notifyUrlUpdatedToIndexingApi_',
      'Erreur URL ' + url + ' : ' + e
    );
    return false;
  }
}

/**
 * Candidats pour submitDailyIndexingBatchToGsc : recettes déjà publiées (date passée).
 * Chaque entrée.url = recipeSeoUrl_ (page statique), pour l’Indexing API.
 *
 * Le suivi « déjà envoyé » reste par id recette (propriété GSC_INDEXED_RECIPE_IDS).
 * Si le quota du jour n’est pas rempli, le script peut retenter des ids déjà connus
 * (fallback) : l’URL notifiée est alors la nouvelle URL canonique (même id, URL à jour).
 */
function getPublishedRecipeCandidatesForIndexing_(payload) {
  const site = payload && payload.site ? payload.site : {};
  const recipes = payload && Array.isArray(payload.recipes) ? payload.recipes : [];
  const base =
    String(site.canonicalOrigin || CONFIG.SITE_ORIGIN || 'https://akkous.com')
      .trim()
      .replace(/\/+$/, '');
  const now = new Date().getTime();
  const out = [];
  recipes.forEach((r) => {
    const id = String((r && r.id) || '').trim();
    if (!id) return;
    const pathSeg = String((r && (r.slug || r.id)) || '').trim() || id;
    const t = publishTimestampMs_(r);
    if (t && t > now) return;
    out.push({
      id: id,
      t: t,
      url: recipeSeoUrl_(base, pathSeg),
    });
  });
  out.sort((a, b) => {
    if (a.t !== b.t) return b.t - a.t;
    return a.id.localeCompare(b.id);
  });
  return out;
}

function publishTimestampMs_(recipe) {
  const raw = (recipe && (recipe.publishDate || recipe.datePublished)) || '';
  const s = String(raw || '').trim();
  if (!s) return 0;
  try {
    const d = new Date(s.length === 10 ? s + 'T12:00:00' : s);
    const t = d.getTime();
    return isNaN(t) ? 0 : t;
  } catch (e) {
    return 0;
  }
}

function getIndexedRecipeIdsSet_() {
  const props = PropertiesService.getScriptProperties();
  const raw = props.getProperty(GSC_INDEXED_IDS_PROP_) || '[]';
  let arr = [];
  try {
    arr = JSON.parse(raw);
  } catch (e) {
    arr = [];
  }
  const set = {};
  if (Array.isArray(arr)) {
    arr.forEach((id) => {
      const s = String(id || '').trim();
      if (s) set[s] = true;
    });
  }
  return set;
}

function rememberIndexedRecipeIds_(ids) {
  const props = PropertiesService.getScriptProperties();
  const oldSet = getIndexedRecipeIdsSet_();
  ids.forEach((id) => {
    const s = String(id || '').trim();
    if (s) oldSet[s] = true;
  });
  const all = Object.keys(oldSet).slice(-GSC_INDEXED_MAX_IDS_);
  props.setProperty(GSC_INDEXED_IDS_PROP_, JSON.stringify(all));
}

function base64UrlEncode_(s) {
  return Utilities.base64EncodeWebSafe(
    Utilities.newBlob(String(s), 'application/json').getBytes()
  ).replace(/=+$/g, '');
}

function base64UrlEncodeBytes_(bytes) {
  return Utilities.base64EncodeWebSafe(bytes).replace(/=+$/g, '');
}

/**
 * Recettes PUBLISHED plus vieilles que CLEANUP_DAYS : copie vers RecipesArchive puis suppression dans Recipes.
 */
function cleanOldRecipes() {
  logAutomation_(CONFIG.LOG_LEVEL_INFO, 'cleanOldRecipes', 'Démarrage (> ' + CONFIG.CLEANUP_DAYS + ' j)');
  try {
    const sheet = getRecipesSheetOrThrow_();
    const last = sheet.getLastRow();
    if (last < 2) {
      logAutomation_(CONFIG.LOG_LEVEL_INFO, 'cleanOldRecipes', 'Rien à nettoyer');
      return;
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - CONFIG.CLEANUP_DAYS);

    const dateCol = CONFIG.COL.PUBLISH_DATE;
    const statusCol = CONFIG.COL.STATUS;
    const nCol = CONFIG.HEADERS.length;
    const rowCount = last - 1; // exclude header
    const dates = sheet.getRange(2, dateCol, rowCount, 1).getValues();
    const statuses = sheet.getRange(2, statusCol, rowCount, 1).getValues();

    const ss = sheet.getParent();
    const archive = ensureRecipesArchiveSheet_(ss);

    let archived = 0;
    for (let r = dates.length - 1; r >= 0; r--) {
      const st = String(statuses[r][0] || '');
      const pub = dates[r][0];
      if (st !== CONFIG.STATUS_PUBLISHED || !(pub instanceof Date)) continue;
      if (pub.getTime() < cutoff.getTime()) {
        const rowNum = r + 2;
        const rowVals = sheet.getRange(rowNum, 1, 1, nCol).getValues();
        archive.appendRow(rowVals[0]);
        sheet.deleteRow(rowNum);
        archived++;
      }
    }

    logAutomation_(
      CONFIG.LOG_LEVEL_INFO,
      'cleanOldRecipes',
      'OK : ' + archived + ' ligne(s) archivée(s) dans « ' + CONFIG.RECIPES_ARCHIVE_SHEET_NAME + ' » puis retirée(s) de Recipes'
    );
  } catch (e) {
    logAutomation_(CONFIG.LOG_LEVEL_ERROR, 'cleanOldRecipes', String(e));
    throw e;
  }
}

/**
 * Logs one random full recipe for debugging.
 */
function testFetch() {
  logAutomation_(CONFIG.LOG_LEVEL_INFO, 'testFetch', 'Démarrage');
  const meal = fetchRandomMeal_();
  Utilities.sleep(CONFIG.API_SLEEP_MS);
  if (!meal) {
    logAutomation_(CONFIG.LOG_LEVEL_WARN, 'testFetch', 'Aucune recette renvoyée');
    Logger.log('testFetch: no meal returned');
    return;
  }
  logAutomation_(
    CONFIG.LOG_LEVEL_INFO,
    'testFetch',
    'OK : ' + (meal.strMeal || meal.idMeal || 'recette') + ' (voir Journal d’exécution pour le JSON)'
  );
  Logger.log(JSON.stringify(meal));
}

// ---------------------------------------------------------------------------
// TheMealDB
// ---------------------------------------------------------------------------

/** Clés properties pour le cache de categories.php */
const THE_MEALDB_CAT_CACHE_JSON_KEY_ = 'THE_MEALDB_CATEGORIES_JSON';
const THE_MEALDB_CAT_CACHE_MS_KEY_ = 'THE_MEALDB_CATEGORIES_FETCHED_MS';

/**
 * Lit categories.php (TheMealDB) et renvoie les strCategory dans l’ordre API.
 * @returns {string[]|null}
 */
function fetchTheMealDbCategoryNamesFromApi_() {
  const url = `${CONFIG.API_BASE}categories.php`;
  let text = '';
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    text = res.getContentText();
  } catch (e) {
    logAutomation_(
      CONFIG.LOG_LEVEL_WARN,
      'fetchTheMealDbCategoryNamesFromApi_',
      'fetch: ' + String(e)
    );
    return null;
  }
  try {
    const data = JSON.parse(text);
    const cats = data.categories;
    if (!cats || !cats.length) return null;
    return cats
      .map((c) => String(c.strCategory || '').trim())
      .filter(Boolean);
  } catch (e) {
    logAutomation_(
      CONFIG.LOG_LEVEL_WARN,
      'fetchTheMealDbCategoryNamesFromApi_',
      'parse: ' + String(e)
    );
    return null;
  }
}

/**
 * Liste utilisée pour la rotation fetch + export JSON (taxonomie site).
 * Met en cache les résultats de categories.php (TTL CONFIG.CATEGORIES_API_CACHE_HOURS).
 * @returns {string[]}
 */
function getCategoryRotationList_() {
  const props = PropertiesService.getScriptProperties();
  const ttlMs =
    Math.max(1, parseInt(String(CONFIG.CATEGORIES_API_CACHE_HOURS), 10) || 168) *
    60 *
    60 *
    1000;
  const now = Date.now();
  const raw = props.getProperty(THE_MEALDB_CAT_CACHE_JSON_KEY_);
  const ts = parseInt(props.getProperty(THE_MEALDB_CAT_CACHE_MS_KEY_) || '0', 10);
  if (raw && ts && now - ts < ttlMs) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr;
    } catch (e) {
      /* ignore */
    }
  }

  const fromApi = fetchTheMealDbCategoryNamesFromApi_();
  if (fromApi && fromApi.length) {
    props.setProperty(THE_MEALDB_CAT_CACHE_JSON_KEY_, JSON.stringify(fromApi));
    props.setProperty(THE_MEALDB_CAT_CACHE_MS_KEY_, String(now));
    logAutomation_(
      CONFIG.LOG_LEVEL_INFO,
      'getCategoryRotationList_',
      'Catégories TheMealDB synchronisées (' + fromApi.length + ') via categories.php'
    );
    return fromApi;
  }

  if (raw) {
    try {
      const arr = JSON.parse(raw);
      if (Array.isArray(arr) && arr.length) return arr;
    } catch (e) {
      /* ignore */
    }
  }
  return CONFIG.CATEGORIES.slice();
}

function pickRandomMealIdFromCategory_(categoryName, excludeIds) {
  const enc = encodeURIComponent(categoryName);
  const url = `${CONFIG.API_BASE}filter.php?c=${enc}`;
  let text = '';
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    text = res.getContentText();
  } catch (e) {
    Logger.log('filter.php error [%s]: %s', categoryName, e);
    return null;
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    Logger.log('filter.php parse error [%s]: %s', categoryName, e);
    return null;
  }

  const meals = data.meals;
  if (!meals || !meals.length) return null;

  const candidates = meals.filter((m) => m && !excludeIds.has(String(m.idMeal)));
  const pool = candidates.length ? candidates : [];
  if (!pool.length) return null;

  const pick = pool[Math.floor(Math.random() * pool.length)];
  return pick.idMeal ? String(pick.idMeal) : null;
}

function lookupMealById_(idMeal) {
  const url = `${CONFIG.API_BASE}lookup.php?i=${encodeURIComponent(idMeal)}`;
  let text = '';
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    text = res.getContentText();
  } catch (e) {
    Logger.log('lookup.php error [%s]: %s', idMeal, e);
    return null;
  }

  try {
    const data = JSON.parse(text);
    if (data.meals && data.meals[0]) return data.meals[0];
  } catch (e) {
    Logger.log('lookup.php parse error: %s', e);
  }
  return null;
}

function fetchRandomMeal_() {
  const url = `${CONFIG.API_BASE}random.php`;
  let text = '';
  try {
    const res = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
    text = res.getContentText();
  } catch (e) {
    Logger.log('random.php error: %s', e);
    return null;
  }

  try {
    const data = JSON.parse(text);
    if (data.meals && data.meals[0]) return data.meals[0];
  } catch (e) {
    Logger.log('random.php parse error: %s', e);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Sheet helpers
// ---------------------------------------------------------------------------

function getSpreadsheet_() {
  if (CONFIG.SHEET_ID) {
    return SpreadsheetApp.openById(CONFIG.SHEET_ID);
  }
  const propId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (propId && propId.trim()) {
    return SpreadsheetApp.openById(propId.trim());
  }
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  throw new Error(
    'Classeur introuvable : renseigne CONFIG.SHEET_ID ou une propriété du script SPREADSHEET_ID (ID dans l’URL du Sheet). Nécessaire pour le rapport ouvert en Web App (doGet).'
  );
}

function getTimezone_() {
  return CONFIG.TIMEZONE || Session.getScriptTimeZone();
}

function getRecipesSheetOrThrow_() {
  const ss = getSpreadsheet_();
  const sh = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (!sh) {
    throw new Error('Sheet "' + CONFIG.SHEET_NAME + '" not found. Run fetchAndScheduleRecipes first.');
  }
  return sh;
}

function ensureRecipesSheet_(ss) {
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME);
  if (sheet) return sheet;

  sheet = ss.insertSheet(CONFIG.SHEET_NAME);
  const headerRange = sheet.getRange(1, 1, 1, CONFIG.HEADERS.length);
  headerRange.setValues([CONFIG.HEADERS]);
  headerRange.setFontWeight('bold');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setBackground('#E8572A');
  sheet.setFrozenRows(1);

  const widths = [100, 220, 100, 100, 280, 360, 320, 160, 150, 100, 200, 220, 150];
  for (let c = 0; c < widths.length; c++) {
    sheet.setColumnWidth(c + 1, widths[c]);
  }

  return sheet;
}

/**
 * Feuille d’archivage : créée si absente, en-têtes identiques à Recipes.
 */
function ensureRecipesArchiveSheet_(ss) {
  const name = String(CONFIG.RECIPES_ARCHIVE_SHEET_NAME || 'RecipesArchive').trim() || 'RecipesArchive';
  let sheet = ss.getSheetByName(name);
  if (sheet) return sheet;

  sheet = ss.insertSheet(name);
  const headerRange = sheet.getRange(1, 1, 1, CONFIG.HEADERS.length);
  headerRange.setValues([CONFIG.HEADERS]);
  headerRange.setFontWeight('bold');
  headerRange.setFontColor('#FFFFFF');
  headerRange.setBackground('#5C4033');
  sheet.setFrozenRows(1);
  logAutomation_(CONFIG.LOG_LEVEL_INFO, 'ensureRecipesArchiveSheet_', 'Feuille « ' + name + ' » créée');
  return sheet;
}

function readExistingIds_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return new Set();

  const rowCount = last - 1; // exclude header
  const ids = sheet.getRange(2, CONFIG.COL.ID, rowCount, 1).getValues();
  const set = new Set();
  ids.forEach((row) => {
    if (row[0] !== '' && row[0] != null) set.add(String(row[0]));
  });
  return set;
}

function dayRotationIndex_() {
  const cats = getCategoryRotationList_();
  const n = cats.length || CONFIG.CATEGORIES.length;
  const tz = getTimezone_();
  const ymd = Utilities.formatDate(new Date(), tz, 'yyyy-MM-dd');
  let hash = 0;
  for (let i = 0; i < ymd.length; i++) {
    hash = (hash * 31 + ymd.charCodeAt(i)) >>> 0;
  }
  return hash % n;
}

/**
 * @param {number} count
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 */
function getPublishSlots_(count, sheet) {
  if (CONFIG.PUBLISH_STAGGER === 'day') {
    return getPublishSlotsByDay_(count, sheet);
  }
  if (CONFIG.PUBLISH_STAGGER === 'batch') {
    return getPublishSlotsByBatchDay_(count, sheet);
  }
  return getPublishSlotsByHour_(count);
}

/** Demain (calendrier) à PUBLISH_HOUR, puis +1h par recette. */
function getPublishSlotsByHour_(count) {
  const tz = getTimezone_();
  const now = new Date();
  const stamp = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  const parts = stamp.split('-');
  const baseLocal = new Date(
    parseInt(parts[0], 10),
    parseInt(parts[1], 10) - 1,
    parseInt(parts[2], 10) + 1,
    CONFIG.PUBLISH_HOUR,
    0,
    0,
    0
  );

  const slots = [];
  for (let i = 0; i < count; i++) {
    slots.push(new Date(baseLocal.getTime() + i * 60 * 60 * 1000));
  }
  return slots;
}

/**
 * Une date par recette : enchaîne après la dernière ligne SCHEDULED,
 * sinon à partir de demain à PUBLISH_HOUR.
 */
function getPublishSlotsByDay_(count, sheet) {
  const maxSched = getMaxScheduledPublishDate_(sheet);
  const tomorrowAtHour = getTomorrowAtPublishHour_();
  let cursor;
  if (!maxSched) {
    cursor = tomorrowAtHour;
  } else {
    const nextAfterMax = new Date(
      maxSched.getFullYear(),
      maxSched.getMonth(),
      maxSched.getDate() + 1,
      CONFIG.PUBLISH_HOUR,
      0,
      0,
      0
    );
    cursor =
      nextAfterMax.getTime() > tomorrowAtHour.getTime()
        ? nextAfterMax
        : tomorrowAtHour;
  }

  const slots = [];
  for (let i = 0; i < count; i++) {
    slots.push(
      new Date(
        cursor.getFullYear(),
        cursor.getMonth(),
        cursor.getDate() + i,
        CONFIG.PUBLISH_HOUR,
        0,
        0,
        0
      )
    );
  }
  return slots;
}

/**
 * Même date et heure (PUBLISH_HOUR) pour chaque recette du lot : prochain “jour
 * de publication” après le max SCHEDULED existant (ou demain), puis count copies.
 */
function getPublishSlotsByBatchDay_(count, sheet) {
  const maxSched = getMaxScheduledPublishDate_(sheet);
  const tomorrowAtHour = getTomorrowAtPublishHour_();
  let cursor;
  if (!maxSched) {
    cursor = tomorrowAtHour;
  } else {
    const nextAfterMax = new Date(
      maxSched.getFullYear(),
      maxSched.getMonth(),
      maxSched.getDate() + 1,
      CONFIG.PUBLISH_HOUR,
      0,
      0,
      0
    );
    cursor =
      nextAfterMax.getTime() > tomorrowAtHour.getTime()
        ? nextAfterMax
        : tomorrowAtHour;
  }

  const slotMs = new Date(
    cursor.getFullYear(),
    cursor.getMonth(),
    cursor.getDate(),
    CONFIG.PUBLISH_HOUR,
    0,
    0,
    0
  ).getTime();

  const slots = [];
  for (let i = 0; i < count; i++) {
    slots.push(new Date(slotMs));
  }
  return slots;
}

/** Dernière date de publication parmi les lignes encore SCHEDULED. */
function getMaxScheduledPublishDate_(sheet) {
  const last = sheet.getLastRow();
  if (last < 2) return null;

  const rowCount = last - 1; // exclude header
  const statuses = sheet.getRange(2, CONFIG.COL.STATUS, rowCount, 1).getValues();
  const dates = sheet.getRange(2, CONFIG.COL.PUBLISH_DATE, rowCount, 1).getValues();

  let maxDate = null;
  for (let i = 0; i < dates.length; i++) {
    if (String(statuses[i][0] || '') !== CONFIG.STATUS_SCHEDULED) continue;
    const d = dates[i][0];
    if (!(d instanceof Date)) continue;
    if (!maxDate || d.getTime() > maxDate.getTime()) {
      maxDate = new Date(d.getTime());
    }
  }
  return maxDate;
}

function getTomorrowAtPublishHour_() {
  const tz = getTimezone_();
  const now = new Date();
  const stamp = Utilities.formatDate(now, tz, 'yyyy-MM-dd');
  const parts = stamp.split('-');
  return new Date(
    parseInt(parts[0], 10),
    parseInt(parts[1], 10) - 1,
    parseInt(parts[2], 10) + 1,
    CONFIG.PUBLISH_HOUR,
    0,
    0,
    0
  );
}

/**
 * Crée / met à jour une feuille d'export Pinterest avec 4 colonnes:
 * Title | Image | Ingredients | URL
 *
 * Règles demandées:
 * - Image = "<Title>.jpg"
 * - URL = "https://akkous.com/recipes/<slug>"
 *   (slug lu depuis la colonne Slug de Recipes, sinon fallback sur ID)
 */
function buildPinterestExportSheet() {
  const exportSheetName = 'PinterestExport';
  const baseRecipes = 'https://akkous.com/recipes/';
  const ss = getSpreadsheet_();
  const src = getRecipesSheetOrThrow_();

  let dst = ss.getSheetByName(exportSheetName);
  if (!dst) {
    dst = ss.insertSheet(exportSheetName);
  } else {
    dst.clearContents();
  }

  const header = ['Title', 'Image', 'Ingredients', 'URL'];
  dst.getRange(1, 1, 1, header.length).setValues([header]);
  dst.getRange(1, 1, 1, header.length).setFontWeight('bold');
  dst.setFrozenRows(1);

  const last = src.getLastRow();
  if (last < 2) {
    SpreadsheetApp.getUi().alert('Aucune donnée dans Recipes.');
    return;
  }

  const values = src.getRange(2, 1, last - 1, CONFIG.HEADERS.length).getValues();
  const out = [];

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const title = String(row[CONFIG.COL.TITLE - 1] || '').trim();
    const ingredients = String(row[CONFIG.COL.INGREDIENTS - 1] || '').trim();
    const slugRaw =
      String(row[CONFIG.COL.SLUG - 1] || '').trim() ||
      String(row[CONFIG.COL.ID - 1] || '').trim();
    if (!title || !slugRaw) continue;

    let slug = slugRaw.replace(/^\/+|\/+$/g, '');
    slug = slug.replace(/^recipes\/?/i, '');
    const image = title + '.jpg';
    const url = baseRecipes + slug;
    out.push([title, image, ingredients, url]);
  }

  if (out.length > 0) {
    dst.getRange(2, 1, out.length, header.length).setValues(out);
    dst.autoResizeColumns(1, header.length);
  }

  SpreadsheetApp.getUi().alert(
    'Export Pinterest prêt : ' + out.length + ' ligne(s) dans "' + exportSheetName + '".'
  );
}

function mealToRow_(meal, publishDate, status, addedDate) {
  const ingredientsStr = joinIngredientsMeasures_(meal);
  const instructions = cleanInstructions_(meal.strInstructions || '');
  const slug = uniqueSlug_(meal.strMeal || 'recipe', meal.idMeal);
  const tagsStr = meal.strTags || '';

  return [
    meal.idMeal || '',
    meal.strMeal || '',
    meal.strCategory || '',
    meal.strArea || '',
    meal.strMealThumb || '',
    ingredientsStr,
    instructions,
    tagsStr,
    publishDate,
    status,
    slug,
    meal.strYoutube || '',
    addedDate,
  ];
}

function joinIngredientsMeasures_(meal) {
  const parts = [];
  for (let n = 1; n <= 20; n++) {
    const ing = (meal['strIngredient' + n] || '').trim();
    const meas = (meal['strMeasure' + n] || '').trim();
    if (!ing && !meas) continue;
    const chunk = [meas, ing].filter(Boolean).join(' ').trim();
    if (chunk) parts.push(chunk);
  }
  return parts.join(' | ');
}

function cleanInstructions_(text) {
  return String(text)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function slugify_(title) {
  return String(title)
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueSlug_(title, idMeal) {
  let base = slugify_(title);
  if (!base) base = 'recipe';
  return base + '-' + String(idMeal || '');
}

/** Avatar défaut pour author dans recipes.json (aligné main.js / fiches statiques). */
const BLOG_DEFAULT_AUTHOR_AVATAR_ =
  'https://images.unsplash.com/photo-1535713875002-d1d0cf377fde?w=96&h=96&fit=crop&q=80';

/**
 * Auteur dans JSON = nom du blog (pas origin/TheMealDB en « personne »).
 * La cuisine reste dans recipe.origin (affichage + recipeCuisine côté site).
 */
function recipeAuthorForBlogExport_(siteName) {
  const name = String(siteName || 'Akkous').trim() || 'Akkous';
  return { name: name, avatar: BLOG_DEFAULT_AUTHOR_AVATAR_ };
}

/**
 * Même structure que recipes.json sur GitHub Pages : { site, recipes }.
 * canonicalOrigin suit CONFIG.SITE_ORIGIN (un seul endroit à changer pour un autre domaine).
 */
function defaultExportSite_() {
  const props = PropertiesService.getScriptProperties();
  const newsletterWebAppUrl = (
    props.getProperty('NEWSLETTER_WEB_APP_URL') ||
    CONFIG.NEWSLETTER_WEB_APP_URL ||
    ''
  ).trim();
  const canon = String(CONFIG.SITE_ORIGIN || 'https://akkous.com')
    .trim()
    .replace(/\/+$/, '');
  let recipeCategoryTaxonomy = [];
  try {
    recipeCategoryTaxonomy = getCategoryRotationList_();
  } catch (e) {
    recipeCategoryTaxonomy = CONFIG.CATEGORIES.slice();
  }
  return {
    name: 'Akkous',
    canonicalOrigin: canon,
    tagline: 'Fresh recipes for every table',
    logoText: 'Akkous',
    newsletterHeading: 'Get recipes in your inbox',
    newsletterSubtext: 'Weekly seasonal ideas—no spam, unsubscribe anytime.',
    newsletterWebAppUrl,
    /** Taxonomie officielle TheMealDB (accueil : nav / filtres / spotlight). */
    recipeCategoryTaxonomy,
  };
}

/**
 * Dérive des étapes à partir des instructions brutes (TheMealDB = souvent un seul paragraphe).
 * Essaie dans l’ordre : retours à la ligne → repères numérotés → frontières de phrases.
 * Aucune étape « inventée » : si le SEO gate rejette encore, c’est voulu.
 *
 * @param {string} recipeId Identifiant recette (meal id ou row label) pour les logs.
 * @param {string} rawInstructions Texte colonne Instructions.
 * @returns {string[]} Étapes filtrées (trim, longueur > 10).
 */
function validateAndFixSteps_(recipeId, rawInstructions) {
  const minSteps = Math.max(1, parseInt(CONFIG.SEO_MIN_STEPS, 10) || 3);
  const raw = String(rawInstructions || '');
  const id = String(recipeId || 'unknown');

  const s1 = filterStepsByMinLength_(splitStepsByNewlines_(raw));
  if (s1.length >= minSteps) {
    logVerbWarningsForSteps_(id, s1);
    return s1;
  }

  const s2 = filterStepsByMinLength_(splitStepsByNumberedPatterns_(raw));
  if (s2.length >= minSteps) {
    logAutomation_(
      CONFIG.LOG_LEVEL_INFO,
      'validateAndFixSteps_',
      'INFO: steps enriched — id=' + id + ' → ' + s2.length + ' steps detected (strategy 2)'
    );
    logVerbWarningsForSteps_(id, s2);
    return s2;
  }

  const s3 = filterStepsByMinLength_(splitStepsBySentenceBoundaries_(raw));
  if (s3.length >= minSteps) {
    logAutomation_(
      CONFIG.LOG_LEVEL_INFO,
      'validateAndFixSteps_',
      'INFO: steps enriched — id=' + id + ' → ' + s3.length + ' steps detected (strategy 3)'
    );
    logVerbWarningsForSteps_(id, s3);
    return s3;
  }

  const best = pickBestStepCandidate_(s1, s2, s3);
  logVerbWarningsForSteps_(id, best);
  return best;
}

/** Garde le plus grand nombre d’étapes valides si aucune stratégie n’atteint SEO_MIN_STEPS. */
function pickBestStepCandidate_(a, b, c) {
  const arr = [a || [], b || [], c || []];
  arr.sort(function (x, y) {
    return y.length - x.length;
  });
  return arr[0];
}

function filterStepsByMinLength_(steps) {
  const minLen = 10;
  return (steps || [])
    .map(function (s) {
      return String(s || '').trim();
    })
    .filter(function (s) {
      return s.length > minLen;
    });
}

function splitStepsByNewlines_(raw) {
  return String(raw || '')
    .replace(/\r\n/g, '\n')
    .split(/\n+/)
    .map(function (s) {
      return s.trim();
    })
    .filter(Boolean);
}

/**
 * Découpe sur 1. 2) Step 1: Step 1 - (insensible à la casse), y compris numéros en milieu de ligne.
 */
function splitStepsByNumberedPatterns_(raw) {
  var text = String(raw || '').replace(/\r\n/g, '\n').trim();
  if (!text) return [];
  var markers = [];
  var re1 = /(?:^|\n)\s*(?:(?:step\s*)?\d+[\.\):]\s*|step\s*\d+\s*[:\\-]+\s*)/gi;
  var m;
  while ((m = re1.exec(text)) !== null) {
    markers.push({ start: m.index, after: m.index + m[0].length });
  }
  var re2 = /\s+(?=(?:step\s*)?\d+[\.\):]\s)/gi;
  while ((m = re2.exec(text)) !== null) {
    markers.push({ start: m.index, after: m.index + m[0].length });
  }
  var re3 = /\s+(?=step\s*\d+\s*[:\\-]+\s*)/gi;
  while ((m = re3.exec(text)) !== null) {
    markers.push({ start: m.index, after: m.index + m[0].length });
  }
  markers.sort(function (a, b) {
    return a.start - b.start;
  });
  var dedup = [];
  for (var i = 0; i < markers.length; i++) {
    var cur = markers[i];
    if (dedup.length && dedup[dedup.length - 1].start === cur.start) {
      if (cur.after > dedup[dedup.length - 1].after) {
        dedup[dedup.length - 1] = cur;
      }
    } else {
      dedup.push(cur);
    }
  }
  if (!dedup.length) return [];
  var parts = [];
  var last = 0;
  for (var j = 0; j < dedup.length; j++) {
    if (dedup[j].start > last) {
      var chunk = text.substring(last, dedup[j].start).trim();
      if (chunk) parts.push(chunk);
    }
    last = dedup[j].after;
  }
  if (last < text.length) {
    parts.push(text.substring(last).trim());
  }
  return parts.filter(Boolean);
}

/**
 * Phrase suivie de . ! ? puis espace(s) puis majuscule (EN/FR courantes).
 */
function splitStepsBySentenceBoundaries_(raw) {
  var text = String(raw || '')
    .replace(/\r\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text) return [];
  var upper = 'A-ZÀÁÂÄÆÇÉÈÊËÌÍÎÏÒÓÔÖÙÚÛÜÝŸÑ';
  var re = new RegExp('([.!?])\\s+(?=[' + upper + '])', 'g');
  var out = [];
  var last = 0;
  var m;
  while ((m = re.exec(text)) !== null) {
    var end = m.index + 1;
    var seg = text.substring(last, end).trim();
    if (seg) out.push(seg);
    last = m.index + m[0].length;
  }
  if (last < text.length) {
    out.push(text.substring(last).trim());
  }
  return out.filter(Boolean);
}

/** Retire un préfixe du type "1." ou "Step 2:" avant le test de verbe. */
function stripLeadingStepNumberPrefix_(step) {
  return String(step || '')
    .replace(/^\s*(?:(?:step\s*)?\d+[\.\):]\s*|step\s*\d+\s*[:\\-]+\s*)/i, '')
    .trim();
}

/** Verbes de cuisine EN/FR (premier mot après préfixe numéroté éventuel). */
function stepHasLeadingCookingVerb_(step) {
  var body = stripLeadingStepNumberPrefix_(step);
  if (!body) return false;
  var first = body
    .toLowerCase()
    .replace(/^[^a-zàáâäæçéèêëìíîïòóôöùúûüýÿñ]+/i, '')
    .split(/\s+/)[0];
  if (!first) return false;
  var verbs = {
    // English
    prepare: 1,
    preheat: 1,
    wash: 1,
    peel: 1,
    chop: 1,
    dice: 1,
    slice: 1,
    mince: 1,
    grate: 1,
    mix: 1,
    stir: 1,
    whisk: 1,
    combine: 1,
    heat: 1,
    add: 1,
    pour: 1,
    cook: 1,
    boil: 1,
    simmer: 1,
    fry: 1,
    bake: 1,
    roast: 1,
    grill: 1,
    season: 1,
    taste: 1,
    serve: 1,
    place: 1,
    remove: 1,
    drain: 1,
    transfer: 1,
    cover: 1,
    reduce: 1,
    blend: 1,
    knead: 1,
    roll: 1,
    cut: 1,
    melt: 1,
    brush: 1,
    spread: 1,
    fold: 1,
    grease: 1,
    line: 1,
    rinse: 1,
    soak: 1,
    toast: 1,
    steam: 1,
    brown: 1,
    deglaze: 1,
    skim: 1,
    strain: 1,
    beat: 1,
    cream: 1,
    sift: 1,
    measure: 1,
    turn: 1,
    flip: 1,
    rest: 1,
    repeat: 1,
    continue: 1,
    finish: 1,
    bring: 1,
    set: 1,
    leave: 1,
    allow: 1,
    return: 1,
    toss: 1,
    sprinkle: 1,
    drizzle: 1,
    divide: 1,
    reserve: 1,
    coat: 1,
    stack: 1,
    wrap: 1,
    chill: 1,
    freeze: 1,
    thaw: 1,
    microwave: 1,
    // French (infinitif / impératif courant)
    préparer: 1,
    laver: 1,
    éplucher: 1,
    eplucher: 1,
    couper: 1,
    mélanger: 1,
    melanger: 1,
    chauffer: 1,
    ajouter: 1,
    cuire: 1,
    faire: 1,
    verser: 1,
    battre: 1,
    fouetter: 1,
    émincer: 1,
    emincer: 1,
    hacher: 1,
    râper: 1,
    raper: 1,
    assaisonner: 1,
    goûter: 1,
    gouter: 1,
    servir: 1,
    disposer: 1,
    retirer: 1,
    égoutter: 1,
    egoutter: 1,
    couvrir: 1,
    réduire: 1,
    reduire: 1,
    mixer: 1,
    pétrir: 1,
    petrir: 1,
    étaler: 1,
    etaler: 1,
    fondre: 1,
    griller: 1,
    rôtir: 1,
    rotir: 1,
    bouillir: 1,
    mijoter: 1,
    frire: 1,
    enfourner: 1,
    garnir: 1,
    refroidir: 1,
    mélangez: 1,
    melangez: 1,
    coupez: 1,
    ajoutez: 1,
    versez: 1,
    cuisez: 1,
    chauffez: 1,
  };
  var w = first.replace(/[^a-zàáâäæçéèêëìíîïòóôöùúûüýÿñ-]/gi, '');
  return verbs.hasOwnProperty(w);
}

function logVerbWarningsForSteps_(recipeId, steps) {
  (steps || []).forEach(function (step, index) {
    if (!stepHasLeadingCookingVerb_(step)) {
      logAutomation_(
        CONFIG.LOG_LEVEL_WARN,
        'validateAndFixSteps_',
        'WARN: step missing verb — id=' + String(recipeId) + ' step=' + index
      );
    }
  });
}

function buildExportPayload_(sheet) {
  const site = defaultExportSite_();
  const last = sheet.getLastRow();
  if (last < 2) return { site, recipes: [] };

  const nCol = CONFIG.HEADERS.length;
  const rowCount = last - 1; // exclude header
  const data = sheet.getRange(2, 1, rowCount, nCol).getValues();
  const recipes = [];
  let publishedIndex = 0;

  for (let r = 0; r < data.length; r++) {
    const row = data[r];
    const status = String(row[CONFIG.COL.STATUS - 1] || '');
    /** Export site : uniquement PUBLISHED (les SCHEDULED restent dans le sheet jusqu’à publication). */
    if (status !== CONFIG.STATUS_PUBLISHED) {
      continue;
    }

    const ingCell = String(row[CONFIG.COL.INGREDIENTS - 1] || '');
    const ingredients = ingCell
      ? ingCell.split('|').map((s) => s.trim()).filter(Boolean)
      : [];

    const tagsCell = String(row[CONFIG.COL.TAGS - 1] || '');
    const tags = tagsCell
      ? tagsCell.split(',').map((s) => s.trim()).filter(Boolean)
      : [];

    const pub = row[CONFIG.COL.PUBLISH_DATE - 1];
    let publishDate = '';
    if (pub instanceof Date) {
      publishDate = Utilities.formatDate(
        pub,
        getTimezone_(),
        "yyyy-MM-dd'T'HH:mm:ss"
      );
    }

    const addedRaw = row[CONFIG.COL.ADDED_DATE - 1];
    let addedDate = '';
    if (addedRaw instanceof Date && !isNaN(addedRaw.getTime())) {
      addedDate = Utilities.formatDate(
        addedRaw,
        getTimezone_(),
        "yyyy-MM-dd'T'HH:mm:ss"
      );
    }

    const instructions = String(row[CONFIG.COL.INSTRUCTIONS - 1] || '');
    const origin = String(row[CONFIG.COL.ORIGIN - 1] || '').trim();
    const slug = String(row[CONFIG.COL.SLUG - 1] || '').trim();
    const idMeal = String(row[CONFIG.COL.ID - 1] || '').trim();
    const recipeId = slug || idMeal;
    const title = String(row[CONFIG.COL.TITLE - 1] || '').trim();
    const category = String(row[CONFIG.COL.CATEGORY - 1] || '').trim();
    const youtube = String(row[CONFIG.COL.YOUTUBE - 1] || '').trim();
    const thumb = String(row[CONFIG.COL.IMAGE - 1] || '').trim();

    const steps = validateAndFixSteps_(idMeal || slug || 'row-' + (r + 2), instructions);

    const recipeTimes = inferRecipeTimes_(steps);
    const description = buildSeoDescription_({
      title,
      category,
      origin,
      ingredients,
      steps,
      cookTime: recipeTimes.cookTimeLabel,
      prepTime: recipeTimes.prepTimeLabel,
      totalTime: recipeTimes.totalTimeLabel,
    });
    const normalizedTags = normalizeTags_(tags, title, category, origin);
    const difficulty = inferDifficultyFromSteps_(steps);
    const seoCheck = evaluateSeoQuality_({
      title,
      image: thumb,
      ingredients,
      steps,
      description,
    });
    if (CONFIG.SEO_QUALITY_GATE_ENABLED && !seoCheck.ok) {
      logAutomation_(
        CONFIG.LOG_LEVEL_WARN,
        'buildExportPayload_',
        'SEO export (non bloquant, recette incluse) id=' +
          (idMeal || slug || 'row-' + (r + 2)) +
          ' — ' +
          seoCheck.reasons.join('; ')
      );
    }

    recipes.push({
      /** ID TheMealDB (colonne feuille « ID ») — utile pour traçabilité */
      mealId: idMeal,
      id: recipeId,
      title,
      category,
      origin,
      image: thumb,
      imageCard: thumb,
      ingredients,
      /** Texte brut de la feuille (identique à la colonne Instructions) */
      instructions,
      steps,
      description,
      tags: normalizedTags,
      datePublished: publishDate ? publishDate.slice(0, 10) : '',
      publishDate,
      addedDate,
      status,
      slug: slug || recipeId,
      youtube,
      author: recipeAuthorForBlogExport_(site.name),
      cookTime: recipeTimes.cookTimeLabel,
      prepTime: recipeTimes.prepTimeLabel,
      totalTime: recipeTimes.totalTimeLabel,
      servings: 4,
      difficulty,
      featured: publishedIndex === 0,
      trending: true,
    });
    publishedIndex++;
  }
  const withRelated = attachAutoRelatedRecipeIds_(recipes, CONFIG.SEO_RELATED_MAX);
  return { site, recipes: withRelated };
}

function normalizeTags_(tags, title, category, origin) {
  const bag = {};
  const out = [];
  function pushTag(v) {
    const s = String(v || '').trim();
    if (!s) return;
    const key = s.toLowerCase();
    if (bag[key]) return;
    bag[key] = true;
    out.push(s);
  }
  (tags || []).forEach(pushTag);
  if (category) pushTag(category);
  if (origin) pushTag(origin);
  const words = String(title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  words.slice(0, 2).forEach((w) => {
    if (w.length >= 4) pushTag(w.charAt(0).toUpperCase() + w.slice(1));
  });
  return out.slice(0, 10);
}

function buildSeoDescription_(ctx) {
  const title = String(ctx.title || '').trim();
  const category = String(ctx.category || '').trim().toLowerCase();
  const origin = String(ctx.origin || '').trim();
  const ingredientsCount = (ctx.ingredients || []).length;
  const stepsCount = (ctx.steps || []).length;
  const timeLabel = ctx.cookTime || ctx.totalTime || '';

  let prefix = title || 'Recipe';
  if (origin) prefix += ' (' + origin + ')';
  let body =
    prefix +
    ' — easy ' +
    (category || 'home-cooked') +
    ' recipe with ' +
    ingredientsCount +
    ' ingredients and ' +
    stepsCount +
    ' step' +
    (stepsCount > 1 ? 's' : '') +
    '.';
  if (timeLabel) body += ' Ready in ' + timeLabel + '.';
  body += ' Includes exact ingredients and clear instructions.';
  if (body.length > 158) return body.slice(0, 155) + '…';
  return body;
}

function inferRecipeTimes_(steps) {
  const text = (steps || []).join(' ').toLowerCase();
  const mins = [];
  const re = /(\d{1,3})\s*(?:min|mins|minute|minutes)\b/g;
  let m;
  while ((m = re.exec(text))) {
    const v = parseInt(m[1], 10);
    if (!isNaN(v) && v > 0 && v <= 360) mins.push(v);
  }
  let total = 0;
  mins.forEach((v) => {
    total += v;
  });
  if (!total) {
    return { prepTimeLabel: '', cookTimeLabel: '', totalTimeLabel: '' };
  }
  const prep = Math.max(10, Math.round(total * 0.3));
  const cook = Math.max(10, total - prep);
  return {
    prepTimeLabel: prep + ' min',
    cookTimeLabel: cook + ' min',
    totalTimeLabel: total + ' min',
  };
}

function inferDifficultyFromSteps_(steps) {
  const n = (steps || []).length;
  if (n >= 10) return 'Hard';
  if (n >= 6) return 'Medium';
  return 'Easy';
}

function evaluateSeoQuality_(recipe) {
  const reasons = [];
  const title = String(recipe.title || '').trim();
  const image = String(recipe.image || '').trim();
  const ingredients = recipe.ingredients || [];
  const steps = recipe.steps || [];
  const description = String(recipe.description || '').trim();

  if (!title || title.length < CONFIG.SEO_MIN_TITLE_LEN) {
    reasons.push('title too short');
  }
  if (!/^https?:\/\//i.test(image)) {
    reasons.push('image URL missing/invalid');
  }
  if (ingredients.length < CONFIG.SEO_MIN_INGREDIENTS) {
    reasons.push('not enough ingredients');
  }
  if (steps.length < CONFIG.SEO_MIN_STEPS) {
    reasons.push('not enough steps');
  }
  if (description.length < 80) {
    reasons.push('description too short');
  }
  return { ok: reasons.length === 0, reasons };
}

function attachAutoRelatedRecipeIds_(recipes, maxRel) {
  const maxN = Math.max(1, parseInt(maxRel, 10) || 3);
  const list = (recipes || []).map((r) => Object.assign({}, r));
  for (let i = 0; i < list.length; i++) {
    const a = list[i];
    const scored = [];
    for (let j = 0; j < list.length; j++) {
      if (i === j) continue;
      const b = list[j];
      let score = 0;
      if (String(a.category || '').toLowerCase() === String(b.category || '').toLowerCase()) score += 4;
      if (String(a.origin || '').toLowerCase() === String(b.origin || '').toLowerCase()) score += 2;
      const ta = {};
      (a.tags || []).forEach((t) => {
        ta[String(t || '').toLowerCase()] = true;
      });
      (b.tags || []).forEach((t) => {
        if (ta[String(t || '').toLowerCase()]) score += 1;
      });
      if (score > 0) scored.push({ id: b.id, score: score });
    }
    scored.sort((x, y) => y.score - x.score || String(x.id).localeCompare(String(y.id)));
    a.relatedRecipeIds = scored.slice(0, maxN).map((x) => x.id);
  }
  return list;
}

function runSeoAuditPreview() {
  try {
    const sheet = getRecipesSheetOrThrow_();
    const payload = buildExportPayload_(sheet);
    const recipes = payload.recipes || [];
    let weakDesc = 0;
    let weakSteps = 0;
    recipes.forEach((r) => {
      if (String(r.description || '').length < 110) weakDesc++;
      if ((r.steps || []).length < CONFIG.SEO_MIN_STEPS) weakSteps++;
    });
    const msg =
      'Audit SEO export\n\n' +
      'Recettes exportées: ' +
      recipes.length +
      '\nDescriptions courtes: ' +
      weakDesc +
      '\nRecettes avec peu d’étapes: ' +
      weakSteps +
      '\n\nVoir AutomationLog pour les détails SEO gate.';
    SpreadsheetApp.getUi().alert(msg);
    logAutomation_(CONFIG.LOG_LEVEL_INFO, 'runSeoAuditPreview', msg.replace(/\n/g, ' | '));
  } catch (e) {
    logAutomation_(CONFIG.LOG_LEVEL_ERROR, 'runSeoAuditPreview', String(e));
    throw e;
  }
}

function parseRepo_(repoStr) {
  const s = String(repoStr).trim();
  const i = s.indexOf('/');
  if (i < 1 || i === s.length - 1) {
    throw new Error('CONFIG.GITHUB_REPO must be "owner/repo"');
  }
  return [s.slice(0, i), s.slice(i + 1)];
}

// ---------------------------------------------------------------------------
// Newsletter (formulaire GitHub Pages → feuille Google)
// ---------------------------------------------------------------------------

const NEWSLETTER_HEADERS = ['Email', 'Subscribed at', 'Source'];

/**
 * Crée l’onglet et les en-têtes si besoin (menu ⑪).
 */
function setupNewsletterSheet() {
  try {
    getOrCreateNewsletterSheet_();
    SpreadsheetApp.getActiveSpreadsheet().toast(
      'Onglet prêt. Déploie l’application Web (doPost) puis menu ⑫.',
      'Newsletter',
      8
    );
    SpreadsheetApp.getUi().alert(
      'Onglet « ' +
        CONFIG.NEWSLETTER_SHEET_NAME +
        ' » est prêt.\n\n' +
        '1. Apps Script → Déployer → Nouvelle version → Type « Application Web »\n' +
        '2. Exécuter en tant que : Moi · Qui a accès : Tous\n' +
        '3. Copier l’URL (…/exec)\n' +
        '4. Projet → Paramètres → Propriétés du script → ajouter la clé :\n' +
        '   NEWSLETTER_WEB_APP_URL = ton URL /exec\n' +
        '5. Pousser recipes.json (④) pour que le site reçoive l’URL dans site.newsletterWebAppUrl'
    );
  } catch (e) {
    SpreadsheetApp.getUi().alert('Erreur : ' + e);
  }
}

function showNewsletterDeployHelp() {
  SpreadsheetApp.getUi().alert(
    'Déploiement Web App newsletter\n\n' +
      '• La fonction doPost reçoit le champ « email » (formulaire HTML).\n' +
      '• Après déploiement, enregistre l’URL dans Propriétés du script :\n' +
      '  NEWSLETTER_WEB_APP_URL\n' +
      '• Puis ④ Pousser recipes.json pour mettre à jour le site.\n' +
      '• Tu peux aussi coller l’URL dans index.html sur data-newsletter-endpoint.'
  );
}

function getOrCreateNewsletterSheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(CONFIG.NEWSLETTER_SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(CONFIG.NEWSLETTER_SHEET_NAME);
    sh.getRange(1, 1, 1, NEWSLETTER_HEADERS.length).setValues([NEWSLETTER_HEADERS]);
    sh.setFrozenRows(1);
  } else if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, NEWSLETTER_HEADERS.length).setValues([NEWSLETTER_HEADERS]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function isValidEmail_(s) {
  const t = String(s || '').trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(t);
}

/**
 * Point d’entrée Web App (POST). Champ formulaire : name="email"
 */
function doPost(e) {
  const outOk =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>OK</title></head><body>OK</body></html>';
  const outErr =
    '<!DOCTYPE html><html><head><meta charset="utf-8"><title>Error</title></head><body>Error</body></html>';
  try {
    const raw = (e && e.parameter && e.parameter.email) || '';
    const email = String(raw).trim().toLowerCase();
    if (!isValidEmail_(email)) {
      return HtmlService.createHtmlOutput(outErr).setTitle('Newsletter');
    }
    const sh = getOrCreateNewsletterSheet_();
    const last = sh.getLastRow();
    if (last > 1) {
      const rowCount = last - 1; // exclude header
      const col = sh.getRange(2, 1, rowCount, 1).getValues();
      for (let i = 0; i < col.length; i++) {
        if (String(col[i][0] || '').trim().toLowerCase() === email) {
          return HtmlService.createHtmlOutput(outOk).setTitle('Newsletter');
        }
      }
    }
    sh.appendRow([email, new Date(), 'website']);
    return HtmlService.createHtmlOutput(outOk).setTitle('Newsletter');
  } catch (err) {
    Logger.log('doPost newsletter: %s', err);
    return HtmlService.createHtmlOutput(outErr).setTitle('Newsletter');
  }
}

/**
 * Vérification rapide newsletter (hors Web App dashboard).
 */
function doGetNewsletterHealth() {
  return ContentService.createTextOutput(
    'Akkous newsletter — POST avec champ email= (formulaire).'
  ).setMimeType(ContentService.MimeType.TEXT);
}
