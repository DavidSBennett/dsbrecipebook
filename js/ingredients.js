/*
 * ingredients.js — understand ingredient lines like "1 1/2 cups cherry tomatoes, halved".
 * Used to scale recipes up/down and to merge ingredients into a grocery list.
 */
(function (root) {
  'use strict';

  var UNICODE_FRACTIONS = {
    '½': '1/2', '⅓': '1/3', '⅔': '2/3', '¼': '1/4', '¾': '3/4', '⅕': '1/5', '⅖': '2/5',
    '⅗': '3/5', '⅘': '4/5', '⅙': '1/6', '⅚': '5/6', '⅛': '1/8', '⅜': '3/8', '⅝': '5/8', '⅞': '7/8'
  };
  var FRACTION_CHARS = '½⅓⅔¼¾⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞';
  var FRACTION_RE = new RegExp('(\\d)\\s*([' + FRACTION_CHARS + '])|([' + FRACTION_CHARS + '])', 'g');

  var NUM = '\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+(?:\\.\\d+)?|\\.\\d+';
  var QTY_RE = new RegExp('^(' + NUM + ')(?:\\s*(?:-|–|—|to)\\s*(' + NUM + '))?(?![\\d/])');

  var UNIT_RE = /^(fluid\s+ounces?|fl\.?\s*oz|tablespoons?|tbsps?|tbls?|tbs|teaspoons?|tsps?|cups?|c|ounces?|oz|pounds?|lbs?|kilograms?|kgs?|grams?|gr|g|milliliters?|millilitres?|ml|liters?|litres?|l|pints?|pt|quarts?|qt|gallons?|gal|pinch(?:es)?|dash(?:es)?|cloves?|cans?|jars?|packages?|pkgs?|packets?|sticks?|slices?|bunch(?:es)?|sprigs?|heads?|stalks?|pieces?|handfuls?|bags?|box(?:es)?|bottles?|containers?)\.?(?=[\s,)]|$)/i;

  var UNIT_CANON = [
    ['fl oz', /^(fluid ounces?|fl ?oz)$/], ['tbsp', /^(tablespoons?|tbsps?|tbls?|tbs)$/],
    ['tsp', /^(teaspoons?|tsps?)$/], ['cup', /^(cups?|c)$/], ['oz', /^(ounces?|oz)$/],
    ['lb', /^(pounds?|lbs?)$/], ['kg', /^(kilograms?|kgs?)$/], ['g', /^(grams?|gr|g)$/],
    ['ml', /^(millilit(er|re)s?|ml)$/], ['l', /^(lit(er|re)s?|l)$/], ['pint', /^(pints?|pt)$/],
    ['quart', /^(quarts?|qt)$/], ['gallon', /^(gallons?|gal)$/], ['pinch', /^pinch(es)?$/],
    ['dash', /^dash(es)?$/], ['clove', /^cloves?$/], ['can', /^cans?$/], ['jar', /^jars?$/],
    ['package', /^(packages?|pkgs?)$/], ['packet', /^packets?$/], ['stick', /^sticks?$/],
    ['slice', /^slices?$/], ['bunch', /^bunch(es)?$/], ['sprig', /^sprigs?$/], ['head', /^heads?$/],
    ['stalk', /^stalks?$/], ['piece', /^pieces?$/], ['handful', /^handfuls?$/], ['bag', /^bags?$/],
    ['box', /^box(es)?$/], ['bottle', /^bottles?$/], ['container', /^containers?$/]
  ];
  var NO_PLURAL = { tsp: 1, tbsp: 1, oz: 1, 'fl oz': 1, lb: 1, g: 1, kg: 1, ml: 1, l: 1 };
  var ES_PLURAL = { pinch: 1, dash: 1, bunch: 1, box: 1 };

  // Conversion "families" so 1 tbsp + 1 tsp can be added together on the grocery list.
  var FAMILIES = {
    volume: { tsp: 1, tbsp: 3, 'fl oz': 6, cup: 48, pint: 96, quart: 192, gallon: 768 },
    weight: { oz: 1, lb: 16 },
    metricWeight: { g: 1, kg: 1000 },
    metricVolume: { ml: 1, l: 1000 }
  };

  // Words after a comma that mean "this is prep, not part of the name": "garlic, minced".
  var PREP_START = /^(\w+ed|\w+ly|for|to|about|or|plus|cut|divided|optional|at|such|if|room|torn|ground|thawed|beaten|preferably|from|into|without|halved|quartered|softened)\b/i;

  function normalize(line) {
    return String(line == null ? '' : line)
      .replace(FRACTION_RE, function (m, d, f1, f2) { return d ? d + ' ' + UNICODE_FRACTIONS[f1] : UNICODE_FRACTIONS[f2]; })
      .replace(/⁄/g, '/')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function toNum(s) {
    s = String(s).trim();
    var m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/);
    if (m) return +m[1] + (+m[2] / +m[3]);
    m = s.match(/^(\d+)\/(\d+)$/);
    if (m) return +m[2] ? +m[1] / +m[2] : null;
    var n = parseFloat(s);
    return isFinite(n) ? n : null;
  }

  function canonUnit(text) {
    var u = text.toLowerCase().replace(/\./g, '').replace(/\s+/g, ' ').trim();
    for (var i = 0; i < UNIT_CANON.length; i++) if (UNIT_CANON[i][1].test(u)) return UNIT_CANON[i][0];
    return null;
  }

  function unitLabel(unit, amount) {
    if (!unit) return '';
    if (NO_PLURAL[unit] || !(amount > 1)) return unit;
    return unit + (ES_PLURAL[unit] ? 'es' : 's');
  }

  /** A line ending in ":" with no amount, e.g. "For the sauce:", is a sub-heading. */
  function isHeader(line) {
    var t = String(line || '').trim();
    return /:$/.test(t) && t.length <= 60 && !QTY_RE.test(normalize(t));
  }

  function singular(word) {
    if (word.length < 4) return word;
    return word
      .replace(/ies$/, 'y')
      .replace(/(oes|ches|shes|sses|xes)$/, function (m) { return m.slice(0, -2); })
      .replace(/([^s])s$/, '$1');
  }

  function keyFor(name) {
    var s = name.toLowerCase()
      .replace(/\([^)]*\)/g, ' ')
      .replace(/fresh(ly)? ground/g, ' ')
      .replace(/[^a-z\s-]/g, ' ')
      .replace(/\bextra[- ]virgin\b/g, ' ')
      .replace(/\b(fresh|freshly|large|small|medium|extra large|finely|roughly|coarsely|thinly|chopped|minced|diced|sliced|grated|shredded|packed|good quality|organic|optional|plain)\b/g, ' ')
      .replace(/\b(kosher|sea|table|fine|flaky) salt\b/g, 'salt')
      .replace(/\s+/g, ' ')
      .trim();
    return s.split(' ').map(singular).join(' ');
  }

  /**
   * Break an ingredient line into parts.
   * "1 (14-oz.) can diced tomatoes, drained" ->
   *   { qty: 1, unit: 'can', name: 'diced tomatoes', note: '14-oz.; drained', ... }
   */
  function parse(line) {
    var raw = normalize(line);
    var out = {
      raw: raw, qty: null, qtyMax: null, unit: null, unitAdjacent: false,
      afterQty: raw, afterUnit: raw, name: '', note: '', key: ''
    };
    var s = raw;
    var m = s.match(QTY_RE);
    if (m) {
      out.qty = toNum(m[1]);
      if (m[2]) out.qtyMax = toNum(m[2]);
      s = s.slice(m[0].length).trim();
      out.afterQty = s;
    }
    var notes = [];
    var pm = out.qty != null && s.match(/^\(([^)]*)\)\s*/);
    var hadParen = false;
    if (pm) { notes.push(pm[1].trim()); s = s.slice(pm[0].length); hadParen = true; }

    var um = s.match(UNIT_RE);
    if (um) {
      var unit = canonUnit(um[1]);
      if (unit && (out.qty != null || unit === 'pinch' || unit === 'dash')) {
        out.unit = unit;
        out.unitAdjacent = !hadParen && out.qty != null;
        s = s.slice(um[0].length).trim().replace(/^of\s+/i, '');
        out.afterUnit = s;
      }
    }

    var body = s.replace(/\(([^)]*)\)/g, function (all, inner) { notes.push(inner.trim()); return ' '; })
      .replace(/\s+/g, ' ').trim();
    var parts = body.split(/\s*,\s*/);
    var nameParts = [parts[0]];
    var i = 1;
    for (; i < parts.length; i++) {
      if (PREP_START.test(parts[i])) break;
      nameParts.push(parts[i]);
    }
    var name = nameParts.join(', ');
    if (i < parts.length) notes.push(parts.slice(i).join(', '));
    name = name.replace(/\s+(to taste|for (serving|garnish)|as needed|optional)$/i, function (x) {
      notes.push(x.trim()); return '';
    }).replace(/^(a|an)\s+/i, '').trim();

    out.name = name;
    out.note = notes.filter(Boolean).join('; ');
    out.key = keyFor(name);

    // Grocery helpers: "3 garlic cloves" is the same shopping item as "2 cloves garlic".
    out.shopUnit = out.unit;
    out.shopKey = out.key;
    out.shopName = name;
    if (out.qty != null && !out.unit) {
      var tail = out.key.match(/^(.+) (clove|stalk|sprig|head|bunch)$/);
      if (tail) {
        out.shopKey = tail[1]; out.shopUnit = tail[2];
        out.shopName = name.replace(/\s+\S+$/, '');
      }
    }
    if (out.unit === 'can' || out.unit === 'jar') out.shopKey = 'canned ' + out.shopKey.replace(/^canned /, '');
    return out;
  }

  var NICE_FRACTIONS = [
    [0, ''], [1 / 8, '⅛'], [1 / 4, '¼'], [1 / 3, '⅓'], [3 / 8, '⅜'], [1 / 2, '½'],
    [5 / 8, '⅝'], [2 / 3, '⅔'], [3 / 4, '¾'], [7 / 8, '⅞'], [1, '']
  ];

  /** 1.5 -> "1½", 0.333 -> "⅓", 2.4 -> "2.4" */
  function formatQty(n) {
    if (n == null || !isFinite(n)) return '';
    if (n >= 10) return String(Math.round(n * 10) / 10);
    var whole = Math.floor(n + 1e-9);
    var frac = n - whole;
    var best = NICE_FRACTIONS[0], diff = Infinity;
    for (var i = 0; i < NICE_FRACTIONS.length; i++) {
      var d = Math.abs(frac - NICE_FRACTIONS[i][0]);
      if (d < diff) { diff = d; best = NICE_FRACTIONS[i]; }
    }
    if (diff > 0.04) return String(Math.round(n * 100) / 100);
    if (best[0] === 1) return String(whole + 1);
    if (!best[1]) return String(whole || 0);
    return (whole ? String(whole) : '') + best[1];
  }

  /**
   * Split a line into a bold-able amount and the rest, scaled by `factor`.
   * "1 1/2 cups cherry tomatoes, halved" x2 -> { amount: "3 cups", rest: "cherry tomatoes, halved" }
   */
  function scaleParts(line, factor) {
    var p = parse(line);
    factor = factor || 1;
    if (p.qty == null) return { amount: '', rest: p.raw };
    var q = p.qty * factor;
    var qMax = p.qtyMax != null ? p.qtyMax * factor : null;
    var amount = formatQty(q) + (qMax != null ? '–' + formatQty(qMax) : '');
    var rest = p.afterQty;
    if (p.unit && p.unitAdjacent) {
      amount += ' ' + unitLabel(p.unit, qMax != null ? qMax : q);
      rest = p.afterUnit;
    }
    return { amount: amount, rest: rest };
  }

  // ---------- grocery list ----------

  var CATEGORY_ORDER = ['Produce', 'Meat & seafood', 'Dairy & eggs', 'Bakery', 'Pantry',
    'Spices & seasonings', 'Frozen', 'Other'];

  var CATEGORY_RULES = [
    ['Frozen', /\bfrozen\b/],
    ['Pantry', /\b(broth|stock|bouillon|peanut butter|almond butter|panko|breadcrumb|tomato paste|tomato sauce|canned|sun dried|sun-dried|coconut milk|evaporated|condensed)\b/],
    ['Spices & seasonings', /\b(dried|powder|flake|seasoning|salt|peppercorn|black pepper|white pepper|cayenne|paprika|cumin|cinnamon|nutmeg|turmeric|coriander|garam masala|allspice|cardamom|vanilla|bay lea\w*|curry|clove spice)\b|^pepper$|salt and pepper|\bground (ginger|cinnamon|cumin|coriander|nutmeg|clove|mustard)\b/],
    ['Meat & seafood', /\b(chicken|beef|steak|pork|bacon|ham|sausage|turkey|lamb|veal|prosciutto|pancetta|salami|chorizo|salmon|shrimp|prawn|fish|cod|tilapia|tuna|halibut|scallop|crab|lobster|mussel|clam|anchov\w*|meatball|ground meat)\b/],
    ['Dairy & eggs', /\b(butter|milk|cream|cheese|parmesan|parmigiano|mozzarella|cheddar|ricotta|feta|yogurt|yoghurt|egg|half-and-half|buttermilk|ghee|mascarpone|gruyere|pecorino|provolone|creme fraiche)\b/],
    ['Produce', /\b(tomato|spinach|lettuce|kale|arugula|onion|shallot|garlic|scallion|leek|potato|carrot|celery|bell pepper|pepper|jalapeno|jalapeño|chile|chili|cucumber|zucchini|squash|eggplant|mushroom|broccoli|cauliflower|cabbage|corn|pea|green bean|avocado|lemon|lime|orange|apple|banana|berry|berrie|strawberry|blueberry|raspberry|grape|mango|pineapple|peach|pear|basil|parsley|cilantro|mint|dill|thyme|rosemary|sage|chive|ginger|herb|radish|beet|asparagus|fennel|okra|greens)\b/],
    ['Bakery', /\b(bread|baguette|bun|roll|tortilla|pita|naan|croissant|brioche|bagel|ciabatta|sourdough)\b/],
    ['Pantry', /\b(oil|vinegar|flour|sugar|rice|pasta|spaghetti|penne|linguine|fettuccine|rigatoni|noodle|orzo|bean|lentil|chickpea|oat|honey|syrup|soy sauce|sauce|mustard|ketchup|mayo|mayonnaise|nut|almond|walnut|pecan|cashew|cornstarch|baking|yeast|cocoa|chocolate|wine|quinoa|couscous|jam|olive|caper|water)\b/]
  ];

  function categorize(key) {
    for (var i = 0; i < CATEGORY_RULES.length; i++) if (CATEGORY_RULES[i][1].test(key)) return CATEGORY_RULES[i][0];
    return 'Other';
  }

  function familyOf(unit) {
    for (var f in FAMILIES) if (FAMILIES[f][unit]) return f;
    return null;
  }

  function bestUnit(family, base) {
    var u = FAMILIES[family];
    if (family === 'volume') return base >= 12 ? 'cup' : base >= 3 ? 'tbsp' : 'tsp';
    if (family === 'weight') return base >= 16 ? 'lb' : 'oz';
    if (family === 'metricWeight') return base >= 1000 ? 'kg' : 'g';
    if (family === 'metricVolume') return base >= 1000 ? 'l' : 'ml';
    return Object.keys(u)[0];
  }

  function amountText(item) {
    var parts = [];
    var byFamily = {};
    Object.keys(item.amounts).forEach(function (unit) {
      var fam = familyOf(unit);
      if (fam) (byFamily[fam] = byFamily[fam] || []).push(unit);
      else parts.push(formatQty(item.amounts[unit]) + ' ' + unitLabel(unit, item.amounts[unit]));
    });
    Object.keys(byFamily).forEach(function (fam) {
      var units = byFamily[fam];
      if (units.length === 1) {
        var u = units[0];
        parts.unshift(formatQty(item.amounts[u]) + ' ' + unitLabel(u, item.amounts[u]));
        return;
      }
      var base = 0;
      units.forEach(function (u) { base += item.amounts[u] * FAMILIES[fam][u]; });
      var target = bestUnit(fam, base);
      var val = base / FAMILIES[fam][target];
      parts.unshift(formatQty(val) + ' ' + unitLabel(target, val));
    });
    if (item.count) parts.unshift(formatQty(item.count));
    return parts.join(' + ');
  }

  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /**
   * entries: [{ recipe, factor }]
   * returns [{ category, items: [{ key, name, amount, recipes: [titles], lines: [raw lines] }] }]
   */
  function buildGroceryList(entries) {
    var map = {};
    entries.forEach(function (entry) {
      var recipe = entry.recipe, factor = entry.factor || 1;
      (recipe.ingredients || []).forEach(function (line) {
        if (!line || isHeader(line)) return;
        var p = parse(line);
        if (!p.name || !p.shopKey) return;
        var it = map[p.shopKey];
        if (!it) {
          it = map[p.shopKey] = { key: p.shopKey, name: capitalize(p.shopName), amounts: {}, count: 0, recipes: [], lines: [] };
        }
        if (p.qty != null) {
          var q = (p.qtyMax != null ? p.qtyMax : p.qty) * factor; // shop for the top of a range
          if (p.shopUnit) it.amounts[p.shopUnit] = (it.amounts[p.shopUnit] || 0) + q;
          else it.count += q;
        }
        if (it.recipes.indexOf(recipe.title) < 0) it.recipes.push(recipe.title);
        it.lines.push(line);
      });
    });
    var groups = {};
    Object.keys(map).forEach(function (k) {
      var it = map[k];
      var cat = categorize(k);
      (groups[cat] = groups[cat] || []).push({
        key: it.key, name: it.name, amount: amountText(it), recipes: it.recipes, lines: it.lines,
        count: it.count, units: it.amounts
      });
    });
    return CATEGORY_ORDER.filter(function (c) { return groups[c]; }).map(function (c) {
      return { category: c, items: groups[c].sort(function (a, b) { return a.name.localeCompare(b.name); }) };
    });
  }

  var api = {
    parse: parse, normalize: normalize, scaleParts: scaleParts, formatQty: formatQty,
    unitLabel: unitLabel, isHeader: isHeader, categorize: categorize,
    buildGroceryList: buildGroceryList, CATEGORY_ORDER: CATEGORY_ORDER
  };
  root.Ingredients = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
