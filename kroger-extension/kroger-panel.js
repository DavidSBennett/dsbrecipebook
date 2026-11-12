/*
 * kroger-panel.js — runs on www.kroger.com.
 *
 * Shows an "Add recipe list" button when a grocery list has been sent from the recipe book.
 * The panel finds a Kroger product for each item (your pick from last time comes first),
 * lets you change products, quantities and what to include, then adds them all to your cart
 * through Kroger's Cart API (via background.js).
 *
 * Everything lives in a shadow root so kroger.com's styles and ours don't mix.
 */
(function () {
  'use strict';
  if (window.__dsbrbKroger) return;
  window.__dsbrbKroger = true;

  var M = window.DSBMatching;

  // ------------------------------------------------------------ messaging

  function send(msg) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(msg, function (r) {
          var err = chrome.runtime.lastError;
          resolve(r || { ok: false, code: 'gone', error: err ? err.message : 'No answer from the extension.' });
        });
      } catch (e) {
        resolve({ ok: false, code: 'gone', error: 'The extension was updated. Reload this page.' });
      }
    });
  }

  // ------------------------------------------------------------ shell

  var host = document.createElement('div');
  host.id = 'dsbrb-kroger-host';
  host.style.cssText = 'all: initial; position: fixed; z-index: 2147483000; inset: auto 0 0 auto;';
  var root = host.attachShadow({ mode: 'open' });
  var CSS = [
    ':host { all: initial; }',
    '* { box-sizing: border-box; }',
    '.wrap { font: 16px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; color: #1f1a16; }',
    '.fab { position: fixed; right: 20px; bottom: 20px; display: inline-flex; align-items: center; gap: .5rem; min-height: 48px; padding: .6rem 1.1rem;',
    '  border: 0; border-radius: 999px; background: #9a3412; color: #fff; font: 600 16px/1.2 system-ui, sans-serif; cursor: pointer; box-shadow: 0 6px 20px rgba(0,0,0,.25); }',
    '.fab:hover { background: #7c2d12; }',
    '.fab:focus-visible, button:focus-visible, select:focus-visible, input:focus-visible, a:focus-visible { outline: 3px solid #fb923c; outline-offset: 2px; }',
    '.panel { position: fixed; top: 0; right: 0; bottom: 0; width: min(480px, 100vw); background: #fbf8f4; border-left: 1px solid #ddd3c8;',
    '  box-shadow: -8px 0 30px rgba(0,0,0,.2); display: flex; flex-direction: column; }',
    '.head { padding: 1rem 1.1rem .75rem; border-bottom: 1px solid #ddd3c8; background: #fff; }',
    '.head-top { display: flex; align-items: start; justify-content: space-between; gap: .5rem; }',
    'h2 { font: 700 1.3rem/1.25 Georgia, serif; margin: 0; }',
    '.sub { color: #5d544c; font-size: .9rem; margin: .3rem 0 0; }',
    '.close { min-width: 44px; min-height: 44px; border: 0; background: transparent; font-size: 1.6rem; line-height: 1; cursor: pointer; color: #1f1a16; border-radius: 8px; }',
    '.close:hover { background: #f1ebe4; }',
    '.body { flex: 1; overflow-y: auto; padding: .5rem 1.1rem 1rem; }',
    '.note { background: #ffedd5; border-radius: 10px; padding: .7rem .9rem; margin: .75rem 0; }',
    '.note.err { background: #fee2e2; }',
    '.note.ok { background: #dcfce7; }',
    '.cat { font: 700 .78rem/1 system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase; color: #5d544c; margin: 1rem 0 .4rem; }',
    'ul { list-style: none; margin: 0; padding: 0; }',
    '.item { background: #fff; border: 1px solid #ddd3c8; border-radius: 10px; padding: .65rem .75rem; margin-bottom: .5rem; }',
    '.item.off { opacity: .55; }',
    '.item-top { display: flex; gap: .55rem; align-items: start; }',
    '.item-top input[type=checkbox] { width: 22px; height: 22px; margin: .1rem 0 0; accent-color: #9a3412; flex: none; }',
    '.item-name { font-weight: 600; }',
    '.amt { color: #9a3412; }',
    '.for { display: block; color: #5d544c; font-size: .82rem; font-weight: 400; }',
    '.prod { display: flex; gap: .6rem; align-items: center; margin-top: .5rem; padding-left: 1.9rem; }',
    '.prod img { width: 52px; height: 52px; object-fit: contain; background: #fff; border-radius: 6px; flex: none; }',
    '.prod .ph { width: 52px; height: 52px; border-radius: 6px; background: #f1ebe4; flex: none; }',
    '.prod-info { flex: 1; min-width: 0; font-size: .9rem; }',
    '.prod-desc { display: block; overflow: hidden; text-overflow: ellipsis; }',
    '.price { font-weight: 700; }',
    '.was { text-decoration: line-through; color: #5d544c; font-weight: 400; margin-left: .3rem; }',
    '.tag { display: inline-block; font-size: .72rem; font-weight: 700; padding: .05rem .4rem; border-radius: 999px; background: #e0f2fe; color: #075985; margin-left: .3rem; }',
    '.tag.out { background: #fee2e2; color: #991b1b; }',
    '.controls { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; margin-top: .5rem; padding-left: 1.9rem; }',
    'select, .search-in { font: inherit; font-size: .9rem; color: #1f1a16; background: #fff; border: 1px solid #ddd3c8; border-radius: 8px; min-height: 40px; padding: .3rem .5rem; max-width: 100%; }',
    'select { flex: 1; min-width: 0; }',
    '.qty { display: inline-flex; align-items: center; border: 1px solid #ddd3c8; border-radius: 8px; overflow: hidden; background: #fff; }',
    '.qty button { min-width: 38px; min-height: 40px; border: 0; background: #fff; font: 700 1.1rem/1 system-ui; cursor: pointer; color: #1f1a16; }',
    '.qty button:hover { background: #f1ebe4; }',
    '.qty output { min-width: 2.2rem; text-align: center; font-weight: 700; }',
    '.searchrow { display: flex; gap: .4rem; margin-top: .5rem; padding-left: 1.9rem; }',
    '.searchrow .search-in { flex: 1; }',
    '.link { border: 0; background: none; color: #9a3412; font: inherit; font-size: .88rem; font-weight: 600; cursor: pointer; padding: .25rem; min-height: 32px; text-decoration: underline; }',
    '.muted { color: #5d544c; font-size: .9rem; }',
    '.foot { border-top: 1px solid #ddd3c8; padding: .8rem 1.1rem 1rem; background: #fff; }',
    '.btn { min-height: 46px; padding: .55rem 1.1rem; border-radius: 10px; border: 1px solid #ddd3c8; background: #fff; color: #1f1a16; font: 600 1rem/1.2 system-ui, sans-serif; cursor: pointer; }',
    '.btn:hover { border-color: #9a3412; }',
    '.btn.primary { background: #9a3412; border-color: #9a3412; color: #fff; width: 100%; }',
    '.btn.primary:hover { background: #7c2d12; }',
    '.btn:disabled { opacity: .5; cursor: default; }',
    '.foot .row { display: flex; gap: .5rem; flex-wrap: wrap; margin-top: .5rem; }',
    '.total { display: flex; justify-content: space-between; font-size: .92rem; color: #5d544c; margin-bottom: .5rem; }',
    '.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }',
    '@media (prefers-reduced-motion: no-preference) { .panel { animation: slide .18s ease-out; } @keyframes slide { from { transform: translateX(30px); opacity: 0; } } }'
  ].join('\n');
  try {
    var sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
  } catch (e) {
    var st = document.createElement('style'); st.textContent = CSS; root.appendChild(st);
  }
  var wrap = document.createElement('div');
  wrap.className = 'wrap';
  root.appendChild(wrap);
  (document.body || document.documentElement).appendChild(host);

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function q(sel) { return wrap.querySelector(sel); }

  // ------------------------------------------------------------ state

  var st = null;          // from background: settings, list, choices, configured, signedIn
  var rows = [];          // one per grocery item: { item, include, qty, products, sel, status, term }
  var open = false;
  var busy = false;
  var done = null;        // result after adding to the cart
  var message = null;     // { kind, text }

  function refresh() {
    return send({ type: 'state' }).then(function (r) {
      if (!r.ok) { st = null; drawFab(); return; }
      var listChanged = !st || !st.list || !r.list || st.list.exportedAt !== r.list.exportedAt;
      var storeChanged = st && st.settings.locationId !== r.settings.locationId;
      st = r;
      if (listChanged) { rows = []; done = null; message = null; }
      else if (storeChanged) rows.forEach(function (row) { row.status = 'idle'; row.products = null; }); // new store, new prices
      drawFab();
      if (open && listChanged && st.list) { openPanel(); return; }
      if (open) drawPanel();
      if (open && st.configured) searchAll();
    });
  }

  function itemCount() { return st && st.list ? st.list.items.length : 0; }

  // ------------------------------------------------------------ floating button

  function drawFab() {
    if (open) return;
    var n = itemCount();
    wrap.innerHTML = n ? '<button type="button" class="fab" id="fab"><span aria-hidden="true">🛒</span> Add recipe list (' + n + ')</button>' : '';
    var b = q('#fab');
    if (b) b.addEventListener('click', function () { openPanel(); });
  }

  // ------------------------------------------------------------ panel

  function openPanel() {
    if (!st || !st.list) {
      open = true;
      drawPanel();
      return;
    }
    open = true;
    if (!rows.length) {
      rows = st.list.items.map(function (item) {
        return { item: item, include: M.includeByDefault(item), qty: M.suggestedQuantity(item), products: null, sel: 0, status: 'idle', term: M.searchTerm(item) };
      });
    }
    drawPanel();
    var h = q('#dsb-h');
    if (h) h.focus();
    if (st.configured) searchAll();
    else if (h) h.focus();
  }

  function closePanel() {
    open = false;
    drawFab();
    var b = q('#fab');
    if (b) b.focus();
  }

  function storeLine() {
    var s = st.settings;
    return (s.modality === 'DELIVERY' ? 'Delivery' : 'Pickup') + (s.locationId ? ' · ' + esc(s.locationName.split(' (')[0]) : ' · no store chosen (prices hidden)');
  }

  function drawPanel() {
    if (!open) return;
    var scroll = q('.body') ? q('.body').scrollTop : 0;
    // Search results arrive one at a time and redraw the panel; keep keyboard focus (and any
    // half-typed search) where it was.
    var active = root.activeElement, keepId = active && active.id, caret = null;
    if (active && active.tagName === 'INPUT' && active.type !== 'checkbox') { try { caret = [active.selectionStart, active.selectionEnd]; } catch (e) { /* ignore */ } }
    var html = '<div class="panel" role="dialog" aria-modal="false" aria-labelledby="dsb-h">' +
      '<div class="head"><div class="head-top"><h2 id="dsb-h" tabindex="-1">Add your recipe list</h2>' +
      '<button type="button" class="close" id="close" aria-label="Close">×</button></div>';
    if (st && st.list) {
      html += '<p class="sub">' + esc(st.list.recipes.length ? st.list.recipes.join(' · ') : 'Grocery list') + '</p>' +
        '<p class="sub">' + storeLine() + ' · <button type="button" class="link" id="settings">Settings</button></p>';
    }
    html += '</div><div class="body">';

    if (!st || !st.list) {
      html += '<p class="note">No list yet. On your recipe book’s <strong>Grocery list</strong> page, click <strong>Send to Kroger</strong>.</p>';
    } else if (!st.configured) {
      html += '<div class="note"><p style="margin:0 0 .5rem">One-time setup: connect the extension to a free Kroger developer app.</p>' +
        '<button type="button" class="btn" id="setup">Open setup</button></div>';
    }
    if (message) html += '<p class="note ' + (message.kind || '') + '" role="' + (message.kind === 'err' ? 'alert' : 'status') + '">' + esc(message.text) + '</p>';
    if (done) {
      html += '<div class="note ok" role="status"><strong>Added ' + done.added + ' item' + (done.added === 1 ? '' : 's') + ' to your Kroger cart.</strong>' +
        '<div class="row" style="display:flex;gap:.5rem;flex-wrap:wrap;margin-top:.6rem"><a class="btn" href="https://www.kroger.com/cart" id="view-cart">View cart</a>' +
        '<button type="button" class="btn" id="clear-list">Done, clear this list</button></div></div>';
    }

    if (st && st.list && !done) {
      var lastCat = null;
      html += '<ul>';
      rows.forEach(function (r, i) {
        if (r.item.category !== lastCat) {
          if (lastCat !== null) html += '</ul><ul>';
          html += '<li class="cat" aria-hidden="true">' + esc(r.item.category || 'Other') + '</li>';
          lastCat = r.item.category;
        }
        html += rowHtml(r, i);
      });
      html += '</ul>';
    }
    html += '</div>';

    if (st && st.list && !done && st.configured) {
      var chosen = rows.filter(function (r) { return r.include && r.products && r.products[r.sel]; });
      var total = chosen.reduce(function (sum, r) { var p = r.products[r.sel]; var price = p.promo != null ? p.promo : p.price; return price == null ? sum : sum + price * r.qty; }, 0);
      var pending = rows.filter(function (r) { return r.include && r.status === 'searching'; }).length;
      html += '<div class="foot"><div class="total"><span>' + chosen.length + ' of ' + rows.length + ' items selected' +
        (pending ? ' · finding ' + pending + '…' : '') + '</span><span>' + (total ? 'About ' + M.money(total) : '') + '</span></div>' +
        '<button type="button" class="btn primary" id="add"' + (busy || !chosen.length ? ' disabled' : '') + '>' +
        (busy ? 'Adding to your cart…' : 'Add ' + chosen.length + ' item' + (chosen.length === 1 ? '' : 's') + ' to cart') + '</button>' +
        (st.signedIn ? '' : '<p class="muted" style="margin:.5rem 0 0">Kroger will ask you to sign in the first time.</p>') +
        '</div>';
    }
    html += '</div>';
    wrap.innerHTML = html;
    if (q('.body')) q('.body').scrollTop = scroll;
    bindPanel();
    if (keepId) {
      var again = root.getElementById(keepId);
      if (again) {
        again.focus({ preventScroll: true });
        if (caret && again.setSelectionRange) { try { again.setSelectionRange(caret[0], caret[1]); } catch (e) { /* ignore */ } }
      }
    }
  }

  function productHtml(p) {
    if (!p) return '';
    var price = p.promo != null
      ? '<span class="price">' + M.money(p.promo) + '</span><span class="was">' + M.money(p.price) + '</span>'
      : (p.price != null ? '<span class="price">' + M.money(p.price) + '</span>' : '');
    return '<div class="prod">' + (p.image ? '<img src="' + esc(p.image) + '" alt="">' : '<span class="ph" aria-hidden="true"></span>') +
      '<span class="prod-info"><span class="prod-desc">' + esc(p.description) + '</span>' +
      '<span class="muted">' + esc(p.size) + (p.size && price ? ' · ' : '') + '</span>' + price +
      (p.remembered ? '<span class="tag">Your pick</span>' : '') + (p.inStock === false ? '<span class="tag out">Out of stock</span>' : '') +
      '</span></div>';
  }

  function rowHtml(r, i) {
    var it = r.item, id = 'i' + i;
    var h = '<li class="item' + (r.include ? '' : ' off') + '"><div class="item-top">' +
      '<input type="checkbox" id="' + id + '" data-inc="' + i + '"' + (r.include ? ' checked' : '') + '>' +
      '<label for="' + id + '"><span class="item-name">' + (it.amount ? '<span class="amt">' + esc(it.amount) + '</span> ' : '') + esc(it.name) + '</span>' +
      (it.recipes.length ? '<span class="for">' + esc(it.recipes.join(' · ')) + '</span>' : '') + '</label></div>';
    if (!r.include) return h + '</li>';
    if (r.status === 'searching' || r.status === 'idle') h += '<p class="muted" style="padding-left:1.9rem;margin:.4rem 0 0">Finding it at Kroger…</p>';
    if (r.status === 'error') h += '<p class="muted" style="padding-left:1.9rem;margin:.4rem 0 0">' + esc(r.error) + '</p>';
    if (r.products && r.products.length) {
      var p = r.products[r.sel];
      h += productHtml(p) +
        '<div class="controls"><label class="sr" for="sel' + i + '">Product for ' + esc(it.name) + '</label>' +
        '<select id="sel' + i + '" data-sel="' + i + '">' + r.products.map(function (x, j) {
          return '<option value="' + j + '"' + (j === r.sel ? ' selected' : '') + '>' + esc(x.description + (x.size ? ' — ' + x.size : '') + (x.price != null ? ' — ' + M.money(x.promo != null ? x.promo : x.price) : '')) + '</option>';
        }).join('') + '</select>' +
        '<span class="qty" role="group" aria-label="Quantity of ' + esc(it.name) + '"><button type="button" id="dec' + i + '" data-dec="' + i + '" aria-label="Fewer">−</button>' +
        '<output aria-live="polite">' + r.qty + '</output><button type="button" id="inc' + i + '" data-incq="' + i + '" aria-label="More">+</button></span>' +
        '<button type="button" class="link" id="re' + i + '" data-research="' + i + '">Search again</button></div>';
    }
    if (r.status === 'none' || r.status === 'error' || r.editing) {
      h += (r.status === 'none' ? '<p class="muted" style="padding-left:1.9rem;margin:.4rem 0 0">No match for “' + esc(r.term) + '”. Try other words:</p>' : '') +
        '<form class="searchrow" data-form="' + i + '"><label class="sr" for="term' + i + '">Search Kroger for ' + esc(it.name) + '</label>' +
        '<input class="search-in" id="term' + i + '" value="' + esc(r.term) + '"><button type="submit" class="btn">Search</button></form>';
    }
    return h + '</li>';
  }

  function bindPanel() {
    var c = q('#close'); if (c) c.addEventListener('click', closePanel);
    var s = q('#settings'); if (s) s.addEventListener('click', function () { send({ type: 'openOptions' }); });
    var su = q('#setup'); if (su) su.addEventListener('click', function () { send({ type: 'openOptions' }); });
    var add = q('#add'); if (add) add.addEventListener('click', addToCart);
    var cl = q('#clear-list'); if (cl) cl.addEventListener('click', function () {
      send({ type: 'clearList' }).then(function () { rows = []; done = null; st.list = null; closePanel(); });
    });
    var body = q('.body');
    if (!body) return;
    body.addEventListener('change', function (e) {
      var t = e.target;
      if (t.hasAttribute('data-inc')) {
        var r = rows[+t.getAttribute('data-inc')];
        r.include = t.checked;
        if (r.include && r.status === 'idle') searchRow(r);
        drawPanel();
        var again = q('#i' + t.getAttribute('data-inc')); if (again) again.focus();
      } else if (t.hasAttribute('data-sel')) {
        rows[+t.getAttribute('data-sel')].sel = +t.value;
        drawPanel();
        var sel = q('#sel' + t.getAttribute('data-sel')); if (sel) sel.focus();
      }
    });
    body.addEventListener('click', function (e) {
      var b = e.target.closest('button');
      if (!b) return;
      var i;
      if (b.hasAttribute('data-dec')) { i = +b.getAttribute('data-dec'); rows[i].qty = Math.max(1, rows[i].qty - 1); redrawKeep('[data-dec="' + i + '"]'); }
      else if (b.hasAttribute('data-incq')) { i = +b.getAttribute('data-incq'); rows[i].qty = Math.min(99, rows[i].qty + 1); redrawKeep('[data-incq="' + i + '"]'); }
      else if (b.hasAttribute('data-research')) { i = +b.getAttribute('data-research'); rows[i].editing = true; drawPanel(); var inp = q('#term' + i); if (inp) { inp.focus(); inp.select(); } }
    });
    body.addEventListener('input', function (e) {
      var f = e.target.closest('[data-form]');
      if (f) rows[+f.getAttribute('data-form')].term = e.target.value;
    });
    body.addEventListener('submit', function (e) {
      var f = e.target.closest('[data-form]');
      if (!f) return;
      e.preventDefault();
      var r = rows[+f.getAttribute('data-form')];
      var term = f.querySelector('input').value.trim();
      if (term.length < 2) return;
      r.term = term;
      r.editing = false;
      searchRow(r, true);
    });
  }
  function redrawKeep(sel) { drawPanel(); var el = q(sel); if (el) el.focus(); }

  // ------------------------------------------------------------ searching

  function searchRow(r, fresh) {
    r.status = 'searching';
    r.products = fresh ? null : r.products;
    drawPanel();
    return send({ type: 'search', term: r.term }).then(function (res) {
      if (!res.ok) {
        r.status = 'error';
        r.error = res.error;
        if (res.code === 'setup') { st.configured = false; }
      } else {
        var remembered = !fresh && st.choices ? st.choices[r.item.key] : null;
        r.products = M.rankProducts(res.products, remembered);
        r.sel = 0;
        r.status = r.products.length ? 'found' : 'none';
      }
      drawPanel();
    });
  }

  function searchAll() {
    var queue = rows.filter(function (r) { return r.include && r.status === 'idle'; });
    var running = 0;
    return new Promise(function (resolve) {
      function next() {
        if (!queue.length && !running) { resolve(); return; }
        while (running < 3 && queue.length) {
          var r = queue.shift();
          running++;
          searchRow(r).then(function () { running--; next(); });
        }
      }
      next();
    });
  }

  // ------------------------------------------------------------ adding to the cart

  function addToCart() {
    var chosen = rows.filter(function (r) { return r.include && r.products && r.products[r.sel]; });
    if (!chosen.length || busy) return;
    busy = true;
    message = null;
    drawPanel();
    send({
      type: 'addToCart',
      items: chosen.map(function (r) {
        var p = r.products[r.sel];
        return { key: r.item.key, upc: p.upc, quantity: r.qty,
          product: { upc: p.upc, productId: p.productId, description: p.description, brand: p.brand, size: p.size, image: p.image, price: p.price, promo: p.promo } };
      })
    }).then(function (res) {
      busy = false;
      if (res.ok) {
        done = { added: res.added };
        send({ type: 'state' }).then(function (r) { if (r.ok) { st.choices = r.choices; st.signedIn = r.signedIn; } });
      } else {
        message = { kind: 'err', text: res.error };
      }
      drawPanel();
      var focusEl = q(done ? '#view-cart' : '#add');
      if (focusEl) focusEl.focus();
    });
  }

  // ------------------------------------------------------------ wiring

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && open && host.matches(':focus-within')) closePanel();
  });
  try {
    chrome.runtime.onMessage.addListener(function (msg) {
      if (msg && msg.type === 'togglePanel') { if (open) closePanel(); else openPanel(); }
    });
    chrome.storage.onChanged.addListener(function (changes) {
      if (changes.groceryList || changes.settings || changes.userTok) refresh();
    });
  } catch (e) { /* extension reloaded */ }

  refresh();
})();
