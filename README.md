# Akkous

Blog de recettes **statique** (HTML, CSS, JavaScript), pensé pour **[GitHub Pages](https://pages.github.com/)**.  
Site public : **https://akkous.com** (fichier `CNAME` à la racine).

Les données éditoriales vivent dans **`recipes.json`**. Le front charge ce fichier en **`fetch()`** ; un script Node optionnel génère des **pages HTML par recette** (`recipes/<slug>/index.html`) pour le SEO et les aperçus sociaux (Open Graph, JSON-LD).

---

## Sommaire

- [Architecture](#architecture)
- [Structure du dépôt](#structure-du-dépôt)
- [Prérequis](#prérequis)
- [Développement local](#développement-local)
- [Contenu : `recipes.json`](#contenu--recipesjson)
- [Build des pages recette + sitemap](#build-des-pages-recette--sitemap)
- [GitHub Actions](#github-actions)
- [Automatisation Google (Sheets + Apps Script)](#automatisation-google-sheets--apps-script)
- [Déploiement GitHub Pages](#déploiement-github-pages)
- [Dépannage](#dépannage)

---

## Architecture

| Couche | Rôle |
|--------|------|
| **`index.html` + `main.js` + `style.css`** | Accueil, grille, filtres, recherche, chargement de `recipes.json`. |
| **`recipe.html` + `main.js`** | Page recette dynamique (`?id=…` ou URL `/recipes/<slug>/`). |
| **`recipes.json`** | Source de vérité : objet `{ site, recipes[] }`. |
| **`recipes/<slug>/index.html`** | Généré par Node : même gabarit que `recipe.html`, métadonnées déjà dans le HTML. |
| **`sitemap.xml`** | Régénéré par le script Node (URLs canoniques `/recipes/<slug>/`). |
| **Apps Script** | Optionnel : remplit une feuille Google, pousse `recipes.json` + `sitemap.xml` sur GitHub via l’API. |

---

## Structure du dépôt

| Chemin | Description |
|--------|-------------|
| `index.html` | Page d’accueil. |
| `recipe.html` | Modèle recette (utilisé en SPA et comme base du build statique). |
| `main.js` | Logique applicative (données, navigation, SEO dynamique, newsletter, etc.). |
| `style.css` | Thème et composants. |
| `recipes.json` | Contenu du blog. |
| `recipes/` | Dossiers `recipes/<slug>/index.html` générés — **à versionner** avec Git. |
| `scripts/build-recipe-pages.mjs` | Générateur de pages statiques + `sitemap.xml`. |
| `.github/workflows/build-static-recipes.yml` | CI : régénère `recipes/` après un push sur `recipes.json`. |
| `google-apps-script/` | `code.gs` (automation), `AutomationDashboard.html` (rapport). |
| `assets/` | Favicon et fichiers statiques. |
| `conditions-utilisation.html`, `politique-confidentialite.html`, `contact.html` | Pages légales / contact. |
| `robots.txt`, `ads.txt`, `.nojekyll` | SEO / annonces / désactivation Jekyll sur Pages. |

---

## Prérequis

- **Navigateur** pour consulter le site.
- **Serveur HTTP local** pour développer (le `fetch` de `recipes.json` ne fonctionne pas en `file://`).
- **Node.js 18+** (recommandé 20) uniquement si tu lances le générateur de pages ou la CI en local.

---

## Développement local

```bash
# Exemple avec Python
python -m http.server 8080

# Ou avec npx
npx serve .
```

Ouvre `http://localhost:8080` (ou le port indiqué).

---

## Contenu : `recipes.json`

Format racine :

```json
{
  "site": {
    "name": "Akkous",
    "canonicalOrigin": "https://akkous.com",
    "tagline": "…",
    "newsletterWebAppUrl": "…"
  },
  "recipes": [ /* objets recette */ ]
}
```

Chaque recette contient notamment : `id` / `slug`, `title`, `description`, `category`, `ingredients`, `steps` (ou `instructions`), `image`, `author`, temps, `tags`, `datePublished`, etc. Les catégories du filtre sont normalisées côté JS (ex. `dinner`, `desserts`, `drinks`).

---

## Build des pages recette + sitemap

À la racine du dépôt :

```bash
node scripts/build-recipe-pages.mjs
```

Effets :

- crée ou met à jour **`recipes/<slug>/index.html`** pour chaque entrée valide ;
- réécrit **`sitemap.xml`** (home, pages statiques, une URL par recette) ;
- supprime les dossiers **`recipes/<slug>/`** qui ne sont plus dans `recipes.json` (évite les pages fantômes).

Ensuite : **commit** `recipes/`, `sitemap.xml`, et éventuellement `recipes.json`.

> **Attention :** si `recipes.json` est vide ou sans slugs valides, le script efface toutes les pages générées précédemment. Garde un export correct avant de lancer le build en production.

---

## GitHub Actions

Workflow : **`.github/workflows/build-static-recipes.yml`**

- **Déclencheurs :** push sur `main` qui modifie **`recipes.json`**, ou exécution manuelle (**Run workflow**).
- **Étapes :** `checkout` → Node 20 → `node scripts/build-recipe-pages.mjs` → commit + push de `recipes/` et `sitemap.xml` si changements (bot `github-actions`).

**Important :** le dossier **`recipes/`** à la racine **ne doit pas** être listé dans **`.gitignore`** (sinon `git add recipes` échoue dans la CI).

---

## Automatisation Google (Sheets + Apps Script)

Le dossier **`google-apps-script/`** documente et versionne le code à coller dans le projet Apps Script lié au classeur :

| Fichier | Usage |
|---------|--------|
| **`code.gs`** | TheMealDB → feuille **Recipes**, statuts SCHEDULED / PUBLISHED, export JSON (`author` = nom du blog, `origin` = cuisine), découpe des **étapes** depuis les instructions (retours à la ligne → numéros `1.` / `Step 1:` → phrases), **sans étapes inventées**, push GitHub annulé si **0** recette exportée, Groq (SEO), GSC, newsletter (`doPost`). |
| **`AutomationDashboard.html`** | À ajouter dans le même projet Apps Script sous le nom **`AutomationDashboard`** pour le menu rapport (panneau latéral). |

**Propriétés du script** (recommandé, plutôt que secrets dans le code) :

- `GITHUB_TOKEN` — PAT avec accès **repo** (contenu).
- `GITHUB_REPO` — `propriétaire/nom-du-depot` (ex. `INVOOFFICE/Akkous`).
- `GROQ_API_KEY`, `GSC_CLIENT_EMAIL`, `GSC_PRIVATE_KEY`, `NEWSLETTER_WEB_APP_URL`, etc. selon les fonctions utilisées.

Le menu du tableur (**🍳 Akkous**) propose entre autres :

- **③** marquer les recettes **PUBLISHED** quand la date est passée ;
- **④** pousser **`recipes.json`** + **`sitemap.xml`** sur GitHub.

L’export vers GitHub ne contient en général que les lignes **PUBLISHED**. Les pages HTML sous **`recipes/<slug>/`** sont produites par **GitHub Actions** (ou par un `node scripts/...` local), pas par Apps Script.

---

## Déploiement GitHub Pages

1. Pousser ce dépôt sur GitHub.
2. **Réglages → Pages** : source **Deploy from a branch**, branche **`main`**, dossier **`/` (root)**.
3. Le fichier **`.nojekyll`** évite que Jekyll ignore des fichiers nécessaires.

Les liens relatifs fonctionnent pour un site projet (`username.github.io/repo/`) ou un domaine custom (`CNAME`).

---

## Dépannage

| Problème | Piste |
|----------|--------|
| Page blanche ou pas de recettes en local | Servir le site via **http://**, pas `file://`. |
| `recipes.json` vide sur GitHub | Vérifier les lignes **PUBLISHED** dans la feuille et le **SEO quality gate** dans Apps Script qui peut exclure des lignes. |
| Workflow Actions en échec sur `git add recipes` | Retirer toute règle qui ignore **`recipes/`** dans `.gitignore`. |
| Sitemap sans URLs recettes | Relancer le build Node ; vérifier que `recipes[]` n’est pas vide. |
| Croix rouge sur un fichier mais verte sur la racine | GitHub affiche le statut des **checks pour le dernier commit ayant modifié ce fichier** ; ce n’est pas forcément le même SHA que la tête de `main`. |

---
test update github
## Licence

Utilisation et modification libres pour ton propre blog.
