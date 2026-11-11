/*
 * parser.js — turn a messy copy/paste of a recipe web page into a clean recipe.
 *
 * Works with:
 *   1. Saved/view-source HTML that contains schema.org Recipe data (most recipe sites) — best results.
 *   2. HTML copied from the browser (Ctrl+A, Ctrl+C on the page) — uses the page structure.
 *   3. Plain text / markdown-ish text — uses headings like "Ingredients" and "Directions".
 *
 * It throws away ads, life stories, reviews, "you'll also love" links, newsletter boxes, etc.
 */
(function (root) {
  'use strict';
  var Ing = root.Ingredients;

  // ---------------------------------------------------------------- text helpers

  var ENTITIES = {
    amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘',
    rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…', deg: '°', frac12: '½',
    frac14: '¼', frac34: '¾', times: '×', eacute: 'é', egrave: 'è', ntilde: 'ñ', reg: '®', copy: '©'
  };

  function decodeEntities(s) {
    return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, function (m, e) {
      if (e.charAt(0) === '#') {
        var code = e.charAt(1).toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return isFinite(code) && code > 0 ? String.fromCodePoint(code) : m;
      }
      var v = ENTITIES[e.toLowerCase()];
      return v !== undefined ? v : m;
    });
  }

  function squish(s) {
    return String(s || '').replace(/[   ​﻿]/g, ' ').replace(/[ \t]+/g, ' ').trim();
  }

  function stripTags(s) {
    return String(s || '')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<\/(p|li|div|h\d)>/gi, '\n')
      .replace(/<[^>]+>/g, ' ');
  }

  /** Remove markdown link/image syntax, bold markers and HTML entities from one line. */
  function cleanInline(s) {
    return squish(decodeEntities(String(s || ''))
      .replace(/!\[[^\]]*\]\((?:[^()\s]|\([^)]*\))*\)/g, '')
      .replace(/\[([^\]]*)\]\((?:[^()\s]|\([^)]*\))*\)/g, '$1')
      .replace(/(\*\*|__)(.+?)\1/g, '$2'));
  }

  function cleanStep(s) {
    return squish(s).replace(/^step\s*\d+\s*[:.)\-–]?\s*/i, '').trim();
  }

  // ---------------------------------------------------------------- line model

  function toLines(text) {
    return String(text || '').split(/\r?\n/).map(function (raw) {
      var t = raw.replace(/\t/g, ' ');
      var kind = 'text', m;
      if ((m = t.match(/^\s*#{1,6}\s+(.*)$/))) { kind = 'heading'; t = m[1]; }
      else if (/^\s*[*\-+•▪◦·▢□☐]\s*$/.test(t)) { kind = 'bullet'; t = ''; }
      else if ((m = t.match(/^\s*(?:[*\-+]\s+|[•▪◦·▢□☐]\s*)(.*)$/))) { kind = 'bullet'; t = m[1]; }
      else if ((m = t.match(/^\s*(\d{1,2})[.)]\s+(.*)$/))) { kind = 'ordered'; t = m[2]; }
      return { kind: kind, text: cleanInline(t) };
    });
  }

  var JUNK = [
    /^advertisement\b/i, /continue reading below/i, /^(photo(graph)?s?|image)( by| credit)?\s*:/i,
    /(food|prop) styling\s*:/i,
    /^(save|print|share|pin( it)?|email|jump to( the)? recipe|print recipe|save recipe|i made it|rate it|rate this recipe|skip to( main)? content|search|sign in|log in|subscribe|expand|close|menu|newsletter|reviews?|comments?|watch( now)?|video|play|pause|mute)$/i,
    /^saveprint/i, /cook mode/i, /download the .*app/i, /^see (all )?nutrition(al)? info/i,
    /^\d(\.\d)?$/, /^\(?\d[\d,]*\s+(ratings?|reviews?|comments?)\)?$/i,
    /^we may earn (a )?commission/i, /^©/, /all rights reserved/i, /protected by recaptcha/i,
    /^by signing up/i, /^email address$/i, /^\d+\s+articles? left$/i, /^(we've got more|get the recipes)/i,
    /^(sign up|send me|join now|log in to|create (a free )?account)/i, /^this post may contain affiliate links/i,
    /^(your privacy choices|privacy (notice|policy)|terms of (use|service)|site map|cookie (settings|policy))/i,
    /^(as an amazon associate)/i
  ];

  function isJunk(t) {
    for (var i = 0; i < JUNK.length; i++) if (JUNK[i].test(t)) return true;
    return false;
  }

  var H_ING = /^(ingredients?|ingredient list|what you(?:'|’)?ll need|you(?:'|’)?ll need|shopping list)\b.{0,30}$/i;
  var H_DIR = /^(directions?|instructions?|method|preparation|steps|how to make\b.*|step[- ]by[- ]step(?:[- ]instructions?)?|to make\b.*)$/i;
  var H_STOP = /^(notes?\b|recipe notes|cook(?:'|’)?s notes|tips?\b|nutrition\b|storage\b|how to store|storing|make[- ]ahead|serving suggestions?|what to serve|variations?\b|.*\bvariations$|faqs?\b|frequently asked|equipment\b|reviews?\b|comments?\b|rate (it|this recipe)|made this|you(?:'|’)?ll also love|like this recipe|readers also read|related\b|more recipes|you may also like|did you make this|more from|popular\b|trending\b|latest\b)/i;
  var H_NOTES = /^(notes?|recipe notes|cook(?:'|’)?s notes|chef(?:'|’)?s notes|tips?|tips (and|&) tricks|storage|how to store.*|storing.*|make[- ]ahead.*|leftovers|substitutions?|freezing)$/i;

  function headText(t) { return t.replace(/[:\s]+$/, ''); }
  function isSectionHead(t) {
    var h = headText(t);
    return h.length > 0 && h.length <= 60 && (H_ING.test(h) || H_DIR.test(h) || H_STOP.test(h));
  }
  function isHeadingLike(l) {
    if (l.kind === 'heading') return true;
    if (l.kind !== 'text') return false;
    var t = l.text;
    return t.length > 0 && t.length <= 60 && !/[.!?,;]$/.test(t) && !/^\d/.test(t) && t.split(/\s+/).length <= 9;
  }
  function isGroupHeader(t) { return Ing.isHeader(t); }

  // ---------------------------------------------------------------- sections

  function collectSection(lines, start, mode) {
    var items = [];
    var listMode = null;
    for (var i = start + 1; i < lines.length; i++) {
      var l = lines[i], t = l.text;
      if (!t) continue;
      if (isSectionHead(t)) break;
      var isList = l.kind === 'bullet' || l.kind === 'ordered';
      if (l.kind === 'heading') {
        // A sub-heading inside the section, e.g. "For the sauce"
        if (t.length <= 50) { items.push(headText(t) + ':'); continue; }
        break;
      }
      if (isList) {
        if (listMode === null) listMode = true;
        items.push(t);
      } else if (listMode === true) {
        if (/:$/.test(t) && t.length <= 50) { items.push(t); continue; }
        break;
      } else {
        listMode = false;
        if (mode === 'ing') {
          if (t.length > 90 && /[.!?]$/.test(t)) { if (items.length) break; else continue; }
          if (t.length > 140) { if (items.length) break; else continue; }
          items.push(t);
        } else {
          if (items.length && isHeadingLike(l)) break;
          items.push(t);
        }
      }
      if (items.length > 80) break;
    }
    while (items.length && isGroupHeader(items[items.length - 1])) items.pop();
    return { items: items, ordered: listMode === true };
  }

  function ingScore(items) {
    var real = items.filter(function (t) { return !isGroupHeader(t); });
    if (!real.length) return -Infinity;
    var s = 0;
    real.forEach(function (t) {
      var p = Ing.parse(t), v = 0;
      if (p.qty != null) v += 1;
      if (p.unit) v += 0.5;
      if (t.length <= 60) v += 0.5;
      if (t.length > 120) v -= 1.5;
      if (/^[^:]{2,40}:\s+\S.{40,}/.test(t)) v -= 1;
      if (/\b(I|my|we|you|I'm|I've)\b/.test(t)) v -= 0.5;
      s += v;
    });
    return s / real.length + Math.min(real.length, 15) * 0.02;
  }

  function dirScore(sec) {
    var real = sec.items.filter(function (t) { return !isGroupHeader(t); });
    if (!real.length) return -Infinity;
    var s = 0;
    real.forEach(function (t) {
      var v = 0;
      if (t.length >= 15 && t.length <= 900) v += 0.5;
      if (/^step\s*\d/i.test(t)) v += 0.5;
      if (/\b(I|my|I'm|I've|we|our)\b/.test(t)) v -= 0.6;
      if (t.length < 15) v -= 0.5;
      s += v;
    });
    return s / real.length + (sec.ordered ? 0.5 : 0) + Math.min(real.length, 10) * 0.01;
  }

  function cleanSteps(items) {
    var out = [];
    items.forEach(function (t) {
      if (/^step\s*\d+\s*[:.]?$/i.test(t)) return; // "Step 1" on its own line
      var c = isGroupHeader(t) ? t : cleanStep(t);
      if (c) out.push(c);
    });
    return out;
  }

  function findIngredients(lines) {
    var best = null, bestScore = -Infinity;
    lines.forEach(function (l, i) {
      if (l.kind === 'bullet' || l.kind === 'ordered') return;
      if (!H_ING.test(headText(l.text)) || l.text.length > 60) return;
      var sec = collectSection(lines, i, 'ing');
      var sc = ingScore(sec.items);
      if (sec.items.length && sc >= bestScore) { best = sec.items; bestScore = sc; }
    });
    if (best && bestScore > 0.3) return best;
    // Fallback: the most ingredient-looking run of bullet lines anywhere on the page.
    var runs = listRuns(lines, function (l) { return l.kind === 'bullet'; });
    runs.forEach(function (run) {
      var sc = ingScore(run);
      if (run.length >= 2 && sc > bestScore) { best = run; bestScore = sc; }
    });
    return best && bestScore > 0.8 ? best : (best || []);
  }

  function findSteps(lines) {
    var best = null, bestScore = -Infinity;
    lines.forEach(function (l, i) {
      if (l.kind === 'bullet' || l.kind === 'ordered') return;
      if (!H_DIR.test(headText(l.text)) || l.text.length > 60) return;
      var sec = collectSection(lines, i, 'dir');
      var sc = dirScore(sec);
      if (sec.items.length && sc >= bestScore) { best = sec.items; bestScore = sc; }
    });
    if (best) return cleanSteps(best);
    var runs = listRuns(lines, function (l) { return l.kind === 'ordered'; });
    runs.forEach(function (run) {
      var sc = dirScore({ items: run, ordered: true });
      if (run.length >= 2 && sc > bestScore) { best = run; bestScore = sc; }
    });
    return best ? cleanSteps(best) : [];
  }

  function listRuns(lines, pred) {
    var runs = [], cur = [];
    lines.forEach(function (l) {
      if (pred(l)) { if (l.text) cur.push(l.text); }
      else if (l.text) { if (cur.length) runs.push(cur); cur = []; }
    });
    if (cur.length) runs.push(cur);
    return runs;
  }

  // ---------------------------------------------------------------- metadata

  var META = [
    ['servings', /(?:^|\b(?=yield|serving))(?:yields?|servings?|serves|makes)\b\s*:?\s*(.*)$/i],
    ['prepTime', /\b(?:prep(?:aration)?|active)\s*time\s*:?\s*(.*)$/i],
    ['cookTime', /\b(?:cook(?:ing)?|bake|baking)\s*time\s*:?\s*(.*)$/i],
    ['totalTime', /\btotal\s*time\s*:?\s*(.*)$/i],
    ['calories', /(?:^|\b)(?:cal(?:ories)?\s*\/\s*serv(?:ing)?|calories(?:\s*per\s*serving)?)\s*:?\s*(.*)$/i]
  ];
  var NEXT_LABEL = /\s*(?:\||•|·)\s*|\s*(?=(?:prep|cook|total|servings?|yields?|serves|calories)\b)/i;

  function extractMeta(lines) {
    var meta = {};
    for (var i = 0; i < lines.length; i++) {
      // "10 minutesCook Time" (labels glued together when copied) -> "10 minutes Cook Time"
      var t = lines[i].text.replace(/([a-z\d])([A-Z])/g, '$1 $2');
      if (!t || t.length > 160) continue;
      for (var k = 0; k < META.length; k++) {
        var key = META[k][0];
        if (meta[key]) continue;
        var m = t.match(META[k][1]);
        if (!m) continue;
        var val = (m[1] || '').split(NEXT_LABEL)[0].trim();
        if (!val) {
          for (var j = i + 1; j < Math.min(lines.length, i + 3); j++) {
            if (lines[j].text) { val = lines[j].text; break; }
          }
        }
        if (val && val.length <= 40 && /\d/.test(val)) meta[key] = val;
      }
    }
    return meta;
  }

  function servingsFrom(text) {
    var m = String(text || '').match(/\d+(?:\.\d+)?/);
    return m ? parseFloat(m[0]) : null;
  }

  function findTitle(lines) {
    for (var i = 1; i < lines.length; i++) {
      if (/^by\s+\S/i.test(lines[i].text) && lines[i].text.length < 160) {
        for (var j = i - 1; j >= Math.max(0, i - 3); j--) {
          var t = lines[j].text;
          if (t && t.length >= 3 && t.length <= 100 && !isSectionHead(t)) return t;
        }
      }
    }
    for (i = 0; i < lines.length; i++) {
      if (lines[i].kind === 'heading' && lines[i].text && !isSectionHead(lines[i].text)) return lines[i].text;
    }
    for (i = 0; i < lines.length; i++) {
      var m = lines[i].text.match(/^how to make\s+(.{3,80})$/i);
      if (m) return m[1];
    }
    for (i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (l.kind === 'text' && l.text.length >= 3 && l.text.length <= 80 && !/^https?:/i.test(l.text) && !isSectionHead(l.text)) return l.text;
    }
    return '';
  }

  function findNotes(lines) {
    var notes = [];
    for (var i = 0; i < lines.length; i++) {
      var l = lines[i];
      if (l.kind === 'bullet' || l.kind === 'ordered') continue;
      var h = headText(l.text);
      if (!h || h.length > 40 || !H_NOTES.test(h)) continue;
      var label = /^(notes?|recipe notes|cook.?s notes|chef.?s notes)$/i.test(h) ? '' : h.charAt(0).toUpperCase() + h.slice(1).toLowerCase() + ': ';
      var taken = 0;
      for (var j = i + 1; j < lines.length && taken < 4; j++) {
        var n = lines[j];
        if (!n.text) continue;
        if (isSectionHead(n.text) || (n.kind !== 'bullet' && isHeadingLike(n))) break;
        if (n.text.length < 20) break;
        notes.push(label + n.text);
        label = '';
        taken++;
      }
    }
    return notes.filter(function (n, idx) { return notes.indexOf(n) === idx; }).slice(0, 8);
  }

  /** The page's own address shows up as links to itself with "#..." on the end. */
  function guessUrl(urls) {
    var counts = {}, best = '', bestN = 0;
    urls.forEach(function (u) {
      if (!/^https?:\/\//i.test(u) || u.indexOf('#') < 0) return;
      var base = u.split('#')[0];
      counts[base] = (counts[base] || 0) + 1;
      if (counts[base] > bestN) { bestN = counts[base]; best = base; }
    });
    return best;
  }

  function findSourceUrl(raw) {
    var lines = String(raw || '').split(/\r?\n/);
    for (var i = 0; i < Math.min(lines.length, 5); i++) {
      var t = lines[i].trim();
      if (/^https?:\/\/\S+$/i.test(t)) return t;
    }
    var urls = [], re = /\]\((https?:\/\/[^)\s]+)\)/g, m;
    while ((m = re.exec(raw))) urls.push(m[1]);
    return guessUrl(urls);
  }

  function siteName(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return ''; }
  }

  function suggestTags(title, ingredients) {
    var t = String(title || '').toLowerCase();
    var all = t + ' ' + (ingredients || []).join(' ').toLowerCase();
    var tags = [];
    function add(tag, re, text) { if (re.test(text) && tags.indexOf(tag) < 0) tags.push(tag); }
    add('chicken', /\bchicken\b/, all);
    add('beef', /\b(beef|steak)\b/, all);
    add('pork', /\b(pork|bacon|ham|sausage)\b/, all);
    add('seafood', /\b(salmon|shrimp|fish|tuna|cod|scallops?|crab|lobster)\b/, all);
    add('pasta', /\b(pasta|spaghetti|penne|linguine|fettuccine|rigatoni|noodles?|orzo|gnocchi|lasagna)\b/, all);
    add('soup', /\b(soup|stew|chili|chowder)\b/, t);
    add('salad', /\bsalad\b/, t);
    add('dessert', /\b(cake|cookies?|brownies?|pie|dessert|tart|pudding|cupcakes?|cheesecake)\b/, t);
    add('breakfast', /\b(breakfast|pancakes?|waffles?|muffins?|oatmeal|frittata|omelet)\b/, t);
    add('slow cooker', /\b(slow[- ]cooker|crock[- ]?pot)\b/, t);
    add('one-pan', /\b(skillet|one[- ]pan|sheet[- ]pan|one[- ]pot)\b/, t);
    return tags;
  }

  function emptyRecipe() {
    return {
      title: '', description: '', servings: null, yield: '', prepTime: '', cookTime: '', totalTime: '',
      calories: '', tags: [], ingredients: [], steps: [], notes: [], source: { url: '', name: '' }, image: ''
    };
  }

  // ---------------------------------------------------------------- plain text path

  function parseText(raw, opts) {
    opts = opts || {};
    var all = toLines(raw);
    var meta = extractMeta(all);
    var lines = all.filter(function (l) { return !(l.text && isJunk(l.text)); });

    var r = emptyRecipe();
    r.title = opts.title || findTitle(lines);
    r.ingredients = findIngredients(lines);
    r.steps = findSteps(lines);
    r.notes = findNotes(lines);
    if (meta.servings) {
      r.servings = servingsFrom(meta.servings);
      if (!/serving|people|person/i.test(meta.servings) && !/^\d+(\.\d+)?$/.test(meta.servings.trim())) r.yield = meta.servings;
    }
    r.prepTime = meta.prepTime || '';
    r.cookTime = meta.cookTime || '';
    r.totalTime = meta.totalTime || '';
    r.calories = meta.calories ? (meta.calories.match(/\d[\d,]*/) || [''])[0] : '';
    var url = opts.url || findSourceUrl(raw);
    r.source = { url: url, name: siteName(url) };
    r.tags = suggestTags(r.title, r.ingredients);
    return r;
  }

  // ---------------------------------------------------------------- HTML path

  function isoDuration(s) {
    var m = String(s || '').match(/^P(?:(\d+)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:\d+(?:\.\d+)?S)?)?$/i);
    if (!m) return squish(s);
    var mins = (+m[1] || 0) * 1440 + (+m[2] || 0) * 60 + (+m[3] || 0);
    if (!mins) return '';
    var h = Math.floor(mins / 60), mm = Math.round(mins % 60);
    return [h ? h + (h === 1 ? ' hr' : ' hrs') : '', mm ? mm + (mm === 1 ? ' min' : ' mins') : ''].filter(Boolean).join(' ');
  }

  function textOf(v) { return squish(decodeEntities(stripTags(v)).replace(/\n+/g, ' ')); }

  function flattenInstructions(x, out) {
    out = out || [];
    if (!x) return out;
    if (typeof x === 'string') {
      decodeEntities(stripTags(x)).split(/\n+/).forEach(function (s) { s = cleanStep(s); if (s) out.push(s); });
    } else if (Array.isArray(x)) {
      x.forEach(function (y) { flattenInstructions(y, out); });
    } else if (typeof x === 'object') {
      var type = [].concat(x['@type'] || []).join(' ');
      if (/HowToSection/i.test(type) || (x.itemListElement && !x.text)) {
        if (x.name) out.push(textOf(x.name).replace(/:?$/, ':'));
        flattenInstructions(x.itemListElement, out);
      } else {
        var t = cleanStep(textOf(x.text || x.name || x.description || ''));
        if (t) out.push(t);
      }
    }
    return out;
  }

  function findLdRecipe(node) {
    if (!node || typeof node !== 'object') return null;
    if (Array.isArray(node)) {
      for (var i = 0; i < node.length; i++) { var r = findLdRecipe(node[i]); if (r) return r; }
      return null;
    }
    var type = [].concat(node['@type'] || []);
    if (type.some(function (t) { return /^(schema:)?Recipe$/i.test(String(t)); })) return node;
    if (node['@graph']) return findLdRecipe(node['@graph']);
    if (node.mainEntity) return findLdRecipe(node.mainEntity);
    return null;
  }

  function imageUrl(img) {
    if (!img) return '';
    if (typeof img === 'string') return img;
    if (Array.isArray(img)) return imageUrl(img[0]);
    return img.url || img.contentUrl || '';
  }

  function fromJsonLd(doc) {
    var scripts = doc.querySelectorAll('script[type="application/ld+json"]');
    for (var i = 0; i < scripts.length; i++) {
      var data;
      try { data = JSON.parse(scripts[i].textContent); } catch (e) { continue; }
      var ld = findLdRecipe(data);
      if (!ld) continue;
      var r = emptyRecipe();
      r.title = textOf(ld.name);
      var desc = textOf(ld.description);
      r.description = desc.length > 320 ? desc.slice(0, 317).replace(/\s+\S*$/, '') + '…' : desc;
      r.ingredients = [].concat(ld.recipeIngredient || ld.ingredients || []).map(textOf).filter(Boolean);
      r.steps = flattenInstructions(ld.recipeInstructions);
      var y = [].concat(ld.recipeYield || [])[0];
      if (y != null) {
        y = textOf(String(y));
        r.servings = servingsFrom(y);
        if (y && !/^\d+(\.\d+)?$/.test(y) && !/serving|people|person/i.test(y)) r.yield = y;
      }
      r.prepTime = isoDuration(ld.prepTime);
      r.cookTime = isoDuration(ld.cookTime);
      r.totalTime = isoDuration(ld.totalTime);
      var cal = ld.nutrition && ld.nutrition.calories;
      r.calories = cal ? (String(cal).match(/\d[\d,]*/) || [''])[0] : '';
      r.image = imageUrl(ld.image);
      var tags = [].concat(ld.recipeCategory || [], ld.recipeCuisine || [])
        .join(',').split(',').map(function (t) { return textOf(t).toLowerCase(); }).filter(Boolean);
      r.tags = tags.concat(suggestTags(r.title, r.ingredients))
        .filter(function (t, idx, a) { return a.indexOf(t) === idx; }).slice(0, 8);
      return r;
    }
    return null;
  }

  // Popular recipe-card plugins, used when there's no schema.org data.
  var CARD_SELECTORS = [
    { ing: '.wprm-recipe-ingredient', step: '.wprm-recipe-instruction-text', notes: '.wprm-recipe-notes' },
    { ing: '.tasty-recipes-ingredients li', step: '.tasty-recipes-instructions li', notes: '.tasty-recipes-notes' },
    { ing: '.mntl-structured-ingredients__list-item', step: '.mntl-sc-block-group--LI p' },
    { ing: '[itemprop="recipeIngredient"], [itemprop="ingredients"]', step: '[itemprop="recipeInstructions"]' }
  ];

  function fromCardSelectors(doc) {
    for (var i = 0; i < CARD_SELECTORS.length; i++) {
      var sel = CARD_SELECTORS[i];
      var ing = Array.prototype.map.call(doc.querySelectorAll(sel.ing), function (el) { return textOf(el.textContent); }).filter(Boolean);
      if (ing.length < 2) continue;
      var steps = [];
      Array.prototype.forEach.call(doc.querySelectorAll(sel.step), function (el) {
        var kids = el.querySelectorAll('li, p');
        if (kids.length) Array.prototype.forEach.call(kids, function (k) { var t = cleanStep(textOf(k.textContent)); if (t) steps.push(t); });
        else { var t = cleanStep(textOf(el.textContent)); if (t) steps.push(t); }
      });
      var notes = sel.notes ? Array.prototype.map.call(doc.querySelectorAll(sel.notes + ' p, ' + sel.notes + ' li'), function (el) { return textOf(el.textContent); }).filter(function (t) { return t.length > 10; }) : [];
      return { ingredients: ing, steps: steps, notes: notes };
    }
    return null;
  }

  var JUNK_ATTR = /(^|[\s_-])(ad|ads|adslot|advert\w*|sponsor\w*|promo\w*|newsletter|related|recommend\w*|comments?|social|share|sharing|sidebar|popup|modal|subscribe|cookie\w*|outbrain|taboola|paywall)([\s_-]|$)/i;

  function cleanDom(body) {
    Array.prototype.forEach.call(body.querySelectorAll(
      'script,style,noscript,iframe,svg,nav,footer,aside,form,button,select,input,textarea,template,dialog,video,audio,picture,img,figcaption,[hidden],[aria-hidden="true"]'
    ), function (el) { el.remove(); });
    Array.prototype.slice.call(body.querySelectorAll('*')).forEach(function (el) {
      if (!el.isConnected) return;
      var attr = (typeof el.className === 'string' ? el.className : '') + ' ' + (el.id || '');
      if (!JUNK_ATTR.test(attr)) return;
      if (el.querySelector('h1, [itemprop], .wprm-recipe, .tasty-recipes')) return;
      if (/ingredients/i.test(el.textContent || '') && (el.textContent || '').length > 400) return;
      el.remove();
    });
  }

  var BLOCK = /^(P|DIV|SECTION|ARTICLE|MAIN|HEADER|UL|OL|LI|H[1-6]|TABLE|TR|BLOCKQUOTE|PRE|DL|DT|DD|FIGURE|BR|HR|TD|TH)$/;

  /** Turn DOM into markdown-ish lines: "# Heading", "* bullet", "1. step". */
  function htmlToText(body) {
    var out = [], buf = '', prefix = '';
    function flush() {
      var t = buf.replace(/\s+/g, ' ').trim();
      if (t) { out.push(prefix + t); prefix = ''; }
      buf = '';
    }
    function walk(node) {
      for (var c = node.firstChild; c; c = c.nextSibling) {
        if (c.nodeType === 3) { buf += c.nodeValue; continue; }
        if (c.nodeType !== 1) continue;
        var tag = c.tagName;
        if (!BLOCK.test(tag)) { walk(c); continue; }
        flush();
        if (tag === 'BR' || tag === 'HR') continue;
        if (tag === 'LI') {
          prefix = c.parentNode && c.parentNode.tagName === 'OL' ? '1. ' : '* ';
          walk(c); flush(); prefix = '';
        } else if (/^H[1-6]$/.test(tag)) {
          prefix = '# '; walk(c); flush(); prefix = '';
        } else {
          walk(c); flush();
        }
      }
    }
    walk(body);
    flush();
    return out.join('\n');
  }

  function parseHtml(html) {
    var doc = new DOMParser().parseFromString(html, 'text/html');
    var canon = doc.querySelector('link[rel="canonical"]');
    var og = doc.querySelector('meta[property="og:url"]');
    var url = (canon && canon.getAttribute('href')) || (og && og.getAttribute('content')) ||
      guessUrl(Array.prototype.map.call(doc.querySelectorAll('a[href]'), function (a) { return a.getAttribute('href'); }));
    if (!/^https?:\/\//i.test(url || '')) url = '';
    var ogImg = doc.querySelector('meta[property="og:image"]');

    var ld = fromJsonLd(doc);
    if (ld && ld.ingredients.length) {
      ld.source = { url: url, name: siteName(url) };
      if (!ld.image && ogImg) ld.image = ogImg.getAttribute('content') || '';
      ld._method = 'structured recipe data';
      return ld;
    }

    var card = fromCardSelectors(doc);
    var h1 = doc.querySelector('h1');
    var ogTitle = doc.querySelector('meta[property="og:title"]');
    var title = (h1 && textOf(h1.textContent)) || (ogTitle && textOf(ogTitle.getAttribute('content'))) ||
      textOf(doc.title).split(/\s+[|–—-]\s+/)[0];

    cleanDom(doc.body);
    var r = parseText(htmlToText(doc.body), { title: title, url: url });
    if (card) {
      r.ingredients = card.ingredients;
      if (card.steps.length) r.steps = card.steps;
      if (card.notes.length) r.notes = card.notes;
      r.tags = suggestTags(r.title, r.ingredients);
      r._method = 'recipe card';
    } else {
      r._method = 'page layout';
    }
    return r;
  }

  // ---------------------------------------------------------------- public API

  function looksLikeHtml(s) {
    return /<(html|body|div|p|li|ul|ol|span|h[1-6]|script|article|section|table|br)\b[^>]*>/i.test(s);
  }

  function quality(r) {
    if (!r) return -1;
    return (r.ingredients.length ? 2 : 0) + (r.steps.length ? 2 : 0) + (r.title ? 1 : 0) +
      Math.min(r.ingredients.length, 20) * 0.01 + Math.min(r.steps.length, 20) * 0.01;
  }

  /**
   * parse({ text, html }) -> { recipe, warnings: [], method }
   * Give it whatever you have; when both are present the better result wins.
   */
  function parse(input) {
    if (typeof input === 'string') input = looksLikeHtml(input) ? { html: input } : { text: input };
    var candidates = [];
    if (input.html && typeof DOMParser !== 'undefined') {
      try { candidates.push(parseHtml(input.html)); } catch (e) { /* fall through to text */ }
    }
    if (input.text) {
      if (looksLikeHtml(input.text) && typeof DOMParser !== 'undefined') {
        try { candidates.push(parseHtml(input.text)); } catch (e) { /* ignore */ }
      } else {
        var t = parseText(input.text);
        t._method = 'text';
        candidates.push(t);
      }
    }
    var best = null;
    candidates.forEach(function (c) { if (!best || quality(c) > quality(best)) best = c; });
    best = best || emptyRecipe();
    if (!best.source.url) {
      for (var i = 0; i < candidates.length; i++) if (candidates[i].source.url) { best.source = candidates[i].source; break; }
    }
    var method = best._method || 'text';
    delete best._method;

    var warnings = [];
    if (!best.title) warnings.push('I couldn’t find the recipe name — please type one in.');
    if (!best.ingredients.length) warnings.push('I couldn’t find an ingredient list. Paste it into the Ingredients box below.');
    if (!best.steps.length) warnings.push('I couldn’t find the steps. Paste them into the Steps box below.');
    return { recipe: best, warnings: warnings, method: method };
  }

  var api = { parse: parse, parseText: parseText, toLines: toLines, cleanInline: cleanInline, isoDuration: isoDuration };
  root.RecipeParser = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
