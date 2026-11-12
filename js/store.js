/*
 * store.js — where recipes live.
 *
 * Two layers:
 *   1. data/recipes.js  — recipes published with the website (same on every device).
 *   2. This browser     — recipes you add or edit here (saved in localStorage).
 * When this browser is connected to GitHub (js/github.js), changes are published automatically;
 * otherwise "Backup & sync" downloads a new data/recipes.js to publish by hand.
 *
 * Right after an automatic publish, GitHub Pages can take a minute or two to serve the new file,
 * so the last published list is also kept here (K_PUBLISHED) and used until the site catches up.
 */
(function (root) {
  'use strict';

  var K_RECIPES = 'dsbrb.recipes.v1';
  var K_DELETED = 'dsbrb.deleted.v1';
  var K_GROCERY = 'dsbrb.grocery.v1';
  var K_PUBLISHED = 'dsbrb.published.v1';
  var memory = {};

  function read(key, fallback) {
    try {
      var v = root.localStorage.getItem(key);
      return v ? JSON.parse(v) : fallback;
    } catch (e) {
      return key in memory ? memory[key] : fallback;
    }
  }
  function write(key, value) {
    memory[key] = value;
    try { root.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }
  function forget(key) {
    delete memory[key];
    try { root.localStorage.removeItem(key); } catch (e) { /* ignore */ }
  }

  function arr(v) {
    return (Array.isArray(v) ? v : String(v || '').split('\n'))
      .map(function (s) { return String(s == null ? '' : s).trim(); })
      .filter(Boolean);
  }

  function normalize(r) {
    r = r || {};
    var servings = parseFloat(r.servings);
    var tags = arr(r.tags).map(function (t) { return t.toLowerCase(); })
      .filter(function (t, i, a) { return a.indexOf(t) === i; });
    return {
      id: String(r.id || ''),
      title: String(r.title || '').trim() || 'Untitled recipe',
      description: String(r.description || '').trim(),
      servings: isFinite(servings) && servings > 0 ? servings : null,
      yield: String(r.yield || '').trim(),
      prepTime: String(r.prepTime || '').trim(),
      cookTime: String(r.cookTime || '').trim(),
      totalTime: String(r.totalTime || '').trim(),
      calories: String(r.calories || '').trim(),
      tags: tags,
      ingredients: arr(r.ingredients),
      steps: arr(r.steps),
      notes: arr(r.notes),
      source: { url: String((r.source && r.source.url) || '').trim(), name: String((r.source && r.source.name) || '').trim() },
      image: String(r.image || '').trim(),
      created: r.created || '',
      updated: r.updated || ''
    };
  }

  function slugify(s) {
    return String(s || 'recipe').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'recipe';
  }

  // The published list: data/recipes.js, unless this browser just published something newer.
  var published = (function () {
    var served = Array.isArray(root.SEED_RECIPES) ? root.SEED_RECIPES : [];
    var cache = read(K_PUBLISHED, null);
    if (cache && Array.isArray(cache.recipes) && String(cache.version || '') > String(root.SEED_VERSION || '')) return cache.recipes;
    if (cache) forget(K_PUBLISHED);
    return served;
  })();

  function seedList() {
    return published.map(normalize).filter(function (r) { return r.id; });
  }
  function seedMap() {
    var m = {};
    seedList().forEach(function (r) { m[r.id] = r; });
    return m;
  }
  function same(a, b) {
    var x = Object.assign({}, a, { updated: '', created: '' });
    var y = Object.assign({}, b, { updated: '', created: '' });
    return JSON.stringify(x) === JSON.stringify(y);
  }

  // Tidy up: drop local copies that are now identical to the published file.
  function prune() {
    var seed = seedMap();
    var local = read(K_RECIPES, {});
    var changed = false;
    Object.keys(local).forEach(function (id) {
      if (seed[id] && same(normalize(local[id]), seed[id])) { delete local[id]; changed = true; }
    });
    if (changed) write(K_RECIPES, local);
    var deleted = read(K_DELETED, []).filter(function (id) { return seed[id]; });
    write(K_DELETED, deleted);
  }
  prune();

  function all() {
    var seed = seedMap();
    var local = read(K_RECIPES, {});
    var deleted = read(K_DELETED, []);
    var map = {};
    Object.keys(seed).forEach(function (id) { map[id] = seed[id]; });
    Object.keys(local).forEach(function (id) { map[id] = normalize(Object.assign({}, local[id], { id: id })); });
    deleted.forEach(function (id) { delete map[id]; });
    return Object.keys(map).map(function (id) { return map[id]; })
      .sort(function (a, b) { return a.title.localeCompare(b.title); });
  }

  function get(id) {
    var list = all();
    for (var i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return null;
  }

  function save(recipe) {
    var r = normalize(recipe);
    var now = new Date().toISOString();
    if (!r.id) {
      var base = slugify(r.title), id = base, n = 2;
      var taken = {};
      all().forEach(function (x) { taken[x.id] = true; });
      while (taken[id]) id = base + '-' + (n++);
      r.id = id;
      r.created = now;
    }
    r.updated = now;
    var local = read(K_RECIPES, {});
    local[r.id] = r;
    write(K_RECIPES, local);
    write(K_DELETED, read(K_DELETED, []).filter(function (x) { return x !== r.id; }));
    return r;
  }

  function remove(id) {
    var local = read(K_RECIPES, {});
    delete local[id];
    write(K_RECIPES, local);
    if (seedMap()[id]) {
      var deleted = read(K_DELETED, []);
      if (deleted.indexOf(id) < 0) deleted.push(id);
      write(K_DELETED, deleted);
    }
    var g = getGrocery();
    delete g.picked[id];
    setGrocery(g);
  }

  /** Changes made in this browser that aren't in data/recipes.js yet. */
  function unpublished() {
    var seed = seedMap();
    var local = read(K_RECIPES, {});
    var changed = Object.keys(local).filter(function (id) { return !seed[id] || !same(normalize(local[id]), seed[id]); });
    return { changed: changed, deleted: read(K_DELETED, []) };
  }
  function isUnpublished(id) { return unpublished().changed.indexOf(id) >= 0; }

  function pendingCount() { var p = unpublished(); return p.changed.length + p.deleted.length; }

  /** Every local add/edit and delete, to apply on top of the latest published file. */
  function pendingChanges() {
    var local = read(K_RECIPES, {});
    return {
      upserts: Object.keys(local).map(function (id) { return normalize(Object.assign({}, local[id], { id: id })); }),
      deletes: read(K_DELETED, []).slice()
    };
  }

  /** Called after a successful automatic publish: `list` is now what the website has. */
  function markPublished(list, version) {
    published = list;
    write(K_PUBLISHED, { version: version || '', recipes: list });
    prune();
  }

  function exportSiteFile(list, version) {
    list = list || all();
    version = version || new Date().toISOString();
    return '/*\n * Recipes published with the website.\n * Written by DSB Recipe Book on ' + version.slice(0, 10) + '.\n' +
      ' * Updated automatically when a browser is connected to GitHub (Backup & sync).\n' +
      ' * You can also replace this file by hand: Backup & sync -> "Download recipes.js", then commit and push.\n */\n' +
      'window.SEED_VERSION = ' + JSON.stringify(version) + ';\n' +
      'window.SEED_RECIPES = ' + JSON.stringify(list, null, 2) + ';\n';
  }
  function exportBackup() {
    return JSON.stringify({ app: 'dsb-recipe-book', version: 1, exported: new Date().toISOString(), recipes: all() }, null, 2);
  }
  function importBackup(text) {
    var data = JSON.parse(text);
    var list = Array.isArray(data) ? data : (data && data.recipes);
    if (!Array.isArray(list)) throw new Error('That file doesn’t contain any recipes.');
    var local = read(K_RECIPES, {});
    var count = 0;
    list.forEach(function (raw) {
      var r = normalize(raw);
      if (!r.id) r.id = slugify(r.title);
      local[r.id] = r;
      count++;
    });
    write(K_RECIPES, local);
    var ids = list.map(function (r) { return r.id; });
    write(K_DELETED, read(K_DELETED, []).filter(function (id) { return ids.indexOf(id) < 0; }));
    return count;
  }
  function resetLocal() {
    write(K_RECIPES, {});
    write(K_DELETED, []);
  }

  function getGrocery() {
    var g = read(K_GROCERY, null) || {};
    return { picked: g.picked || {}, checked: g.checked || {}, extras: g.extras || [] };
  }
  function setGrocery(g) { write(K_GROCERY, g); }

  root.Store = {
    all: all, get: get, save: save, remove: remove, normalize: normalize, slugify: slugify,
    unpublished: unpublished, isUnpublished: isUnpublished, pendingCount: pendingCount,
    pendingChanges: pendingChanges, markPublished: markPublished, same: same,
    exportSiteFile: exportSiteFile, exportBackup: exportBackup, importBackup: importBackup, resetLocal: resetLocal,
    getGrocery: getGrocery, setGrocery: setGrocery
  };
})(window);
