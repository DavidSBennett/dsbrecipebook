/*
 * github.js — publish recipes to the website automatically.
 *
 * Once a browser is connected (Backup & sync → paste a GitHub token), every save or delete
 * rewrites data/recipes.js in the GitHub repository through the GitHub API. GitHub Pages then
 * rebuilds the site, so every device sees the change a minute or two later.
 *
 * The token is a fine-grained personal access token limited to this one repository with
 * "Contents: Read and write". It is stored only in this browser's localStorage.
 *
 * Publishing always starts from the latest file on GitHub and applies this browser's changes
 * on top, so recipes published from another device are never overwritten.
 */
(function (root) {
  'use strict';

  var K_CONFIG = 'dsbrb.github.v1';
  var K_LAST = 'dsbrb.lastpublish.v1';
  var API = 'https://api.github.com';
  var Store = root.Store;

  function read(key, fallback) {
    try { var v = root.localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; }
  }
  function write(key, value) {
    try { root.localStorage.setItem(key, JSON.stringify(value)); return true; } catch (e) { return false; }
  }

  // ------------------------------------------------------------ settings

  /** Guess the repository from the website address (owner.github.io/repo/). */
  function defaults() {
    var owner = 'DavidSBennett', repo = 'dsbrecipebook';
    var m = root.location.hostname.match(/^([^.]+)\.github\.io$/i);
    if (m) {
      owner = m[1];
      var first = root.location.pathname.split('/').filter(Boolean)[0];
      repo = first && !/\.html?$/i.test(first) ? first : m[1] + '.github.io';
    }
    return { owner: owner, repo: repo, branch: 'main', path: 'data/recipes.js', token: '' };
  }

  function config() { return Object.assign(defaults(), read(K_CONFIG, {})); }
  function isConnected() { return !!config().token; }
  function lastPublish() { return read(K_LAST, null); }

  function disconnect() {
    var c = config();
    write(K_CONFIG, { owner: c.owner, repo: c.repo, branch: c.branch, path: c.path });
    try { root.localStorage.removeItem(K_LAST); } catch (e) { /* ignore */ }
  }

  // ------------------------------------------------------------ GitHub API

  function fail(message, code) { var e = new Error(message); e.code = code; return e; }

  function repoName(cfg) { return cfg.owner + '/' + cfg.repo; }
  function repoUrl(cfg) { return '/repos/' + encodeURIComponent(cfg.owner) + '/' + encodeURIComponent(cfg.repo); }
  function contentsUrl(cfg) {
    return repoUrl(cfg) + '/contents/' + cfg.path.split('/').map(encodeURIComponent).join('/');
  }

  function httpError(cfg, status, data) {
    var msg = (data && data.message) || '';
    if (status === 401) return fail('GitHub didn’t accept the token. It may be mistyped, expired, or deleted.', 'auth');
    if (status === 403 && /rate limit/i.test(msg)) return fail('GitHub says there have been too many requests. Try again in a few minutes.', 'rate');
    if (status === 403) return fail('The token isn’t allowed to change ' + repoName(cfg) + '. Make sure it has Contents set to “Read and write” for that repository.', 'forbidden');
    if (status === 404) return fail('Couldn’t find ' + repoName(cfg) + ' (or the token can’t see it). Check that the token includes this repository.', 'notfound');
    if (status === 409 || (status === 422 && /sha/i.test(msg))) return fail('The recipes file changed on GitHub while publishing.', 'conflict');
    return fail('GitHub returned an error (' + status + (msg ? ': ' + msg : '') + ').', 'http');
  }

  function api(cfg, method, url, body) {
    var headers = { 'Accept': 'application/vnd.github+json', 'Authorization': 'Bearer ' + cfg.token };
    if (body) headers['Content-Type'] = 'application/json';
    return root.fetch(API + url, { method: method, headers: headers, cache: 'no-store', body: body ? JSON.stringify(body) : undefined })
      .then(function (res) {
        return res.text().then(function (text) {
          var data = null;
          try { data = text ? JSON.parse(text) : null; } catch (e) { /* not JSON */ }
          if (res.ok) return data;
          throw httpError(cfg, res.status, data);
        });
      }, function () {
        throw fail('Couldn’t reach GitHub. Check your internet connection. Your changes are saved in this browser and will be published next time.', 'offline');
      });
  }

  function b64encode(str) {
    var bytes = new TextEncoder().encode(str), bin = '';
    for (var i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return root.btoa(bin);
  }
  function b64decode(b64) {
    var bin = root.atob(String(b64).replace(/\s/g, ''));
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /** The current data/recipes.js on GitHub: { sha, text }. */
  function fetchFile(cfg) {
    return api(cfg, 'GET', contentsUrl(cfg) + '?ref=' + encodeURIComponent(cfg.branch)).then(function (d) {
      if (!d || d.type !== 'file') throw fail(cfg.path + ' isn’t a file in ' + repoName(cfg) + '.', 'notfound');
      if (d.content && d.encoding === 'base64') return { sha: d.sha, text: b64decode(d.content) };
      // Files over 1 MB come back without content; read them as a blob instead.
      return api(cfg, 'GET', repoUrl(cfg) + '/git/blobs/' + d.sha).then(function (b) { return { sha: d.sha, text: b64decode(b.content) }; });
    });
  }

  /** Read the recipe list (and version stamp) out of a recipes.js file. */
  function parseFile(text) {
    var version = (text.match(/SEED_VERSION\s*=\s*"([^"]*)"/) || [])[1] || '';
    var m = text.match(/SEED_RECIPES\s*=\s*(\[[\s\S]*\])\s*;?\s*$/);
    var list = null;
    if (m) { try { list = JSON.parse(m[1]); } catch (e) { list = null; } }
    if (!list) {
      // Hand-edited file that isn't strict JSON: run it against a stand-in window.
      try { var w = {}; new Function('window', text)(w); list = w.SEED_RECIPES; version = w.SEED_VERSION || version; } catch (e) { list = null; }
    }
    if (!Array.isArray(list)) throw fail('The recipes file on GitHub couldn’t be read. It may have a typo from being edited by hand.', 'parse');
    return { version: String(version), recipes: list };
  }

  /** A version stamp newer than both now and the file being replaced. */
  function nextVersion(prev) {
    var now = new Date();
    var p = Date.parse(prev);
    if (isFinite(p) && p >= now.getTime()) now = new Date(p + 1000);
    return now.toISOString();
  }

  function commitMessage(added, updated, removed) {
    var total = added.length + updated.length + removed.length;
    if (total === 1) {
      if (added.length) return 'Add recipe: ' + added[0];
      if (updated.length) return 'Update recipe: ' + updated[0];
      return 'Delete recipe: ' + removed[0];
    }
    var body = [];
    if (added.length) body.push('Added: ' + added.join(', '));
    if (updated.length) body.push('Updated: ' + updated.join(', '));
    if (removed.length) body.push('Deleted: ' + removed.join(', '));
    return 'Update ' + total + ' recipes\n\n' + body.join('\n');
  }

  // ------------------------------------------------------------ connect & publish

  /** Check the token can read the repository and its recipes file, then remember it. */
  function connect(settings) {
    var cfg = Object.assign(defaults(), {
      owner: String(settings.owner || '').trim() || defaults().owner,
      repo: String(settings.repo || '').trim() || defaults().repo,
      branch: String(settings.branch || '').trim(),
      token: String(settings.token || '').trim()
    });
    if (!cfg.token) return Promise.reject(fail('Paste your GitHub token first.', 'input'));
    return api(cfg, 'GET', repoUrl(cfg)).then(function (repo) {
      if (!cfg.branch) cfg.branch = (repo && repo.default_branch) || 'main';
      return fetchFile(cfg);
    }).then(function (file) {
      parseFile(file.text);
      write(K_CONFIG, cfg);
      return cfg;
    });
  }

  /**
   * Apply this browser's changes to the latest data/recipes.js on GitHub and commit it.
   * Resolves to { count, message, url, added, updated, removed }; count is 0 if there was nothing to publish.
   */
  function publish() {
    var cfg = config();
    if (!cfg.token) return Promise.reject(fail('This browser isn’t connected to GitHub.', 'auth'));
    var attempts = 0;

    function run() {
      attempts++;
      return fetchFile(cfg).then(function (file) {
        var remote = parseFile(file.text);
        var map = {};
        remote.recipes.forEach(function (raw) { var r = Store.normalize(raw); if (r.id) map[r.id] = r; });

        var pend = Store.pendingChanges();
        var added = [], updated = [], removed = [];
        pend.upserts.forEach(function (r) {
          if (!map[r.id]) added.push(r.title);
          else if (!Store.same(map[r.id], r)) updated.push(r.title);
          else return;
          map[r.id] = r;
        });
        pend.deletes.forEach(function (id) {
          if (map[id]) { removed.push(map[id].title); delete map[id]; }
        });

        var list = Object.keys(map).map(function (id) { return map[id]; })
          .sort(function (a, b) { return a.title.localeCompare(b.title); });

        if (!added.length && !updated.length && !removed.length) {
          Store.markPublished(list, remote.version);
          return { count: 0 };
        }

        var version = nextVersion(remote.version);
        var message = commitMessage(added, updated, removed);
        return api(cfg, 'PUT', contentsUrl(cfg), {
          message: message,
          content: b64encode(Store.exportSiteFile(list, version)),
          sha: file.sha,
          branch: cfg.branch
        }).then(function (res) {
          Store.markPublished(list, version);
          var last = { at: new Date().toISOString(), message: message.split('\n')[0], url: (res && res.commit && res.commit.html_url) || '' };
          write(K_LAST, last);
          return { count: added.length + updated.length + removed.length, message: last.message, url: last.url, added: added, updated: updated, removed: removed };
        });
      }).catch(function (e) {
        if (e.code === 'conflict' && attempts < 3) return run();
        throw e;
      });
    }
    return run();
  }

  root.Sync = {
    config: config, isConnected: isConnected, connect: connect, disconnect: disconnect,
    publish: publish, lastPublish: lastPublish, repoName: repoName,
    _parseFile: parseFile
  };
})(window);
