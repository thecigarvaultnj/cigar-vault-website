/* ============================================================
   THE CIGAR VAULT — cart.js
   Cart + checkout for a static site. Vanilla JS, no deps.
   Loaded on every page: renders the header cart indicator.
   On cart.html / checkout.html it also drives those pages.
   ============================================================ */

(function () {
  'use strict';

  /* ============================================================
     PRICING RULES — edit these to change cart behavior.
     ============================================================ */
  var CART_CONFIG = {
    MINIMUM_ORDER: 50,        // USD — below this, checkout is blocked
    SHIPPING_FLAT: 15,        // USD — flat shipping fee
    FREE_SHIPPING_AT: 150,    // USD — subtotal at/above which shipping is free
    TAX: {
      rate: 0.06625,          // 6.625%
      states: ['NJ']          // 2-letter codes of states where tax applies
    },

    // Online availability — purchasability is DERIVED at render time, never stored:
    //   buyable = shippable && !excludeOnline && stock > 0 &&
    //             (onlineOverride || (stock - STOCK_BUFFER) >= ONLINE_STOCK_THRESHOLD)
    ONLINE_STOCK_THRESHOLD: 10,  // effective stock required to sell online
    STOCK_BUFFER: 1              // held back so a counter sale between syncs can't oversell
  };
  /* ============================================================ */

  var STORAGE_KEY = 'cv-cart';
  var CATALOG_URL = '/data/catalog.json';

  /* ---------- storage (stores only {id, qty}) ---------- */
  function readCart() {
    try {
      var arr = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      if (!Array.isArray(arr)) return [];
      return arr
        .filter(function (l) { return l && typeof l.id === 'string'; })
        .map(function (l) { return { id: l.id, qty: Math.max(1, parseInt(l.qty, 10) || 1) }; });
    } catch (e) { return []; }
  }
  function writeCart(lines) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(lines)); } catch (e) { /* ignore */ }
    updateIndicator();
  }
  function cartCount(lines) {
    return (lines || readCart()).reduce(function (n, l) { return n + l.qty; }, 0);
  }

  /* ---------- helpers ---------- */
  function money(n) { return '$' + (Math.round(n * 100) / 100).toFixed(2); }
  function escHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function monogram(brand, name) {
    var src = String(brand || name || '?').trim();
    var parts = src.split(/\s+/).filter(Boolean);
    var initials = parts.length >= 2 ? (parts[0][0] + parts[1][0]) : src.slice(0, 2);
    return initials.toUpperCase();
  }

  /* ---------- shared renderers (used by cart.html AND checkout.html) ---------- */
  function thumbHTML(p) {
    if (p.image) {
      return '<span class="cv-thumb"><img src="' + escHtml(p.image) + '" alt="' +
        escHtml(p.name) + '" loading="lazy"></span>';
    }
    return '<span class="cv-thumb cv-thumb--mono" aria-hidden="true">' +
      escHtml(monogram(p.brand, p.name)) + '</span>';
  }

  // The single line-item renderer. opts.interactive => stepper + remove.
  function lineItemHTML(p, qty, opts) {
    opts = opts || {};
    var lineTotal = p.price * qty;
    var interactive = !!opts.interactive;
    var controls = interactive
      ? '<div class="cv-qty" role="group" aria-label="Quantity for ' + escHtml(p.name) + '">' +
          '<button type="button" class="cv-qty-btn" data-act="dec" data-id="' + escHtml(p.id) + '" aria-label="Decrease quantity">&minus;</button>' +
          '<span class="cv-qty-val">' + qty + '</span>' +
          '<button type="button" class="cv-qty-btn" data-act="inc" data-id="' + escHtml(p.id) + '" aria-label="Increase quantity">+</button>' +
        '</div>' +
        '<button type="button" class="cv-remove" data-act="remove" data-id="' + escHtml(p.id) + '">Remove</button>'
      : '<span class="cv-line-qtystatic">Qty ' + qty + '</span>';

    return '<div class="cv-line">' +
        thumbHTML(p) +
        '<div class="cv-line-main">' +
          '<p class="cv-line-brand">' + escHtml(p.brand) + '</p>' +
          '<p class="cv-line-name">' + escHtml(p.name) + '</p>' +
          '<p class="cv-line-unit">' + money(p.price) + ' each</p>' +
          controls +
        '</div>' +
        '<div class="cv-line-end">' +
          '<p class="cv-line-total">' + money(lineTotal) + '</p>' +
        '</div>' +
      '</div>';
  }

  /* ---------- totals ---------- */
  function computeTotals(subtotal, state) {
    var meetsMin = subtotal >= CART_CONFIG.MINIMUM_ORDER;
    var shipping = subtotal >= CART_CONFIG.FREE_SHIPPING_AT ? 0 : CART_CONFIG.SHIPPING_FLAT;
    var taxable = !!state && CART_CONFIG.TAX.states.indexOf(state) !== -1;
    var tax = taxable ? Math.round(subtotal * CART_CONFIG.TAX.rate * 100) / 100 : 0;
    return {
      subtotal: subtotal,
      shipping: shipping,
      tax: tax,
      total: subtotal + shipping + tax,
      meetsMin: meetsMin,
      remainingToMin: Math.max(0, CART_CONFIG.MINIMUM_ORDER - subtotal),
      freeShip: shipping === 0 && subtotal > 0
    };
  }

  /* ---------- online availability (derived; never stored) ----------
     Fields default safely when absent: shippable=true, excludeOnline=false,
     onlineOverride=false — so a catalog without these fields sells normally. */
  var CONTACT_PHONE = '(973) 333-7475';
  function availability(p) {
    var shippable = (p.shippable !== false);
    var excludeOnline = (p.excludeOnline === true);
    var onlineOverride = (p.onlineOverride === true);
    var stock = (typeof p.stock === 'number') ? p.stock : 0;
    var inStock = stock > 0;
    var effectiveStock = stock - CART_CONFIG.STOCK_BUFFER;
    var buyable = shippable && !excludeOnline && inStock &&
      (onlineOverride || effectiveStock >= CART_CONFIG.ONLINE_STOCK_THRESHOLD);
    var reason = 'ok', message = null;
    if (!buyable) {
      // Order matters: out-of-stock reads "Sold out" (temporary) before the
      // shipping/call states.
      if (!inStock) { reason = 'sold-out'; message = 'Sold out'; }
      else if (!shippable) { reason = 'not-shippable'; message = 'In store only — cannot be shipped'; }
      else { reason = excludeOnline ? 'excluded' : 'low-stock'; message = 'In store only — call ' + CONTACT_PHONE; }
    }
    return { buyable: buyable, reason: reason, message: message };
  }

  /* ---------- catalog, indexed by id ---------- */
  var _catalog = null;
  function loadCatalog() {
    if (_catalog) return _catalog;
    _catalog = fetch(CATALOG_URL)
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (rows) {
        var map = {}, missing = 0;
        rows.forEach(function (r) {
          var id = r[5];                    // [name, brand, price, stock, type, id, image]
          if (!id) { missing++; return; }
          map[id] = { id: id, name: r[0], brand: r[1], price: r[2], stock: r[3], type: r[4], image: r[6] || null,
            shippable: r[7], excludeOnline: r[8], onlineOverride: r[9] };
        });
        if (missing) console.warn('[cart] ' + missing + ' catalog row(s) missing an id and were skipped. See the slug convention in CLAUDE.md.');
        return map;
      });
    return _catalog;
  }

  /* Validate stored cart against the live catalog. Drops any line whose id is
     gone (or has no usable price) so a stale line never reaches a total.
     Rewrites storage if anything was dropped. */
  function resolveCart(catalog) {
    var lines = readCart(), items = [], kept = [], dropped = 0;
    lines.forEach(function (l) {
      var p = catalog[l.id];
      if (p && typeof p.price === 'number') {
        items.push({ product: p, qty: l.qty });
        kept.push({ id: l.id, qty: l.qty });
      } else {
        dropped++;
      }
    });
    if (dropped) writeCart(kept);   // self-heal storage + indicator
    return { items: items, dropped: dropped };
  }

  /* ---------- mutations (public API for catalog.js) ---------- */
  function addToCart(id, qty) {
    if (!id) return;
    qty = Math.max(1, parseInt(qty, 10) || 1);
    var lines = readCart(), found = false;
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].id === id) { lines[i].qty += qty; found = true; break; }
    }
    if (!found) lines.push({ id: id, qty: qty });
    writeCart(lines);
  }
  function setQty(id, qty) {
    qty = parseInt(qty, 10) || 0;
    var lines = readCart().filter(function (l) {
      if (l.id === id) { l.qty = qty; return qty > 0; }
      return true;
    });
    writeCart(lines);
  }
  function removeFromCart(id) {
    writeCart(readCart().filter(function (l) { return l.id !== id; }));
  }

  /* ---------- header indicator (every page) ---------- */
  function updateIndicator() {
    var el = document.getElementById('nav-cart-count');
    if (!el) return;
    var n = cartCount();
    el.textContent = n;
    el.hidden = n === 0;
  }

  /* ---------- cart page ---------- */
  function initCartPage() {
    var listEl = document.getElementById('cart-items');
    var emptyEl = document.getElementById('cart-empty');
    var summaryEl = document.getElementById('cart-summary');
    var noticeEl = document.getElementById('cart-notice');

    function paint(catalog) {
      var resolved = resolveCart(catalog);
      var items = resolved.items;

      if (noticeEl) {
        if (resolved.dropped) {
          noticeEl.textContent = (resolved.dropped === 1
            ? 'One item was'
            : resolved.dropped + ' items were') + ' removed from your cart because it is no longer available.';
          noticeEl.hidden = false;
        } else { noticeEl.hidden = true; }
      }

      if (!items.length) {
        listEl.innerHTML = '';
        if (emptyEl) emptyEl.hidden = false;
        if (summaryEl) summaryEl.hidden = true;
        return;
      }
      if (emptyEl) emptyEl.hidden = true;
      if (summaryEl) summaryEl.hidden = false;

      listEl.innerHTML = items.map(function (it) {
        return lineItemHTML(it.product, it.qty, { interactive: true });
      }).join('');

      var subtotal = items.reduce(function (s, it) { return s + it.product.price * it.qty; }, 0);
      var t = computeTotals(subtotal, null);
      document.getElementById('cart-subtotal').textContent = money(subtotal);

      var minMsg = document.getElementById('cart-min-msg');
      var proceed = document.getElementById('cart-proceed');
      if (t.meetsMin) {
        if (minMsg) minMsg.hidden = true;
        if (proceed) { proceed.removeAttribute('aria-disabled'); proceed.classList.remove('is-disabled'); }
      } else {
        if (minMsg) {
          minMsg.hidden = false;
          minMsg.textContent = 'Add ' + money(t.remainingToMin) + ' more to reach the ' +
            money(CART_CONFIG.MINIMUM_ORDER) + ' minimum order.';
        }
        if (proceed) { proceed.setAttribute('aria-disabled', 'true'); proceed.classList.add('is-disabled'); }
      }
    }

    loadCatalog().then(paint).catch(function () {
      listEl.innerHTML = '<p class="cv-error">Couldn’t load your cart. Please refresh the page.</p>';
    });

    listEl.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var id = btn.getAttribute('data-id'), act = btn.getAttribute('data-act');
      var line = readCart().filter(function (l) { return l.id === id; })[0];
      var cur = line ? line.qty : 0;
      if (act === 'inc') setQty(id, cur + 1);
      else if (act === 'dec') setQty(id, cur - 1);
      else if (act === 'remove') removeFromCart(id);
      loadCatalog().then(paint);
    });

    var proceed = document.getElementById('cart-proceed');
    if (proceed) proceed.addEventListener('click', function (e) {
      if (proceed.getAttribute('aria-disabled') === 'true') e.preventDefault();
    });
  }

  /* ---------- checkout page ---------- */
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var ZIP_RE = /^\d{5}$/;

  function initCheckoutPage() {
    var form = document.getElementById('checkout-form');
    var itemsEl = document.getElementById('checkout-items');
    var stateSel = document.getElementById('cx-state');
    var noticeEl = document.getElementById('checkout-notice');

    var items = [], subtotal = 0;

    function paintSummary() {
      itemsEl.innerHTML = items.length
        ? items.map(function (it) { return lineItemHTML(it.product, it.qty, { interactive: false }); }).join('')
        : '<p class="cv-line-empty">Your cart is empty. <a href="/catalog">Browse the catalog</a>.</p>';
      var t = computeTotals(subtotal, stateSel ? stateSel.value : '');
      document.getElementById('cx-subtotal').textContent = money(t.subtotal);
      document.getElementById('cx-shipping').textContent = t.freeShip ? 'Free' : money(t.shipping);
      document.getElementById('cx-tax').textContent = money(t.tax);
      document.getElementById('cx-total').textContent = money(t.total);

      var block = document.getElementById('cx-min-block');
      if (block) {
        if (!items.length) {
          block.hidden = false; block.textContent = 'Your cart is empty.';
        } else if (!t.meetsMin) {
          block.hidden = false;
          block.textContent = 'Your order is below the ' + money(CART_CONFIG.MINIMUM_ORDER) +
            ' minimum. Add ' + money(t.remainingToMin) + ' more to check out.';
        } else { block.hidden = true; }
      }
    }

    loadCatalog().then(function (catalog) {
      var resolved = resolveCart(catalog);
      items = resolved.items;
      subtotal = items.reduce(function (s, it) { return s + it.product.price * it.qty; }, 0);
      if (noticeEl && resolved.dropped) {
        noticeEl.textContent = (resolved.dropped === 1
          ? 'One item was'
          : resolved.dropped + ' items were') + ' removed from your order because it is no longer available.';
        noticeEl.hidden = false;
      }
      paintSummary();
    }).catch(function () {
      itemsEl.innerHTML = '<p class="cv-error">Couldn’t load your order. Please refresh the page.</p>';
    });

    if (stateSel) stateSel.addEventListener('change', paintSummary);

    /* ---- validation ---- */
    function setError(field, msg) {
      var group = field.closest('.form-group') || field.closest('.cx-sig') || field.parentNode;
      var err = group.querySelector('.cv-field-error');
      if (msg) {
        field.setAttribute('aria-invalid', 'true');
        if (!err) { err = document.createElement('p'); err.className = 'cv-field-error'; group.appendChild(err); }
        err.textContent = msg;
      } else {
        field.removeAttribute('aria-invalid');
        if (err) err.parentNode.removeChild(err);
      }
    }

    function validateField(field) {
      if (field.type === 'checkbox') {
        if (field.hasAttribute('required') && !field.checked) { setError(field, 'Please acknowledge to continue.'); return false; }
        setError(field, ''); return true;
      }
      var v = (field.value || '').trim();
      if (field.hasAttribute('required') && !v) { setError(field, 'This field is required.'); return false; }
      if (field.id === 'cx-email' && v && !EMAIL_RE.test(v)) { setError(field, 'Enter a valid email address.'); return false; }
      if (field.id === 'cx-zip' && v && !ZIP_RE.test(v)) { setError(field, 'Enter a 5-digit ZIP code.'); return false; }
      setError(field, ''); return true;
    }

    var fields = form.querySelectorAll('input, select');
    fields.forEach(function (f) {
      f.addEventListener('blur', function () { validateField(f); });
      f.addEventListener('input', function () { if (f.getAttribute('aria-invalid')) validateField(f); });
      if (f.type === 'checkbox') f.addEventListener('change', function () { validateField(f); });
    });

    // "Review Order" (or Enter) validates every field at once.
    form.addEventListener('submit', function (e) {
      e.preventDefault();   // phase one: orders are placed by phone, nothing submits
      var reviewMsg = document.getElementById('cx-review-msg');
      var payNote = document.getElementById('cx-pay-note');
      var payPanel = document.getElementById('cx-payment');

      var ok = true;
      form.querySelectorAll('[required]').forEach(function (f) { if (!validateField(f)) ok = false; });
      var t = computeTotals(subtotal, stateSel ? stateSel.value : '');
      var belowMin = !t.meetsMin;
      if (belowMin) ok = false;
      paintSummary();

      if (!ok) {
        if (payNote) payNote.hidden = true;
        if (payPanel) payPanel.classList.remove('cx-payment--ready');
        if (reviewMsg) {
          reviewMsg.hidden = false;
          reviewMsg.className = 'cx-review-msg cx-review-msg--error';
          var invalid = form.querySelectorAll('[aria-invalid="true"]').length;
          reviewMsg.textContent = (invalid === 0 && belowMin)
            ? 'Your order is below the ' + money(CART_CONFIG.MINIMUM_ORDER) + ' minimum — add more before checking out.'
            : 'Please fix the highlighted fields before continuing.';
        }
        var first = form.querySelector('[aria-invalid="true"]');
        if (first) first.scrollIntoView({ behavior: 'smooth', block: 'center' });
        else if (belowMin) {
          var block = document.getElementById('cx-min-block');
          if (block) block.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
        return;
      }

      // Everything valid — make clear ordering is by phone right now, go to payment.
      if (reviewMsg) reviewMsg.hidden = true;
      if (payNote) {
        payNote.hidden = false;
        payNote.textContent = 'Your details look good. Card checkout is being activated — to place this order now, call (973) 333-7475.';
      }
      if (payPanel) {
        payPanel.classList.add('cx-payment--ready');
        payPanel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  /* ---------- boot ---------- */
  function boot() {
    updateIndicator();
    if (document.getElementById('cart-items')) initCartPage();
    if (document.getElementById('checkout-form')) initCheckoutPage();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();

  // keep the indicator in sync across tabs
  window.addEventListener('storage', function (e) { if (e.key === STORAGE_KEY) updateIndicator(); });

  // minimal API for catalog.js
  window.CVCart = { add: addToCart, remove: removeFromCart, setQty: setQty, count: cartCount, availability: availability, config: CART_CONFIG };
}());
