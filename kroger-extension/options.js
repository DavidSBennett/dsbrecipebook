/* options.js — the extension's settings page. All Kroger calls go through background.js. */
(function () {
  'use strict';

  function $(s) { return document.querySelector(s); }
  function send(msg) {
    return new Promise(function (resolve) {
      chrome.runtime.sendMessage(msg, function (r) {
        resolve(r || { ok: false, error: chrome.runtime.lastError ? chrome.runtime.lastError.message : 'No answer from the extension.' });
      });
    });
  }
  function status(el, text, kind) { el.textContent = text; el.className = 'status' + (kind ? ' ' + kind : ''); }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }

  var current = null;

  function render(st) {
    current = st;
    var s = st.settings;
    $('#redirect').textContent = st.redirectUri;
    if (document.activeElement !== $('#client-id')) $('#client-id').value = s.clientId;
    if (document.activeElement !== $('#client-secret')) $('#client-secret').value = s.clientSecret;
    $('#api-base').value = s.apiBase;
    $('#signin').disabled = !st.configured;
    $('#signin').textContent = st.signedIn ? 'Sign in again' : 'Sign in to Kroger';
    $('#signout').hidden = !st.signedIn;
    if (!st.configured) status($('#signin-status'), 'Finish step 1 first.');
    else status($('#signin-status'), st.signedIn ? 'Signed in.' : 'Not signed in yet.', st.signedIn ? 'ok' : '');
    $('#store-current').textContent = s.locationId ? 'Current store: ' + s.locationName + '.' : 'No store chosen yet.';
    document.querySelectorAll('input[name=modality]').forEach(function (r) { r.checked = r.value === s.modality; });
    var n = Object.keys(st.choices || {}).length;
    $('#forget').disabled = !n;
    $('#list-status').textContent = st.list
      ? st.list.items.length + ' items waiting from ' + (st.list.recipes.length ? st.list.recipes.join(', ') : 'your grocery list') +
        ' (sent ' + new Date(st.list.exportedAt).toLocaleString() + '). Open kroger.com and click “Add recipe list”.'
      : 'No list yet. On your recipe book’s Grocery list page, click “Send to Kroger”.';
    if (n) $('#list-status').textContent += ' The extension remembers your product picks for ' + n + ' items.';
  }

  send({ type: 'state' }).then(function (r) { if (r.ok) render(r); });

  $('#copy-redirect').addEventListener('click', function () {
    navigator.clipboard.writeText($('#redirect').textContent).then(function () { $('#copy-redirect').textContent = 'Copied'; setTimeout(function () { $('#copy-redirect').textContent = 'Copy'; }, 1500); });
  });

  $('#app-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var st = $('#app-status');
    status(st, 'Checking with Kroger…');
    send({ type: 'saveSettings', test: true, patch: { clientId: $('#client-id').value, clientSecret: $('#client-secret').value, apiBase: $('#api-base').value } })
      .then(function (r) {
        if (r.ok) { render(r); status(st, 'Saved. Kroger accepted your app.', 'ok'); }
        else { status(st, r.error, 'err'); send({ type: 'state' }).then(function (x) { if (x.ok) render(x); }); }
      });
  });

  $('#signin').addEventListener('click', function () {
    status($('#signin-status'), 'Finish signing in in the Kroger window…');
    send({ type: 'signIn' }).then(function (r) {
      if (r.ok) { render(r); status($('#signin-status'), 'Signed in.', 'ok'); }
      else status($('#signin-status'), r.error, 'err');
    });
  });
  $('#signout').addEventListener('click', function () { send({ type: 'signOut' }).then(function (r) { if (r.ok) render(r); }); });

  $('#store-form').addEventListener('submit', function (e) {
    e.preventDefault();
    var st = $('#store-status');
    status(st, 'Looking…');
    $('#stores').innerHTML = '';
    send({ type: 'locations', zip: $('#zip').value }).then(function (r) {
      if (!r.ok) { status(st, r.error, 'err'); return; }
      status(st, r.locations.length ? 'Pick your store:' : 'No Kroger stores found near that ZIP.');
      $('#stores').innerHTML = r.locations.map(function (l, i) {
        return '<li><span>' + esc(l.name) + '<small>' + esc(l.address) + '</small></span><button type="button" data-i="' + i + '">Use this store</button></li>';
      }).join('');
      $('#stores').onclick = function (ev) {
        var b = ev.target.closest('button[data-i]');
        if (!b) return;
        var l = r.locations[+b.getAttribute('data-i')];
        send({ type: 'saveSettings', patch: { locationId: l.locationId, locationName: l.name + ' (' + l.address + ')' } }).then(function (x) {
          if (x.ok) { render(x); $('#stores').innerHTML = ''; status(st, 'Store saved.', 'ok'); }
        });
      };
    });
  });

  document.querySelectorAll('input[name=modality]').forEach(function (r) {
    r.addEventListener('change', function () { send({ type: 'saveSettings', patch: { modality: r.value } }).then(function (x) { if (x.ok) render(x); }); });
  });

  $('#forget').addEventListener('click', function () {
    send({ type: 'forgetChoices' }).then(function (r) { if (r.ok) { render(r); status($('#forget-status'), 'Forgotten.', 'ok'); } });
  });

  chrome.storage.onChanged.addListener(function () { send({ type: 'state' }).then(function (r) { if (r.ok) render(r); }); });
})();
