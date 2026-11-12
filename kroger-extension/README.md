# DSB Recipe Book → Kroger (Chrome extension)

Build your grocery list on [recipes.davidsbennett.com](https://recipes.davidsbennett.com/#/grocery), send it to this
extension, then add everything to your kroger.com cart in one click.

## How it works

1. On the recipe book's **Grocery list** page, pick recipes and check off what you already have.
2. Click **Send to Kroger** (it appears once the extension is installed). Unchecked items and your extras go to the extension.
3. Open **kroger.com** and click **🛒 Add recipe list** (bottom right), or click the extension's toolbar icon.
4. A panel shows a Kroger product for each item, with picture, size, and price at your store:
   - change the product from the menu, or **Search again** with other words
   - set the quantity (produce bought by the piece starts at that count; everything else at 1 package)
   - uncheck anything you don't need (items with no amount, like "Olive oil" or "Salt and pepper", start unchecked)
5. Click **Add N items to cart**. They're added to your Kroger cart for pickup or delivery.

The extension remembers which product you chose for each item ("Your pick"), so next time the same ingredient
comes up already matched.

It uses Kroger's official public API (Products, Locations, Cart). It doesn't click around kroger.com pages,
so it keeps working when Kroger changes their site.

## Install (once)

1. In Chrome, go to `chrome://extensions` and turn on **Developer mode** (top right).
2. Click **Load unpacked** and choose this `kroger-extension` folder.
3. The settings page explains the rest. Open it from the extension's **Details → Extension options**, or click the
   toolbar icon on any page other than kroger.com.

The extension's ID is fixed (`fcmnhademmdokoehabmligddbgmkecab`) by the `key` in `manifest.json`, so it stays the
same wherever the folder lives. Its Kroger sign-in redirect address is:

```
https://fcmnhademmdokoehabmligddbgmkecab.chromiumapp.org/
```

## Set up your Kroger app (once)

Kroger only lets registered apps add to carts. Registering is free:

1. Sign in at <https://developer.kroger.com/manage/apps> with your Kroger account and click **Create App**.
2. Include the **Products**, **Locations**, and **Cart** APIs.
3. Add the redirect address above as a **Redirect URI**, exactly as written (with the trailing slash).
4. Copy the app's **Client ID** and **Client Secret** into the extension's settings, click **Save and test**,
   then **Sign in to Kroger** and pick your store.

The client secret and your Kroger sign-in are kept only in this browser's extension storage.

## Files

- `manifest.json`: Chrome extension manifest (Manifest V3)
- `background.js`: Kroger API calls (tokens, sign-in, product search, store lookup, add to cart)
- `matching.js`: turns grocery items into search terms, default quantities, and product picks
- `kroger-panel.js`: the button and review panel on kroger.com
- `site-bridge.js`: receives the list from the recipe book's **Send to Kroger** button
- `options.html`, `options.js`, `options.css`: settings page
