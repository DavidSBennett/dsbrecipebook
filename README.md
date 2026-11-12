# DSB Recipe Book

A personal recipe website: clean, distraction-free recipes, search, and a grocery list builder.
Plain HTML/CSS/JavaScript with no build step and no server. It runs on GitHub Pages, or you can just open `index.html`.

Live at **https://recipes.davidsbennett.com** (hosted on GreenGeeks; see Hosting below).

## What it does

- **Recipes (home):** every recipe as a card. Search by name, ingredient, tag, or notes, and filter by tag.
- **Recipe page:** clean ingredients and numbered steps. Tap to check things off, scale servings up or down,
  use **Cook mode** (bigger text, keeps the screen awake), print, edit, or delete.
- **Grocery list:** pick recipes (×½ to ×4), and the ingredients are combined (e.g. garlic from two recipes → "10 cloves")
  and sorted by aisle. Check items off, add extras like paper towels, copy the list to your phone, or print it.
  With the [Kroger extension](kroger-extension/README.md) installed, **Send to Kroger** puts the list in your kroger.com cart.
- **Add recipe:** paste a whole recipe web page (Ctrl+A, Ctrl+C on the page, then Ctrl+V in the box), or drop a saved
  `.html` page. Ads, life stories, reviews, and "you'll also love" links are stripped out. You review the result, then save.
  You can also write your own from scratch.

## Where recipes are saved

| Place | Who sees it |
| --- | --- |
| `data/recipes.js` | Everyone and every device: the published recipes |
| Your browser (localStorage) | Only this browser. New recipes and edits land here first. |

### Publish automatically (recommended)

Connect a browser to GitHub once and every save, edit, or delete is committed to `data/recipes.js` for you.
GitHub Pages rebuilds, and other devices see the change a minute or two later.

1. Create a [fine-grained personal access token](https://github.com/settings/personal-access-tokens/new):
   - **Repository access:** Only select repositories → `dsbrecipebook`
   - **Permissions:** Contents → **Read and write** (nothing else)
2. On the site, open **Backup & sync**, paste the token, and click **Connect**. Do this once on each device you add recipes from.

The token is stored only in that browser. Connect only devices you trust. When the token expires,
disconnect and connect again with a new one. Changes made while offline are published the next time the site opens.

Each publish reads the latest file from GitHub and applies this browser's changes on top, so recipes added
from another device are kept. Because the site commits to `main`, run `git pull` before editing files locally.

### Publish by hand

Without connecting: **Backup & sync → Download recipes.js**, replace `data/recipes.js` with it, then commit and push.
Also on that page: a backup file you can download and restore.

## Alternative: GitHub Pages

The site works on GitHub Pages too, with no server of your own:

1. Push this repo to GitHub.
2. On GitHub: **Settings → Pages → Build and deployment → Deploy from a branch**, pick `main` and `/ (root)`, then save.
3. The site appears at `https://<your-username>.github.io/dsbrecipebook/` within a minute or two.

## Hosting: recipes.davidsbennett.com (GreenGeeks)

The live site is served from GreenGeeks (server chi208), the same way as thehistorians.org.
`.github/workflows/deploy.yml` copies `index.html`, `css/`, `js/` and `data/` to the server with rsync over SSH
on every push to `main`. That includes the commits the site makes itself when a connected browser saves a
recipe, so new recipes reach the server in about a minute.

- **cPanel → Domains:** `recipes.davidsbennett.com` is added there. The workflow deploys into its folder
  (`public_html/recipes.davidsbennett.com` or `recipes.davidsbennett.com`, whichever exists).
- **Repository secrets** (Settings → Secrets and variables → Actions): `SSH_HOST` (`chi208.greengeeks.net`),
  `SSH_PORT` (`22`), `SSH_USERNAME` (the cPanel username), and `SSH_PRIVATE_KEY` (a private key whose public half
  is authorized in cPanel → SSH Access). Until they're set, the workflow skips the deploy with a warning.
- To deploy by hand: **Actions → Deploy to GreenGeeks (SSH) → Run workflow**.

Each browser keeps its saved data (GitHub token, grocery list, unpublished recipes) separately for each web
address, so on a new address, reconnect GitHub on the Backup & sync page.

## Run it locally

Double-click `index.html`, or serve the folder:

```bash
py -m http.server 8173
```

then open http://localhost:8173.

## Files

- `index.html`: page shell and navigation
- `css/styles.css`: styles (light/dark mode, print, large tap targets)
- `js/app.js`: the pages (home, recipe, add/edit, grocery, backup)
- `js/parser.js`: cleans up a pasted recipe page (schema.org data → recipe-card plugins → page text)
- `js/ingredients.js`: reads amounts and units, scales them, and builds the combined grocery list
- `js/store.js`: saving, loading, export/import
- `js/github.js`: automatic publishing to GitHub (commits `data/recipes.js` through the GitHub API)
- `data/recipes.js`: the published recipes
- `kroger-extension/`: Chrome extension that adds the grocery list to your kroger.com cart (not deployed to the site;
  see its [README](kroger-extension/README.md))
