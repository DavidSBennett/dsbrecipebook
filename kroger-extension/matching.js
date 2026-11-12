/*
 * matching.js — turning grocery-list items into Kroger product searches and cart lines.
 * Plain functions, shared by the kroger.com panel and the tests.
 */
(function (root) {
  'use strict';

  /** What to type into Kroger's search for a grocery item. */
  function searchTerm(item) {
    var t = String(item.name || '')
      .replace(/\([^)]*\)/g, ' ')                       // "(Contains: Milk)", "(6- to 8-oz.)"
      .replace(/\b(to taste|as needed|for serving|for garnish|optional)\b/gi, ' ')
      .replace(/[^\w\s'&-]/g, ' ')
      .replace(/\s+/g, ' ').trim();
    var words = t.split(' ');
    if (words.length > 8) t = words.slice(0, 8).join(' ');
    return t.length >= 3 ? t : (t + ' food').trim();
  }

  /** Items with no amount ("Olive oil", "Salt and pepper") are usually already in the pantry. */
  function includeByDefault(item) {
    return !!(item.amount && String(item.amount).trim()) || item.category === 'Also';
  }

  /** Produce counted by the piece (3 limes) buys that many; everything else starts at 1 package. */
  function suggestedQuantity(item) {
    var units = item.units || {};
    var hasUnits = Object.keys(units).some(function (u) { return units[u] > 0; });
    if (item.category === 'Produce' && !hasUnits && item.count > 0) return Math.min(24, Math.max(1, Math.ceil(item.count - 1e-9)));
    return 1;
  }

  function imageOf(p) {
    var imgs = p.images || [];
    var front = imgs.filter(function (i) { return i.featured; })[0] || imgs.filter(function (i) { return i.perspective === 'front'; })[0] || imgs[0];
    if (!front || !front.sizes) return '';
    var order = ['thumbnail', 'small', 'medium', 'large', 'xlarge'];
    var sizes = front.sizes.slice().sort(function (a, b) { return order.indexOf(a.size) - order.indexOf(b.size); });
    var pick = sizes.filter(function (s) { return s.size === 'small' || s.size === 'thumbnail'; })[0] || sizes[0];
    return pick && pick.url ? pick.url : '';
  }

  /** A Kroger Products API result reduced to what the panel shows. */
  function productSummary(p) {
    var it = (p.items || [])[0] || {};
    var price = it.price || {};
    var stock = it.inventory && it.inventory.stockLevel;
    return {
      upc: String(p.upc || it.itemId || ''),
      productId: String(p.productId || ''),
      description: String(p.description || ''),
      brand: String(p.brand || ''),
      size: String(it.size || ''),
      price: typeof price.regular === 'number' ? price.regular : null,
      promo: typeof price.promo === 'number' && price.promo > 0 && price.promo < price.regular ? price.promo : null,
      image: imageOf(p),
      inStock: stock ? stock !== 'TEMPORARILY_OUT_OF_STOCK' : null
    };
  }

  /**
   * Put the best choice first: the product chosen for this item last time (if Kroger still
   * returns it, or as a saved entry if not), then in-stock items, keeping Kroger's own order.
   */
  function rankProducts(products, remembered) {
    var list = products.slice();
    if (remembered && remembered.upc) {
      var idx = -1;
      list.forEach(function (p, i) { if (idx < 0 && p.upc === remembered.upc) idx = i; });
      var mine = idx >= 0 ? list.splice(idx, 1)[0] : Object.assign({}, remembered, { saved: true });
      mine.remembered = true;
      return [mine].concat(stable(list));
    }
    return stable(list);
    function stable(arr) {
      return arr.map(function (p, i) { return { p: p, i: i }; }).sort(function (a, b) {
        var sa = a.p.inStock === false ? 1 : 0, sb = b.p.inStock === false ? 1 : 0;
        return sa - sb || a.i - b.i;
      }).map(function (x) { return x.p; });
    }
  }

  function money(n) { return n == null ? '' : '$' + n.toFixed(2); }

  var api = { searchTerm: searchTerm, includeByDefault: includeByDefault, suggestedQuantity: suggestedQuantity,
    productSummary: productSummary, rankProducts: rankProducts, money: money };
  root.DSBMatching = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
