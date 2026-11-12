/*
 * site-bridge.js — runs on recipes.davidsbennett.com.
 *
 * Tells the recipe site the extension is installed (so it shows "Send to Kroger"), and
 * passes the grocery list it sends over to the extension's storage.
 */
(function () {
  'use strict';

  function announce() {
    document.documentElement.setAttribute('data-dsbrb-kroger', '1');
    window.postMessage({ source: 'dsbrb-kroger', type: 'ready' }, location.origin);
  }
  announce();
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', announce);

  function reply(msg) { window.postMessage(Object.assign({ source: 'dsbrb-kroger' }, msg), location.origin); }

  window.addEventListener('message', function (e) {
    if (e.source !== window || e.origin !== location.origin) return;
    var d = e.data;
    if (!d || d.source !== 'dsbrb-site' || d.type !== 'grocery-export') return;
    var list = d.list || {};
    var items = Array.isArray(list.items) ? list.items.filter(function (it) { return it && typeof it.name === 'string' && it.name.trim(); }) : [];
    if (!items.length) { reply({ type: 'error', message: 'the list was empty.' }); return; }
    var clean = {
      items: items.slice(0, 200).map(function (it) {
        return {
          key: String(it.key || it.name).slice(0, 120),
          name: String(it.name).slice(0, 120),
          amount: String(it.amount || '').slice(0, 60),
          category: String(it.category || '').slice(0, 40),
          recipes: (Array.isArray(it.recipes) ? it.recipes : []).map(String).slice(0, 20),
          count: +it.count || 0,
          units: it.units && typeof it.units === 'object' ? it.units : {}
        };
      }),
      recipes: (Array.isArray(list.recipes) ? list.recipes : []).map(String).slice(0, 50),
      exportedAt: String(list.exportedAt || new Date().toISOString()),
      from: location.origin
    };
    try {
      chrome.storage.local.set({ groceryList: clean }, function () {
        if (chrome.runtime.lastError) reply({ type: 'error', message: chrome.runtime.lastError.message });
        else reply({ type: 'saved', count: clean.items.length });
      });
    } catch (err) {
      // The extension was reloaded or updated while this tab stayed open.
      reply({ type: 'error', message: 'reload this page and try again.' });
    }
  });
})();
