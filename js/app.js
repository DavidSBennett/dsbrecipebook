/*
 * app.js — the pages: recipe list, recipe view, add/edit, grocery list, backup.
 * Simple hash routes so it works on GitHub Pages and when opened straight from disk.
 *   #/                 recipes (search)
 *   #/recipe/<id>      one recipe
 *   #/recipe/<id>/edit edit
 *   #/add              paste & clean up / write your own
 *   #/grocery          grocery list builder
 *   #/backup           backup & sync
 */
(function () {
  'use strict';

  var Ing = window.Ingredients;
  var Parser = window.RecipeParser;
  var Store = window.Store;

  var main = document.getElementById('main');
  var cleanup = null;
  var firstRender = true;
  var homeState = { q: '', scope: 'all', tag: '' };
  var importDraft = null; // recipe being reviewed on the Add page

  // ------------------------------------------------------------ helpers

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $$(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function href(id) { return '#/recipe/' + encodeURIComponent(id); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }

  var toastTimer;
  function toast(msg) {
    var t = document.getElementById('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 3500);
  }

  function download(filename, text, type) {
    var blob = new Blob([text], { type: type || 'text/plain' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(text);
    return new Promise(function (resolve, reject) {
      var ta = document.createElement('textarea');
      ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy') ? resolve() : reject(); } catch (e) { reject(e); }
      ta.remove();
    });
  }

  function safeUrl(u) { return /^https?:\/\//i.test(u || '') ? u : ''; }

  function updateGroceryBadge() {
    var n = Object.keys(Store.getGrocery().picked).filter(function (id) { return Store.get(id); }).length;
    var b = document.getElementById('grocery-badge');
    b.hidden = !n;
    b.textContent = n ? String(n) : '';
    b.setAttribute('aria-label', n ? plural(n, 'recipe') + ' selected' : '');
  }

  function toggleGrocery(id) {
    var g = Store.getGrocery();
    var on = !g.picked[id];
    if (on) g.picked[id] = 1; else delete g.picked[id];
    Store.setGrocery(g);
    updateGroceryBadge();
    return on;
  }

  function factsHtml(r) {
    var facts = [
      ['Prep', r.prepTime], ['Cook', r.cookTime], ['Total', r.totalTime],
      ['Serves', r.servings ? Ing.formatQty(r.servings) : ''], ['Makes', r.yield],
      ['Calories', r.calories ? r.calories + ' per serving' : '']
    ].filter(function (f) { return f[1]; });
    if (!facts.length) return '';
    return '<dl class="facts">' + facts.map(function (f) {
      return '<div><dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd></div>';
    }).join('') + '</dl>';
  }

  function tagsHtml(tags) {
    if (!tags || !tags.length) return '';
    return '<ul class="tags" aria-label="Tags">' + tags.map(function (t) { return '<li>' + esc(t) + '</li>'; }).join('') + '</ul>';
  }

  // ------------------------------------------------------------ router

  function route() {
    if (cleanup) { try { cleanup(); } catch (e) { /* ignore */ } cleanup = null; }
    var parts = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    var page = parts[0] || 'home';
    var title;
    if (page === 'home') title = renderHome();
    else if (page === 'recipe' && parts[2] === 'edit') title = renderEdit(parts[1]);
    else if (page === 'recipe') title = renderRecipe(parts[1]);
    else if (page === 'add') title = renderAdd();
    else if (page === 'grocery') title = renderGrocery();
    else if (page === 'backup') title = renderBackup();
    else title = renderNotFound();

    document.title = title ? title + ' · DSB Recipe Book' : 'DSB Recipe Book';
    $$('[data-nav]').forEach(function (a) {
      if (a.getAttribute('data-nav') === page) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
    updateGroceryBadge();
    if (!firstRender) {
      window.scrollTo(0, 0);
      var h1 = $('h1', main);
      if (h1) { h1.setAttribute('tabindex', '-1'); h1.focus({ preventScroll: true }); }
    }
    firstRender = false;
  }

  function renderNotFound() {
    main.innerHTML = '<h1>Page not found</h1><p>That recipe may have been deleted.</p><p><a class="btn" href="#/">Back to all recipes</a></p>';
    return 'Not found';
  }

  // ------------------------------------------------------------ home / search

  function searchRecipes(list, q, scope, tag) {
    var terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    var results = [];
    list.forEach(function (r) {
      if (tag && r.tags.indexOf(tag) < 0) return;
      var title = r.title.toLowerCase();
      var ings = r.ingredients.map(function (s) { return s.toLowerCase(); });
      var tags = r.tags.join(' ');
      var other = [r.description, r.notes.join(' '), r.steps.join(' '), r.source.name].join(' ').toLowerCase();
      var score = 0, matchedIngs = [];
      for (var i = 0; i < terms.length; i++) {
        var t = terms[i], hit = false;
        if ((scope === 'all' || scope === 'title') && title.indexOf(t) >= 0) { score += 10; hit = true; }
        if (scope === 'all' || scope === 'ingredients') {
          var found = false;
          ings.forEach(function (line, idx) {
            if (line.indexOf(t) >= 0) { found = true; if (matchedIngs.indexOf(idx) < 0) matchedIngs.push(idx); }
          });
          if (found) { score += 4; hit = true; }
        }
        if (scope === 'all' && tags.indexOf(t) >= 0) { score += 5; hit = true; }
        if (scope === 'all' && other.indexOf(t) >= 0) { score += 1; hit = true; }
        if (!hit) return;
      }
      results.push({ recipe: r, score: score, matchedIngs: matchedIngs });
    });
    results.sort(function (a, b) { return b.score - a.score || a.recipe.title.localeCompare(b.recipe.title); });
    return results;
  }

  function renderHome() {
    var recipes = Store.all();
    var tagCounts = {};
    recipes.forEach(function (r) { r.tags.forEach(function (t) { tagCounts[t] = (tagCounts[t] || 0) + 1; }); });
    var tags = Object.keys(tagCounts).sort();
    if (homeState.tag && !tagCounts[homeState.tag]) homeState.tag = '';
    var pending = Store.unpublished();
    var pendingCount = pending.changed.length + pending.deleted.length;

    if (!recipes.length) {
      main.innerHTML =
        '<div class="page-head"><h1>My recipes</h1></div>' +
        '<div class="empty"><p>No recipes yet.</p><p><a class="btn btn-primary" href="#/add">Add your first recipe</a></p></div>';
      return 'Recipes';
    }

    main.innerHTML =
      '<div class="page-head"><h1>My recipes</h1><a class="btn btn-primary" href="#/add"><span aria-hidden="true">+</span> Add a recipe</a></div>' +
      (pendingCount ? '<p class="notice">' + plural(pendingCount, 'change') + ' saved only in this browser. <a href="#/backup">Publish or back them up</a> so you don’t lose them.</p>' : '') +
      '<div class="search" role="search">' +
        '<label for="q" class="field-label">Search recipes</label>' +
        '<div class="search-row">' +
          '<input id="q" type="search" autocomplete="off" spellcheck="false" placeholder="Try “chicken”, “spinach”, or “dinner”" value="' + esc(homeState.q) + '">' +
          '<label for="scope" class="sr-only">Search in</label>' +
          '<select id="scope">' +
            [['all', 'Everything'], ['title', 'Recipe names'], ['ingredients', 'Ingredients']].map(function (o) {
              return '<option value="' + o[0] + '"' + (homeState.scope === o[0] ? ' selected' : '') + '>' + o[1] + '</option>';
            }).join('') +
          '</select>' +
        '</div>' +
      '</div>' +
      (tags.length ? '<div class="chips" role="group" aria-label="Filter by tag">' +
        '<button type="button" class="chip" data-tag="" aria-pressed="' + (!homeState.tag) + '">All</button>' +
        tags.map(function (t) {
          return '<button type="button" class="chip" data-tag="' + esc(t) + '" aria-pressed="' + (homeState.tag === t) + '">' + esc(t) + ' <span class="chip-count">' + tagCounts[t] + '</span></button>';
        }).join('') + '</div>' : '') +
      '<p id="result-count" class="result-count" aria-live="polite"></p>' +
      '<ul id="results" class="card-grid"></ul>';

    var q = $('#q'), scope = $('#scope');
    function update() {
      homeState.q = q.value;
      homeState.scope = scope.value;
      var res = searchRecipes(recipes, homeState.q.trim(), homeState.scope, homeState.tag);
      var picked = Store.getGrocery().picked;
      $('#result-count').textContent = (homeState.q.trim() || homeState.tag)
        ? plural(res.length, 'recipe') + ' found'
        : plural(res.length, 'recipe');
      $('#results').innerHTML = res.length ? res.map(function (x) { return cardHtml(x, picked); }).join('')
        : '<li class="empty">No recipes match. Try a different word, or search “Everything”.</li>';
    }
    q.addEventListener('input', update);
    scope.addEventListener('change', update);
    main.addEventListener('click', onHomeClick);
    cleanup = function () { main.removeEventListener('click', onHomeClick); };
    function onHomeClick(e) {
      var chip = e.target.closest('.chip');
      if (chip) {
        homeState.tag = chip.getAttribute('data-tag');
        $$('.chip', main).forEach(function (c) { c.setAttribute('aria-pressed', String(c === chip)); });
        update();
        return;
      }
      var gb = e.target.closest('[data-grocery]');
      if (gb) {
        var id = gb.getAttribute('data-grocery');
        var on = toggleGrocery(id);
        gb.setAttribute('aria-pressed', String(on));
        gb.querySelector('.label').textContent = on ? 'On grocery list' : 'Add to grocery list';
        toast(on ? 'Added to your grocery list.' : 'Removed from your grocery list.');
      }
    }
    update();
    if (homeState.q) q.focus();
    return 'Recipes';
  }

  function cardHtml(x, picked) {
    var r = x.recipe;
    var meta = [r.totalTime || r.cookTime || r.prepTime, r.servings ? 'Serves ' + Ing.formatQty(r.servings) : '', plural(r.ingredients.filter(function (l) { return !Ing.isHeader(l); }).length, 'ingredient')]
      .filter(Boolean).map(esc).join('<span aria-hidden="true"> · </span>');
    var matches = x.matchedIngs.slice(0, 3).map(function (i) { return esc(r.ingredients[i]); });
    var on = !!picked[r.id];
    return '<li class="card">' +
      '<h2 class="card-title"><a href="' + href(r.id) + '">' + esc(r.title) + '</a></h2>' +
      (r.description ? '<p class="card-desc">' + esc(r.description) + '</p>' : '') +
      '<p class="card-meta">' + meta + '</p>' +
      (matches.length ? '<p class="card-match"><span class="sr-only">Matching ingredients: </span>' + matches.join('; ') + '</p>' : '') +
      tagsHtml(r.tags) +
      '<div class="card-actions"><button type="button" class="btn btn-small btn-ghost" data-grocery="' + esc(r.id) + '" aria-pressed="' + on + '">' +
        '<span class="check-icon" aria-hidden="true"></span><span class="label">' + (on ? 'On grocery list' : 'Add to grocery list') + '</span>' +
        '<span class="sr-only">: ' + esc(r.title) + '</span></button></div>' +
      '</li>';
  }

  // ------------------------------------------------------------ recipe view

  function renderRecipe(id) {
    var r = Store.get(id);
    if (!r) return renderNotFound();
    var base = r.servings || null;
    var servings = base || 1;
    var factor = 1;
    var picked = !!Store.getGrocery().picked[r.id];
    var src = safeUrl(r.source.url);

    main.innerHTML =
      '<p class="back"><a href="#/"><span aria-hidden="true">←</span> All recipes</a></p>' +
      '<article class="recipe">' +
        '<header class="recipe-head">' +
          '<h1>' + esc(r.title) + '</h1>' +
          (r.description ? '<p class="lede">' + esc(r.description) + '</p>' : '') +
          factsHtml(r) +
          tagsHtml(r.tags) +
          '<div class="actions" role="group" aria-label="Recipe actions">' +
            '<button type="button" class="btn btn-primary" id="grocery-btn" aria-pressed="' + picked + '"><span class="check-icon" aria-hidden="true"></span><span class="label">' + (picked ? 'On grocery list' : 'Add to grocery list') + '</span></button>' +
            '<button type="button" class="btn" id="cook-btn" aria-pressed="false">Cook mode</button>' +
            '<button type="button" class="btn" id="print-btn">Print</button>' +
            '<a class="btn" href="' + href(r.id) + '/edit">Edit</a>' +
            '<button type="button" class="btn btn-danger" id="delete-btn">Delete</button>' +
          '</div>' +
          '<p class="cook-hint" id="cook-hint" hidden></p>' +
        '</header>' +
        (safeUrl(r.image) ? '<img class="recipe-image" src="' + esc(r.image) + '" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()">' : '') +
        '<div class="recipe-body">' +
          '<section class="ingredients panel" aria-labelledby="ing-h">' +
            '<div class="section-head"><h2 id="ing-h">Ingredients</h2>' +
              '<div class="scaler" role="group" aria-label="Adjust amounts">' +
                '<button type="button" class="btn btn-icon" id="less" aria-label="Fewer servings">−</button>' +
                '<output id="serv-out" aria-live="polite"></output>' +
                '<button type="button" class="btn btn-icon" id="more" aria-label="More servings">+</button>' +
              '</div>' +
            '</div>' +
            '<p class="hint">Tap an ingredient to check it off.</p>' +
            '<ul class="check-list" id="ing-list"></ul>' +
          '</section>' +
          '<section class="steps" aria-labelledby="steps-h">' +
            '<h2 id="steps-h">Steps</h2>' +
            '<p class="hint">Tap a step when it’s done.</p>' +
            stepsHtml(r.steps) +
          '</section>' +
        '</div>' +
        (r.notes.length ? '<section class="notes panel" aria-labelledby="notes-h"><h2 id="notes-h">Notes</h2><ul>' +
          r.notes.map(function (n) {
            var m = n.match(/^([^:]{2,30}):\s+(.*)$/);
            return '<li>' + (m ? '<strong>' + esc(m[1]) + ':</strong> ' + esc(m[2]) : esc(n)) + '</li>';
          }).join('') + '</ul></section>' : '') +
        (src ? '<p class="source">Adapted from <a href="' + esc(src) + '" target="_blank" rel="noopener noreferrer">' + esc(r.source.name || src) + '<span class="sr-only"> (opens in a new tab)</span></a></p>' : '') +
      '</article>';

    function drawIngredients() {
      var checked = $$('#ing-list input:checked').map(function (c) { return c.getAttribute('data-i'); });
      $('#ing-list').innerHTML = r.ingredients.map(function (line, i) {
        if (Ing.isHeader(line)) return '<li class="group">' + esc(line.replace(/:$/, '')) + '</li>';
        var p = Ing.scaleParts(line, factor);
        return '<li><label class="check"><input type="checkbox" data-i="' + i + '"' + (checked.indexOf(String(i)) >= 0 ? ' checked' : '') + '>' +
          '<span>' + (p.amount ? '<strong class="amt">' + esc(p.amount) + '</strong> ' : '') + esc(p.rest) + '</span></label></li>';
      }).join('');
      $('#serv-out').textContent = base
        ? 'Serves ' + Ing.formatQty(servings)
        : (factor === 1 ? 'Original amounts' : '×' + Ing.formatQty(factor));
      $('#less').disabled = base ? servings <= 1 : factor <= 0.5;
    }
    drawIngredients();

    $('#less').addEventListener('click', function () {
      if (base) { servings = Math.max(1, servings - 1); factor = servings / base; }
      else factor = Math.max(0.5, factor - 0.5);
      drawIngredients();
    });
    $('#more').addEventListener('click', function () {
      if (base) { servings += 1; factor = servings / base; }
      else factor += 0.5;
      drawIngredients();
    });

    $('#grocery-btn').addEventListener('click', function () {
      var on = toggleGrocery(r.id);
      this.setAttribute('aria-pressed', String(on));
      this.querySelector('.label').textContent = on ? 'On grocery list' : 'Add to grocery list';
      toast(on ? 'Added to your grocery list.' : 'Removed from your grocery list.');
    });
    $('#print-btn').addEventListener('click', function () { window.print(); });
    $('#delete-btn').addEventListener('click', function () {
      if (!confirm('Delete “' + r.title + '”? This can’t be undone.')) return;
      Store.remove(r.id);
      toast('Deleted “' + r.title + '”.');
      location.hash = '#/';
    });

    // Cook mode: bigger text, and keep the screen awake where the browser allows it.
    var wakeLock = null;
    var cookBtn = $('#cook-btn');
    function releaseWake() { if (wakeLock) { wakeLock.release().catch(function () {}); wakeLock = null; } }
    function requestWake() {
      if (!('wakeLock' in navigator)) return Promise.resolve(false);
      return navigator.wakeLock.request('screen').then(function (l) { wakeLock = l; return true; }).catch(function () { return false; });
    }
    function onVisible() { if (document.visibilityState === 'visible' && document.body.classList.contains('cook-mode')) requestWake(); }
    cookBtn.addEventListener('click', function () {
      var on = !document.body.classList.contains('cook-mode');
      document.body.classList.toggle('cook-mode', on);
      cookBtn.setAttribute('aria-pressed', String(on));
      var hint = $('#cook-hint');
      if (on) {
        requestWake().then(function (ok) {
          hint.hidden = false;
          hint.textContent = ok ? 'Cook mode is on: bigger text, and your screen will stay awake.' : 'Cook mode is on: bigger text. (This browser can’t keep the screen awake.)';
        });
      } else { releaseWake(); hint.hidden = true; }
    });
    document.addEventListener('visibilitychange', onVisible);
    cleanup = function () {
      releaseWake();
      document.body.classList.remove('cook-mode');
      document.removeEventListener('visibilitychange', onVisible);
    };
    return r.title;
  }

  function stepsHtml(steps) {
    if (!steps.length) return '<p class="muted">No steps yet. Use Edit to add them.</p>';
    var n = 0;
    return '<ol class="step-list">' + steps.map(function (s) {
      if (Ing.isHeader(s)) return '<li class="group">' + esc(s.replace(/:$/, '')) + '</li>';
      n++;
      return '<li><label class="step"><input type="checkbox" class="sr-only step-check"><span class="step-num" aria-hidden="true">' + n + '</span>' +
        '<span class="step-text"><span class="sr-only">Step ' + n + ': </span>' + esc(s) + '</span></label></li>';
    }).join('') + '</ol>';
  }

  // ------------------------------------------------------------ add / edit form

  function formHtml(r, opts) {
    function field(id, label, value, extra) {
      return '<div class="field"><label for="' + id + '">' + label + '</label><input id="' + id + '" name="' + id + '" value="' + esc(value) + '"' + (extra || '') + '></div>';
    }
    return '<form id="recipe-form" class="recipe-form" novalidate>' +
      '<div class="field"><label for="f-title">Recipe name <span class="req">(required)</span></label>' +
        '<input id="f-title" name="title" required value="' + esc(r.title) + '"></div>' +
      '<div class="field-grid">' +
        field('f-servings', 'Servings', r.servings || '', ' type="number" min="0" step="any" inputmode="decimal"') +
        field('f-prep', 'Prep time', r.prepTime, ' placeholder="e.g. 10 mins"') +
        field('f-cook', 'Cook time', r.cookTime, ' placeholder="e.g. 35 mins"') +
        field('f-total', 'Total time', r.totalTime, ' placeholder="e.g. 45 mins"') +
        field('f-cal', 'Calories per serving', r.calories, ' inputmode="numeric"') +
        field('f-yield', 'Makes (optional)', r.yield, ' placeholder="e.g. 24 cookies"') +
      '</div>' +
      '<div class="field"><label for="f-tags">Tags</label><p class="hint" id="f-tags-hint">Separate with commas, e.g. chicken, dinner, quick.</p>' +
        '<input id="f-tags" aria-describedby="f-tags-hint" value="' + esc(r.tags.join(', ')) + '"></div>' +
      '<div class="field"><label for="f-ing">Ingredients</label><p class="hint" id="f-ing-hint">One per line. End a line with a colon (like “For the sauce:”) to make a sub-heading.</p>' +
        '<textarea id="f-ing" rows="' + Math.max(8, r.ingredients.length + 2) + '" aria-describedby="f-ing-hint">' + esc(r.ingredients.join('\n')) + '</textarea></div>' +
      '<div class="field"><label for="f-steps">Steps</label><p class="hint" id="f-steps-hint">One step per line.</p>' +
        '<textarea id="f-steps" rows="' + Math.max(8, r.steps.length * 3 + 2) + '" aria-describedby="f-steps-hint">' + esc(r.steps.join('\n')) + '</textarea></div>' +
      '<div class="field"><label for="f-notes">Notes</label><p class="hint" id="f-notes-hint">Optional. One note per line: tips, swaps, storage.</p>' +
        '<textarea id="f-notes" rows="4" aria-describedby="f-notes-hint">' + esc(r.notes.join('\n')) + '</textarea></div>' +
      '<div class="field"><label for="f-desc">Short description</label><p class="hint" id="f-desc-hint">Optional. One sentence shown on the recipe card.</p>' +
        '<textarea id="f-desc" rows="2" aria-describedby="f-desc-hint">' + esc(r.description) + '</textarea></div>' +
      '<div class="field-grid two">' +
        field('f-url', 'Original recipe link', r.source.url, ' type="url" inputmode="url" placeholder="https://"') +
        field('f-image', 'Photo link (optional)', r.image, ' type="url" inputmode="url" placeholder="https://"') +
      '</div>' +
      '<p class="form-error" id="form-error" role="alert"></p>' +
      '<div class="form-actions"><button type="submit" class="btn btn-primary">' + esc(opts.submitLabel || 'Save recipe') + '</button>' +
        '<a class="btn btn-ghost" href="' + esc(opts.cancelHref || '#/') + '">Cancel</a></div>' +
      '</form>';
  }

  function readForm(form, original) {
    function v(id) { return $('#' + id, form).value; }
    var url = v('f-url').trim();
    return Store.normalize({
      id: original.id,
      title: v('f-title'),
      servings: v('f-servings'),
      prepTime: v('f-prep'), cookTime: v('f-cook'), totalTime: v('f-total'),
      calories: v('f-cal'), yield: v('f-yield'),
      tags: v('f-tags').split(','),
      ingredients: v('f-ing').split('\n'),
      steps: v('f-steps').split('\n'),
      notes: v('f-notes').split('\n'),
      description: v('f-desc'),
      source: { url: url, name: url === original.source.url && original.source.name ? original.source.name : hostOf(url) },
      image: v('f-image'),
      created: original.created
    });
  }

  function hostOf(url) { try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; } }

  function bindForm(form, original, onSaved) {
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var err = $('#form-error', form);
      var title = $('#f-title', form);
      if (!title.value.trim()) {
        err.textContent = 'Please give the recipe a name.';
        title.setAttribute('aria-invalid', 'true');
        title.focus();
        return;
      }
      title.removeAttribute('aria-invalid');
      var r = readForm(form, original);
      if (!original.id && r.source.url) {
        var dupe = Store.all().filter(function (x) { return x.source.url === r.source.url; })[0];
        if (dupe && !confirm('You already saved this one as “' + dupe.title + '”. Save another copy anyway?')) return;
      }
      var saved = Store.save(r);
      onSaved(saved);
    });
  }

  function renderEdit(id) {
    var r = Store.get(id);
    if (!r) return renderNotFound();
    main.innerHTML = '<p class="back"><a href="' + href(r.id) + '"><span aria-hidden="true">←</span> Back to recipe</a></p>' +
      '<h1>Edit recipe</h1>' + formHtml(r, { submitLabel: 'Save changes', cancelHref: href(r.id) });
    bindForm($('#recipe-form'), r, function (saved) {
      toast('Saved.');
      location.hash = href(saved.id);
    });
    return 'Edit ' + r.title;
  }

  function renderAdd() {
    main.innerHTML =
      '<div class="page-head"><h1>Add a recipe</h1></div>' +
      '<section class="panel import" aria-labelledby="paste-h">' +
        '<h2 id="paste-h">Paste a recipe from any website</h2>' +
        '<ol class="how">' +
          '<li>On the recipe’s web page, press <kbd>Ctrl</kbd>+<kbd>A</kbd> (select all), then <kbd>Ctrl</kbd>+<kbd>C</kbd> (copy). On a Mac use <kbd>⌘</kbd>.</li>' +
          '<li>Click in the box below and press <kbd>Ctrl</kbd>+<kbd>V</kbd> to paste.</li>' +
          '<li>Ads, life stories, reviews, and links get stripped out. You check the result, then save.</li>' +
        '</ol>' +
        '<div class="dropzone" id="dropzone">' +
          '<label for="paste" class="field-label">Recipe page</label>' +
          '<p class="hint" id="paste-hint">Paste the whole page, or drop a saved web page (.html) file here.</p>' +
          '<textarea id="paste" rows="10" aria-describedby="paste-hint" placeholder="Paste here…"></textarea>' +
        '</div>' +
        '<div class="row">' +
          '<button type="button" class="btn btn-primary" id="clean-btn">Clean it up</button>' +
          '<label class="btn file-btn">Open a saved page…<input type="file" id="file-in" accept=".html,.htm,.txt,.md" class="sr-only"></label>' +
          '<button type="button" class="btn btn-ghost" id="scratch-btn">Write my own recipe</button>' +
        '</div>' +
        '<p class="status" id="paste-status" aria-live="polite"></p>' +
      '</section>' +
      '<section id="review" aria-labelledby="review-h"></section>';

    var paste = $('#paste');
    var status = $('#paste-status');
    var clip = { html: '', text: '' };

    function showReview(recipe, warnings, intro) {
      importDraft = recipe;
      var box = $('#review');
      box.innerHTML =
        '<div class="review-head"><h2 id="review-h" tabindex="-1">' + esc(intro) + '</h2></div>' +
        (warnings && warnings.length ? '<div class="notice warn"><ul>' + warnings.map(function (w) { return '<li>' + esc(w) + '</li>'; }).join('') + '</ul></div>' : '') +
        formHtml(recipe, { submitLabel: 'Save recipe', cancelHref: '#/' });
      bindForm($('#recipe-form', box), recipe, function (saved) {
        importDraft = null;
        toast('Saved “' + saved.title + '”.');
        location.hash = href(saved.id);
      });
      var h = $('#review-h');
      h.scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
      h.focus({ preventScroll: true });
    }

    function runClean(input) {
      var hasSomething = (input.text && input.text.trim()) || (input.html && input.html.trim());
      if (!hasSomething) {
        status.textContent = 'Paste a recipe page into the box first.';
        paste.focus();
        return;
      }
      var only = (input.text || '').trim();
      if (!input.html && /^https?:\/\/\S+$/.test(only)) {
        status.textContent = 'Websites won’t let this page download them directly. Open that link, copy the whole page (Ctrl+A, Ctrl+C), and paste it here.';
        return;
      }
      var res = Parser.parse(input);
      var r = Store.normalize(res.recipe);
      var n = r.ingredients.filter(function (l) { return !Ing.isHeader(l); }).length;
      status.textContent = 'Found ' + plural(n, 'ingredient') + ' and ' + plural(r.steps.length, 'step') + '.';
      showReview(r, res.warnings, res.warnings.length ? 'Almost there. Fill in what’s missing' : 'Check it over, then save');
    }

    paste.addEventListener('paste', function (e) {
      var cd = e.clipboardData;
      clip.html = cd ? cd.getData('text/html') : '';
      setTimeout(function () {
        clip.text = paste.value;
        runClean({ text: paste.value, html: clip.html });
      }, 0);
    });
    $('#clean-btn').addEventListener('click', function () {
      // Use the formatted copy only if the box still holds exactly what was pasted.
      var html = clip.html && paste.value === clip.text ? clip.html : '';
      runClean({ text: paste.value, html: html });
    });
    $('#scratch-btn').addEventListener('click', function () {
      status.textContent = '';
      showReview(Store.normalize({}), [], 'Write your recipe');
      $('#f-title').focus();
    });

    function readFile(file) {
      if (!file) return;
      var reader = new FileReader();
      reader.onload = function () {
        status.textContent = 'Opened ' + file.name + '.';
        var text = String(reader.result || '');
        clip = { html: '', text: '' };
        paste.value = '';
        if (/\.html?$/i.test(file.name) || /<html|<body|<div/i.test(text)) runClean({ html: text });
        else { paste.value = text; runClean({ text: text }); }
      };
      reader.onerror = function () { status.textContent = 'Couldn’t read that file.'; };
      reader.readAsText(file);
    }
    $('#file-in').addEventListener('change', function () { readFile(this.files[0]); this.value = ''; });

    var dz = $('#dropzone');
    dz.addEventListener('dragover', function (e) { e.preventDefault(); dz.classList.add('dragging'); });
    dz.addEventListener('dragleave', function () { dz.classList.remove('dragging'); });
    dz.addEventListener('drop', function (e) {
      e.preventDefault();
      dz.classList.remove('dragging');
      var dt = e.dataTransfer;
      if (dt.files && dt.files.length) { readFile(dt.files[0]); return; }
      var html = dt.getData('text/html'), text = dt.getData('text/plain');
      paste.value = text;
      clip = { html: html, text: text };
      runClean({ text: text, html: html });
    });

    if (importDraft) showReview(importDraft, [], 'Check it over, then save');
    return 'Add a recipe';
  }

  // ------------------------------------------------------------ grocery list

  var MULTIPLIERS = [0.5, 1, 1.5, 2, 3, 4];

  function renderGrocery() {
    var recipes = Store.all();
    var g = Store.getGrocery();
    Object.keys(g.picked).forEach(function (id) { if (!Store.get(id)) delete g.picked[id]; });
    Store.setGrocery(g);

    main.innerHTML =
      '<div class="page-head"><h1>Grocery list</h1></div>' +
      '<div class="grocery-layout">' +
        '<section class="panel pick" aria-labelledby="pick-h">' +
          '<h2 id="pick-h"><span class="step-pill" aria-hidden="true">1</span> Pick recipes</h2>' +
          (recipes.length > 8 ? '<label for="pick-filter" class="sr-only">Filter recipes</label><input id="pick-filter" type="search" placeholder="Filter recipes…" class="pick-filter">' : '') +
          (recipes.length ? '<ul class="pick-list" id="pick-list">' + recipes.map(function (r) { return pickRow(r, g); }).join('') + '</ul>'
            : '<p>No recipes yet. <a href="#/add">Add one</a> first.</p>') +
        '</section>' +
        '<section class="panel list" aria-labelledby="list-h">' +
          '<h2 id="list-h"><span class="step-pill" aria-hidden="true">2</span> Shop</h2>' +
          '<p class="result-count" id="g-summary" aria-live="polite"></p>' +
          '<div class="toolbar" role="group" aria-label="List actions">' +
            '<button type="button" class="btn btn-small" id="g-copy">Copy list</button>' +
            '<button type="button" class="btn btn-small" id="g-print">Print</button>' +
            '<button type="button" class="btn btn-small btn-ghost" id="g-uncheck">Uncheck all</button>' +
            '<button type="button" class="btn btn-small btn-ghost" id="g-clear">Start over</button>' +
          '</div>' +
          '<form class="extra-form" id="extra-form"><label for="extra-in" class="sr-only">Add something else to the list</label>' +
            '<input id="extra-in" placeholder="Add something else (e.g. paper towels)" autocomplete="off"><button type="submit" class="btn btn-small">Add</button></form>' +
          '<div id="g-out"></div>' +
        '</section>' +
      '</div>';

    function currentList() {
      var gg = Store.getGrocery();
      var entries = Object.keys(gg.picked).map(function (id) { return { recipe: Store.get(id), factor: gg.picked[id] }; })
        .filter(function (e) { return e.recipe; });
      return { g: gg, entries: entries, groups: Ing.buildGroceryList(entries) };
    }

    function draw() {
      var cur = currentList(), gg = cur.g;
      var total = 0, done = 0;
      var html = cur.groups.map(function (grp) {
        return '<h3 class="aisle">' + esc(grp.category) + '</h3><ul class="check-list grocery-items">' + grp.items.map(function (it) {
          total++;
          var ck = !!gg.checked[it.key];
          if (ck) done++;
          return '<li><label class="check"><input type="checkbox" data-item="' + esc(it.key) + '"' + (ck ? ' checked' : '') + '>' +
            '<span>' + (it.amount ? '<strong class="amt">' + esc(it.amount) + '</strong> ' : '') + esc(it.name) +
            '<span class="for">' + esc(it.recipes.join(' · ')) + '</span></span></label></li>';
        }).join('') + '</ul>';
      }).join('');
      if (gg.extras.length) {
        html += '<h3 class="aisle">Also</h3><ul class="check-list grocery-items">' + gg.extras.map(function (x, i) {
          total++;
          if (x.checked) done++;
          return '<li class="extra"><label class="check"><input type="checkbox" data-extra="' + i + '"' + (x.checked ? ' checked' : '') + '><span>' + esc(x.text) + '</span></label>' +
            '<button type="button" class="btn btn-icon btn-ghost" data-remove-extra="' + i + '" aria-label="Remove ' + esc(x.text) + '">×</button></li>';
        }).join('') + '</ul>';
      }
      $('#g-out').innerHTML = html || '<p class="empty">Pick one or more recipes and your shopping list appears here, combined and sorted by aisle.</p>';
      $('#g-summary').textContent = total
        ? plural(total, 'item') + ' from ' + plural(cur.entries.length, 'recipe') + (done ? ' · ' + done + ' in the cart' : '')
        : '';
      updateGroceryBadge();
    }

    function listAsText() {
      var cur = currentList(), lines = ['Grocery list', ''];
      cur.entries.forEach(function (e) { lines.push('For: ' + e.recipe.title + (e.factor !== 1 ? ' (×' + Ing.formatQty(e.factor) + ')' : '')); });
      cur.groups.forEach(function (grp) {
        lines.push('', grp.category.toUpperCase());
        grp.items.forEach(function (it) { lines.push((cur.g.checked[it.key] ? '[x] ' : '[ ] ') + (it.amount ? it.amount + ' ' : '') + it.name); });
      });
      if (cur.g.extras.length) {
        lines.push('', 'ALSO');
        cur.g.extras.forEach(function (x) { lines.push((x.checked ? '[x] ' : '[ ] ') + x.text); });
      }
      return lines.join('\n');
    }

    function onChange(e) {
      var t = e.target, gg = Store.getGrocery();
      if (t.hasAttribute('data-pick')) {
        var id = t.getAttribute('data-pick');
        var sel = $('#mult-' + CSS.escape(id));
        if (t.checked) gg.picked[id] = parseFloat(sel.value) || 1; else delete gg.picked[id];
        sel.disabled = !t.checked;
      } else if (t.hasAttribute('data-mult')) {
        gg.picked[t.getAttribute('data-mult')] = parseFloat(t.value) || 1;
      } else if (t.hasAttribute('data-item')) {
        if (t.checked) gg.checked[t.getAttribute('data-item')] = true; else delete gg.checked[t.getAttribute('data-item')];
      } else if (t.hasAttribute('data-extra')) {
        var x = gg.extras[+t.getAttribute('data-extra')];
        if (x) x.checked = t.checked;
      } else return;
      Store.setGrocery(gg);
      draw();
    }
    main.addEventListener('change', onChange);

    $('#extra-form').addEventListener('submit', function (e) {
      e.preventDefault();
      var inp = $('#extra-in'), v = inp.value.trim();
      if (!v) return;
      var gg = Store.getGrocery();
      gg.extras.push({ text: v, checked: false });
      Store.setGrocery(gg);
      inp.value = '';
      draw();
      toast('Added “' + v + '”.');
    });
    $('#g-out').addEventListener('click', function (e) {
      var b = e.target.closest('[data-remove-extra]');
      if (!b) return;
      var gg = Store.getGrocery();
      gg.extras.splice(+b.getAttribute('data-remove-extra'), 1);
      Store.setGrocery(gg);
      draw();
      $('#extra-in').focus();
    });
    $('#g-copy').addEventListener('click', function () {
      copyText(listAsText()).then(function () { toast('List copied. Paste it into a text or note.'); }, function () { toast('Couldn’t copy. Try Print instead.'); });
    });
    $('#g-print').addEventListener('click', function () { window.print(); });
    $('#g-uncheck').addEventListener('click', function () {
      var gg = Store.getGrocery();
      gg.checked = {};
      gg.extras.forEach(function (x) { x.checked = false; });
      Store.setGrocery(gg);
      draw();
    });
    $('#g-clear').addEventListener('click', function () {
      if (!confirm('Clear the recipes, check marks, and extra items from your grocery list?')) return;
      Store.setGrocery({ picked: {}, checked: {}, extras: [] });
      renderGrocery();
      toast('Grocery list cleared.');
    });
    var filter = $('#pick-filter');
    if (filter) filter.addEventListener('input', function () {
      var q = filter.value.toLowerCase().trim();
      $$('#pick-list > li').forEach(function (li) { li.hidden = q && li.getAttribute('data-title').indexOf(q) < 0; });
    });

    cleanup = function () { main.removeEventListener('change', onChange); };
    draw();
    return 'Grocery list';
  }

  function pickRow(r, g) {
    var on = g.picked[r.id] != null;
    var mult = on ? g.picked[r.id] : 1;
    var id = esc(r.id);
    return '<li data-title="' + esc(r.title.toLowerCase()) + '">' +
      '<label class="check"><input type="checkbox" data-pick="' + id + '"' + (on ? ' checked' : '') + '><span>' + esc(r.title) + '</span></label>' +
      '<label class="sr-only" for="mult-' + id + '">How much of ' + esc(r.title) + '</label>' +
      '<select id="mult-' + id + '" data-mult="' + id + '"' + (on ? '' : ' disabled') + '>' +
        MULTIPLIERS.map(function (m) {
          var label = '×' + Ing.formatQty(m) + (r.servings ? ' (' + Ing.formatQty(r.servings * m) + (r.servings * m === 1 ? ' serving)' : ' servings)') : '');
          return '<option value="' + m + '"' + (m === mult ? ' selected' : '') + '>' + esc(label) + '</option>';
        }).join('') +
      '</select></li>';
  }

  // ------------------------------------------------------------ backup & sync

  function renderBackup() {
    var all = Store.all();
    var pend = Store.unpublished();
    var changedTitles = pend.changed.map(function (id) { var r = Store.get(id); return r ? r.title : id; });

    main.innerHTML =
      '<div class="page-head"><h1>Backup &amp; sync</h1></div>' +
      '<p class="lede">You have ' + plural(all.length, 'recipe') + '. New recipes and edits are saved in <strong>this browser</strong> right away. ' +
      'To see them on your other devices, or to keep them safe if this browser’s data gets cleared, publish them to the website or keep a backup file.</p>' +
      '<section class="panel" aria-labelledby="pub-h">' +
        '<h2 id="pub-h">Publish to the website</h2>' +
        (pend.changed.length || pend.deleted.length
          ? '<p>Not yet published: ' + (changedTitles.length ? esc(changedTitles.join(', ')) : '') +
            (pend.deleted.length ? (changedTitles.length ? '; ' : '') + plural(pend.deleted.length, 'deleted recipe') : '') + '.</p>'
          : '<p>Everything in this browser is already published.</p>') +
        '<ol class="how"><li>Download the recipes file.</li>' +
        '<li>Replace <code>data/recipes.js</code> in your <code>dsbrecipebook</code> folder with it.</li>' +
        '<li>Commit and push the change to GitHub. The live site updates in a minute or two.</li></ol>' +
        '<button type="button" class="btn btn-primary" id="dl-site">Download recipes.js</button>' +
      '</section>' +
      '<section class="panel" aria-labelledby="bk-h">' +
        '<h2 id="bk-h">Backup file</h2>' +
        '<p>A single file with all your recipes. Restoring adds them back to this browser.</p>' +
        '<div class="row"><button type="button" class="btn" id="dl-json">Download backup</button>' +
        '<label class="btn file-btn">Restore from backup…<input type="file" id="restore-in" accept=".json,application/json" class="sr-only"></label></div>' +
      '</section>' +
      '<section class="panel" aria-labelledby="reset-h">' +
        '<h2 id="reset-h">Start fresh in this browser</h2>' +
        '<p>Forget recipes and edits stored in this browser. Published recipes stay.</p>' +
        '<button type="button" class="btn btn-danger" id="reset-btn">Clear this browser’s recipes</button>' +
      '</section>';

    $('#dl-site').addEventListener('click', function () {
      download('recipes.js', Store.exportSiteFile(), 'text/javascript');
      toast('Downloaded recipes.js.');
    });
    $('#dl-json').addEventListener('click', function () {
      download('dsb-recipe-book-backup-' + new Date().toISOString().slice(0, 10) + '.json', Store.exportBackup(), 'application/json');
      toast('Backup downloaded.');
    });
    $('#restore-in').addEventListener('change', function () {
      var f = this.files[0];
      this.value = '';
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        try {
          var n = Store.importBackup(String(reader.result));
          toast('Restored ' + plural(n, 'recipe') + '.');
          renderBackup();
        } catch (e) { toast(e.message || 'That file couldn’t be read.'); }
      };
      reader.readAsText(f);
    });
    $('#reset-btn').addEventListener('click', function () {
      if (!confirm('Remove every recipe and edit saved only in this browser? Published recipes stay.')) return;
      Store.resetLocal();
      toast('This browser’s recipes were cleared.');
      renderBackup();
    });
    return 'Backup & sync';
  }

  // ------------------------------------------------------------ go

  window.addEventListener('hashchange', route);
  route();
})();
