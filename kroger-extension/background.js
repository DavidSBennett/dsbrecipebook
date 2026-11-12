/*
 * background.js — talks to Kroger's official API (developer.kroger.com).
 *
 *   Products API   search for a grocery item at your store     (app token, scope product.compact)
 *   Locations API  find your store by ZIP code                 (app token)
 *   Cart API       add the chosen products to your cart        (your sign-in, scope cart.basic:write)
 *
 * Your Kroger app's client ID and secret, and your sign-in tokens, are kept in this
 * extension's local storage only.
 */
importScripts('matching.js');

var DEFAULTS = {
  apiBase: 'https://api.kroger.com/v1',
  clientId: '',
  clientSecret: '',
  locationId: '',
  locationName: '',
  modality: 'PICKUP'
};

function fail(message, code) { var e = new Error(message); e.code = code || 'error'; return e; }

async function getSettings() {
  var got = await chrome.storage.local.get('settings');
  return Object.assign({}, DEFAULTS, got.settings || {});
}
async function saveSettings(patch) {
  var s = Object.assign(await getSettings(), patch || {});
  var keys = Object.keys(DEFAULTS);
  var clean = {};
  keys.forEach(function (k) { clean[k] = typeof s[k] === 'string' ? s[k].trim() : s[k]; });
  if (clean.modality !== 'DELIVERY') clean.modality = 'PICKUP';
  if (!/^https:\/\/api(-ce)?\.kroger\.com\/v1$/.test(clean.apiBase)) clean.apiBase = DEFAULTS.apiBase;
  await chrome.storage.local.set({ settings: clean });
  return clean;
}
function requireApp(s) {
  if (!s.clientId || !s.clientSecret) throw fail('Add your Kroger app’s client ID and secret in the extension settings first.', 'setup');
}

// ------------------------------------------------------------ tokens

async function tokenRequest(s, params) {
  var res;
  try {
    res = await fetch(s.apiBase + '/connect/oauth2/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': 'Basic ' + btoa(s.clientId + ':' + s.clientSecret)
      },
      body: new URLSearchParams(params).toString()
    });
  } catch (e) { throw fail('Couldn’t reach Kroger. Check your internet connection.', 'offline'); }
  var data = await res.json().catch(function () { return {}; });
  if (!res.ok) {
    if (params.grant_type === 'refresh_token') throw fail('Your Kroger sign-in expired.', 'signin');
    if (res.status === 401 || /client/i.test(data.error || '')) throw fail('Kroger didn’t accept the client ID and secret. Check them in the extension settings.', 'setup');
    throw fail('Kroger sign-in failed: ' + (data.error_description || data.error || res.status) + '.', 'signin');
  }
  return data;
}

var appTokenPending = null; // several searches run at once; they share one token request

async function appToken(s) {
  var got = await chrome.storage.local.get('appTok');
  var t = got.appTok;
  if (t && t.clientId === s.clientId && t.apiBase === s.apiBase && t.exp > Date.now() + 60000) return t.token;
  if (!appTokenPending) {
    appTokenPending = tokenRequest(s, { grant_type: 'client_credentials', scope: 'product.compact' }).then(function (d) {
      return chrome.storage.local.set({ appTok: { token: d.access_token, exp: Date.now() + (d.expires_in || 1800) * 1000, clientId: s.clientId, apiBase: s.apiBase } })
        .then(function () { return d.access_token; });
    }).finally(function () { appTokenPending = null; });
  }
  return appTokenPending;
}

async function storeUserToken(s, d, oldRefresh) {
  await chrome.storage.local.set({ userTok: {
    token: d.access_token,
    refresh: d.refresh_token || oldRefresh || '',
    exp: Date.now() + (d.expires_in || 1800) * 1000,
    clientId: s.clientId, apiBase: s.apiBase,
    since: new Date().toISOString()
  } });
}

async function userToken(s, interactive) {
  var got = await chrome.storage.local.get('userTok');
  var t = got.userTok;
  if (t && t.clientId === s.clientId && t.apiBase === s.apiBase) {
    if (t.exp > Date.now() + 60000) return t.token;
    if (t.refresh) {
      try {
        var d = await tokenRequest(s, { grant_type: 'refresh_token', refresh_token: t.refresh });
        await storeUserToken(s, d, t.refresh);
        return d.access_token;
      } catch (e) { /* fall through to a fresh sign-in */ }
    }
  }
  if (!interactive) throw fail('Sign in to Kroger first.', 'signin');
  return signIn(s);
}

/** Kroger's sign-in page in a pop-up window; it returns to this extension's redirect address. */
async function signIn(s) {
  requireApp(s);
  var redirect = chrome.identity.getRedirectURL();
  var state = crypto.randomUUID();
  var url = s.apiBase + '/connect/oauth2/authorize?' + new URLSearchParams({
    scope: 'cart.basic:write',
    response_type: 'code',
    client_id: s.clientId,
    redirect_uri: redirect,
    state: state
  }).toString();
  var back;
  try {
    back = await chrome.identity.launchWebAuthFlow({ url: url, interactive: true });
  } catch (e) {
    throw fail('Kroger sign-in didn’t finish. If Kroger showed an error about the redirect, add ' + redirect + ' as a Redirect URI in your Kroger app.', 'signin');
  }
  var u = new URL(back);
  if (u.searchParams.get('error')) throw fail('Kroger sign-in: ' + (u.searchParams.get('error_description') || u.searchParams.get('error')) + '.', 'signin');
  if (u.searchParams.get('state') !== state) throw fail('Kroger sign-in was interrupted. Please try again.', 'signin');
  var code = u.searchParams.get('code');
  if (!code) throw fail('Kroger sign-in was cancelled.', 'signin');
  var d = await tokenRequest(s, { grant_type: 'authorization_code', code: code, redirect_uri: redirect });
  await storeUserToken(s, d);
  return d.access_token;
}

// ------------------------------------------------------------ API calls

async function api(s, path, token, method, body) {
  var res;
  try {
    res = await fetch(s.apiBase + path, {
      method: method || 'GET',
      headers: Object.assign({ 'Accept': 'application/json', 'Authorization': 'Bearer ' + token },
        body ? { 'Content-Type': 'application/json' } : {}),
      body: body ? JSON.stringify(body) : undefined
    });
  } catch (e) { throw fail('Couldn’t reach Kroger. Check your internet connection.', 'offline'); }
  if (res.status === 204) return null;
  var data = await res.json().catch(function () { return null; });
  if (res.ok) return data;
  var msg = data && (data.errors && data.errors.reason || data.error_description || data.message || data.error);
  if (res.status === 401) throw fail('Kroger needs you to sign in again.', 'auth');
  if (res.status === 403) throw fail('Kroger didn’t allow that request' + (msg ? ' (' + msg + ')' : '') + '. Check that your Kroger app includes the Products, Locations and Cart APIs.', 'forbidden');
  if (res.status === 429) throw fail('Kroger says too many requests. Wait a minute and try again.', 'rate');
  throw fail('Kroger returned an error (' + res.status + (msg ? ': ' + msg : '') + ').', 'http');
}

async function searchProducts(term) {
  var s = await getSettings();
  requireApp(s);
  var q = { 'filter.term': String(term || '').slice(0, 100), 'filter.limit': '6' };
  if (s.locationId) q['filter.locationId'] = s.locationId;
  var tok = await appToken(s);
  var data;
  try { data = await api(s, '/products?' + new URLSearchParams(q).toString(), tok); }
  catch (e) {
    if (e.code !== 'auth') throw e;
    await chrome.storage.local.remove('appTok');
    data = await api(s, '/products?' + new URLSearchParams(q).toString(), await appToken(s));
  }
  return ((data && data.data) || []).map(DSBMatching.productSummary).filter(function (p) { return p.upc; });
}

async function findLocations(zip) {
  var s = await getSettings();
  requireApp(s);
  if (!/^\d{5}$/.test(String(zip || '').trim())) throw fail('Enter a 5-digit ZIP code.', 'input');
  var tok = await appToken(s);
  var data = await api(s, '/locations?' + new URLSearchParams({ 'filter.zipCode.near': zip.trim(), 'filter.limit': '10' }).toString(), tok);
  return ((data && data.data) || []).map(function (l) {
    var a = l.address || {};
    return { locationId: l.locationId, name: l.name || l.chain || 'Store', chain: l.chain || '',
      address: [a.addressLine1, a.city, a.state].filter(Boolean).join(', ') };
  });
}

async function addToCart(items) {
  var s = await getSettings();
  requireApp(s);
  var lines = (items || []).filter(function (i) { return i && i.upc && i.quantity > 0; }).map(function (i) {
    return { upc: String(i.upc), quantity: Math.min(99, Math.round(i.quantity)), modality: s.modality };
  });
  if (!lines.length) throw fail('Nothing selected to add.', 'input');
  var tok = await userToken(s, true);
  try {
    await api(s, '/cart/add', tok, 'PUT', { items: lines });
  } catch (e) {
    if (e.code !== 'auth') throw e;
    await chrome.storage.local.remove('userTok');
    await api(s, '/cart/add', await userToken(s, true), 'PUT', { items: lines });
  }
  return { added: lines.length };
}

// ------------------------------------------------------------ messages from the panel and settings page

async function state() {
  var s = await getSettings();
  var got = await chrome.storage.local.get(['groceryList', 'userTok', 'choices']);
  var t = got.userTok;
  return {
    settings: Object.assign({}, s, { clientSecret: s.clientSecret ? '••••••••' : '' }),
    configured: !!(s.clientId && s.clientSecret),
    signedIn: !!(t && t.clientId === s.clientId && t.refresh),
    list: got.groceryList || null,
    choices: got.choices || {},
    redirectUri: chrome.identity.getRedirectURL()
  };
}

var handlers = {
  state: function () { return state(); },
  saveSettings: async function (m) {
    var patch = Object.assign({}, m.patch);
    if (patch.clientSecret === '••••••••') delete patch.clientSecret; // unchanged
    var before = await getSettings();
    var s = await saveSettings(patch);
    if (s.clientId !== before.clientId || s.clientSecret !== before.clientSecret || s.apiBase !== before.apiBase) {
      await chrome.storage.local.remove(['appTok', 'userTok']);
    }
    if (m.test) { requireApp(s); await appToken(s); }
    return state();
  },
  signIn: async function () { await signIn(await getSettings()); return state(); },
  signOut: async function () { await chrome.storage.local.remove('userTok'); return state(); },
  locations: async function (m) { return { locations: await findLocations(m.zip) }; },
  search: async function (m) { return { products: await searchProducts(m.term) }; },
  addToCart: async function (m) {
    var r = await addToCart(m.items);
    // Remember which product was picked for each grocery item, for next time.
    var got = await chrome.storage.local.get('choices');
    var choices = got.choices || {};
    (m.items || []).forEach(function (i) { if (i.key && i.product) choices[i.key] = i.product; });
    await chrome.storage.local.set({ choices: choices });
    return r;
  },
  forgetChoices: async function () { await chrome.storage.local.remove('choices'); return state(); },
  clearList: async function () { await chrome.storage.local.remove('groceryList'); return state(); },
  openOptions: async function () { await chrome.runtime.openOptionsPage(); return {}; }
};

chrome.runtime.onMessage.addListener(function (msg, sender, sendResponse) {
  var h = msg && handlers[msg.type];
  if (!h) return false;
  Promise.resolve().then(function () { return h(msg); }).then(
    function (r) { sendResponse(Object.assign({ ok: true }, r)); },
    function (e) { sendResponse({ ok: false, error: e.message || String(e), code: e.code || 'error' }); }
  );
  return true; // answer asynchronously
});

// Toolbar button: open the panel on kroger.com, otherwise the settings page.
chrome.action.onClicked.addListener(function (tab) {
  chrome.tabs.sendMessage(tab.id, { type: 'togglePanel' }, function () {
    if (chrome.runtime.lastError) chrome.runtime.openOptionsPage();
  });
});
