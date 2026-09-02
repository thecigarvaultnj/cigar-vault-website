/* ============================================================
   THE CIGAR VAULT — catalog.js
   ============================================================ */

const ITEMS_PER_PAGE = 48;

const state = {
  search: '',
  type: 'all',       // 'all' | 'Single' | 'Box'
  price: 'all',
  sort: 'featured',  // default: buyable-first, then stock desc
  brand: null,       // null = all brands
  brandsExpanded: false,
  page: 1
};

const TOP_BRANDS = 15;

let allProducts = [];
let brandLogos = {};   // { "Brand Name": "slug.png" } for brands with a processed logo

/* ---- Availability + monogram helpers ---- */
function productBuyable(r) {
  if (window.CVCart && window.CVCart.availability) {
    return window.CVCart.availability({ stock: r[3], shippable: r[7], excludeOnline: r[8], onlineOverride: r[9] }).buyable;
  }
  return r[3] > 0;
}
function monogram(brand, name) {
  const src = String(brand || name || '?').trim();
  const parts = src.split(/\s+/).filter(Boolean);
  const ini = parts.length >= 2 ? (parts[0][0] + parts[1][0]) : src.slice(0, 2);
  return ini.toUpperCase();
}

/* Thumbnail fallback: real photo -> line logo -> brand logo -> monogram.
   'photo' renders edge to edge (contain, no plate) and covers both real
   product photos and plate:false line art. 'logo' sits on the cream plate.
   Line rules are ordered most-specific first; all match terms must appear
   in the product name. This generalizes to any brand with distinct lines. */
function resolveThumb(brand, name, image) {
  if (image) return { kind: 'photo', src: image };
  const lines = brandLogos.lines && brandLogos.lines[brand];
  if (lines) {
    const nl = String(name).toLowerCase();
    for (const rule of lines) {
      const terms = Array.isArray(rule.match) ? rule.match : [rule.match];
      if (terms.every(t => nl.includes(String(t).toLowerCase()))) {
        const src = 'assets/brands/processed/' + rule.logo;
        return { kind: rule.plate === false ? 'photo' : 'logo', src };
      }
    }
  }
  const bl = brandLogos.brands && brandLogos.brands[brand];
  if (bl) return { kind: 'logo', src: 'assets/brands/processed/' + bl };
  return { kind: 'mono' };
}

/* ---- Price filter helper ---- */
function priceInRange(price, range) {
  if (range === 'all') return true;
  if (range === 'u5')    return price < 5;
  if (range === '5-10')  return price >= 5  && price < 10;
  if (range === '10-15') return price >= 10 && price < 15;
  if (range === '15-25') return price >= 15 && price < 25;
  if (range === '25-50') return price >= 25 && price < 50;
  if (range === '50-100')return price >= 50 && price < 100;
  if (range === '100+')  return price >= 100;
  return true;
}

/* ---- Filter + sort ---- */
function filterProducts(products, st) {
  const q = st.search.trim().toLowerCase();

  let result = products.filter(([name, brand, price, stock, type]) => {
    if (q && !name.toLowerCase().includes(q) && !brand.toLowerCase().includes(q)) return false;
    if (st.type !== 'all' && type !== st.type) return false;
    if (!priceInRange(price, st.price)) return false;
    if (st.brand && brand !== st.brand) return false;
    return true;
  });

  result.sort((a, b) => {
    switch (st.sort) {
      case 'featured': {  // buyable first, then stock high→low
        const ba = productBuyable(a), bb = productBuyable(b);
        if (ba !== bb) return ba ? -1 : 1;
        return b[3] - a[3];
      }
      case 'name-az':    return a[0].localeCompare(b[0]);
      case 'name-za':    return b[0].localeCompare(a[0]);
      case 'brand-az':   return a[1].localeCompare(b[1]) || a[0].localeCompare(b[0]);
      case 'price-asc':  return a[2] - b[2];
      case 'price-desc': return b[2] - a[2];
      case 'stock-asc':  return a[3] - b[3];
      case 'stock-desc': return b[3] - a[3];
      default:           return 0;
    }
  });

  return result;
}

/* ---- Render product grid ---- */
function renderGrid(items) {
  const grid = document.getElementById('product-grid');
  if (!items.length) {
    grid.innerHTML = '<p class="no-results">No products match your filters. Try broadening your search.</p>';
    return;
  }

  const start = (state.page - 1) * ITEMS_PER_PAGE;
  const page  = items.slice(start, start + ITEMS_PER_PAGE);

  grid.innerHTML = page.map(([name, brand, price, stock, type, id, image, shippable, excludeOnline, onlineOverride]) => {
    // Low-stock warning only (no plain "N in stock" line); nothing at 0 (the control says "Sold out").
    const stockText = (stock > 0 && stock <= 3)
      ? `<span class="cat-stock low">Only ${stock} left</span>`
      : '';

    // Badge only for multi-packs (Single is the default → no badge).
    let badge = '';
    if (type !== 'Single') {
      const label = /\bpack\b/i.test(name) ? 'Pack' : (/\bbundle\b/i.test(name) ? 'Bundle' : 'Box');
      badge = `<span class="type-badge">${label}</span>`;
    }

    // Fallback: real photo -> line logo -> brand logo -> monogram (see resolveThumb).
    // 'photo' fills the thumb (contain, no plate); the cream plate is logo-only.
    const t = resolveThumb(brand, name, image);
    let thumb;
    if (t.kind === 'photo') {
      thumb = `<span class="cat-thumb"><img src="${escAttr(t.src)}" alt="${escAttr(image ? name : '')}" loading="lazy"></span>`;
    } else if (t.kind === 'logo') {
      thumb = `<span class="cat-thumb cat-thumb--logo" aria-hidden="true"><span class="cat-plate"><img src="${escAttr(t.src)}" alt="" loading="lazy"></span></span>`;
    } else {
      thumb = `<span class="cat-thumb cat-thumb--mono" aria-hidden="true">${escHtml(monogram(brand, name))}</span>`;
    }

    // Null price -> no buy control. Otherwise purchasability is DERIVED at render time.
    const priceText = (price == null) ? '' : `<p class="cat-price">$${price.toFixed(2)}</p>`;
    let control = '';
    if (price != null) {
      const avail = (window.CVCart && window.CVCart.availability)
        ? window.CVCart.availability({ stock, shippable, excludeOnline, onlineOverride })
        : { buyable: true };
      if (avail.buyable) {
        control = `<button class="cat-add" type="button" data-add-id="${escAttr(id)}">Add to Cart</button>`;
      } else {
        const cls = avail.reason === 'sold-out' ? 'cat-soldout' : 'cat-instore';
        control = `<p class="${cls}">${escHtml(avail.message)}</p>`;
      }
    }

    return `<article class="cat-card reveal" data-id="${escAttr(id)}">
  <div class="cat-thumb-wrap">${thumb}${badge}</div>
  <div class="cat-body">
    <p class="cat-brand">${escHtml(brand)}</p>
    <h3 class="cat-name">${escHtml(name)}</h3>
    ${priceText}
    ${stockText}
    ${control}
  </div>
</article>`;
  }).join('');

  // Re-run scroll reveal on newly created cards
  grid.querySelectorAll('.reveal').forEach(el => {
    if (typeof revealObserver !== 'undefined') revealObserver.observe(el);
    else el.classList.add('visible');
  });
}

/* ---- Render brand sidebar ---- */
function renderBrands(products, filtered) {
  // Count occurrences per brand in the fully-filtered set (ignoring brand filter itself)
  const stateNoBrand = Object.assign({}, state, { brand: null, page: 1 });
  const baseFiltered = filterProducts(products, stateNoBrand);

  const counts = {};
  baseFiltered.forEach(([, brand]) => {
    counts[brand] = (counts[brand] || 0) + 1;
  });

  // Top brands by product count (tie-break alphabetical).
  const allBrands = Object.keys(counts).sort((a, b) => counts[b] - counts[a] || a.localeCompare(b));
  const list = document.getElementById('brand-list');

  let shown = state.brandsExpanded ? allBrands : allBrands.slice(0, TOP_BRANDS);
  // Keep the selected brand visible even if it's outside the top 15.
  if (!state.brandsExpanded && state.brand && shown.indexOf(state.brand) === -1 && allBrands.indexOf(state.brand) !== -1) {
    shown = shown.concat([state.brand]);
  }

  const item = (val, label, count, active) =>
    `<li><button class="brand-item${active ? ' active' : ''}" data-brand="${escAttr(val)}">${escHtml(label)} <span class="brand-count">${count}</span></button></li>`;

  let html = item('', 'All Brands', baseFiltered.length, state.brand === null);
  html += shown.map(b => item(b, b, counts[b], state.brand === b)).join('');
  if (allBrands.length > TOP_BRANDS) {
    html += `<li><button class="brand-toggle" data-brand-toggle="1">${
      state.brandsExpanded ? 'Show fewer' : `Show all brands (${allBrands.length})`
    }</button></li>`;
  }
  list.innerHTML = html;
}

/* ---- Render pagination ---- */
function renderPagination(total, page) {
  const totalPages = Math.ceil(total / ITEMS_PER_PAGE);
  const nav = document.getElementById('pagination');
  if (totalPages <= 1) { nav.innerHTML = ''; return; }

  const btns = [];

  // Prev
  btns.push(`<button class="page-btn" data-page="${page - 1}" ${page === 1 ? 'disabled' : ''}>&lsaquo; Prev</button>`);

  // Page numbers: always show first, last, and a window around current
  const window = 2;
  let shown = new Set();
  [1, totalPages].forEach(n => shown.add(n));
  for (let n = Math.max(1, page - window); n <= Math.min(totalPages, page + window); n++) shown.add(n);

  let prev = 0;
  [...shown].sort((a, b) => a - b).forEach(n => {
    if (prev && n - prev > 1) btns.push('<span class="page-ellipsis">&hellip;</span>');
    btns.push(`<button class="page-btn${n === page ? ' active' : ''}" data-page="${n}">${n}</button>`);
    prev = n;
  });

  // Next
  btns.push(`<button class="page-btn" data-page="${page + 1}" ${page === totalPages ? 'disabled' : ''}>Next &rsaquo;</button>`);

  nav.innerHTML = btns.join('');
}

/* ---- Update results count ---- */
function updateCount(total) {
  const el = document.getElementById('results-count');
  if (el) el.textContent = `${total} product${total !== 1 ? 's' : ''}`;
}

/* ---- Full render cycle ---- */
function render() {
  const filtered = filterProducts(allProducts, state);
  renderGrid(filtered);
  renderBrands(allProducts, filtered);
  renderPagination(filtered.length, state.page);
  updateCount(filtered.length);
}

/* ---- Escape helpers ---- */
function escHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
function escAttr(str) { return escHtml(str); }

/* ---- Init ---- */
async function init() {
  const grid = document.getElementById('product-grid');
  grid.innerHTML = '<p class="loading-msg">Loading catalog\u2026</p>';

  try {
    const [catRes, logoRes] = await Promise.all([
      fetch('data/catalog.json'),
      fetch('data/brand-logos.json').catch(() => null)   // optional — falls back to monogram if absent
    ]);
    if (!catRes.ok) throw new Error(`HTTP ${catRes.status}`);
    allProducts = await catRes.json();
    if (logoRes && logoRes.ok) {
      try { brandLogos = await logoRes.json(); } catch (_) { brandLogos = {}; }
    }

    // Load-time guard: every row needs a stable id (index 5) for the cart.
    const missingId = allProducts.filter(r => !r[5]).length;
    if (missingId) console.warn(`[catalog] ${missingId} product row(s) missing an id. Assign a brand+name slug — see CLAUDE.md.`);
  } catch (err) {
    grid.innerHTML = '<p class="no-results">Failed to load catalog. Please refresh the page.</p>';
    console.error('Catalog load error:', err);
    return;
  }

  render();
  wireEvents();
}

/* ---- Event wiring ---- */
function wireEvents() {
  /* Search */
  const searchEl = document.getElementById('catalog-search');
  if (searchEl) {
    searchEl.addEventListener('input', () => {
      state.search = searchEl.value;
      state.page = 1;
      render();
    });
  }

  /* Type tabs */
  document.querySelectorAll('.type-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.type-tab').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      state.type = btn.dataset.type;
      state.page = 1;
      render();
    });
  });

  /* Price filter */
  const priceEl = document.getElementById('price-filter');
  if (priceEl) {
    priceEl.addEventListener('change', () => {
      state.price = priceEl.value;
      state.page = 1;
      render();
    });
  }

  /* Sort */
  const sortEl = document.getElementById('sort-select');
  if (sortEl) {
    sortEl.addEventListener('change', () => {
      state.sort = sortEl.value;
      state.page = 1;
      render();
    });
  }

  /* Brand sidebar (event delegation) */
  const brandList = document.getElementById('brand-list');
  if (brandList) {
    brandList.addEventListener('click', e => {
      const toggle = e.target.closest('.brand-toggle');
      if (toggle) { state.brandsExpanded = !state.brandsExpanded; render(); return; }
      const btn = e.target.closest('.brand-item');
      if (!btn) return;
      state.brand = btn.dataset.brand || null;
      state.page = 1;
      render();
    });
  }

  /* Pagination (event delegation) */
  const paginationEl = document.getElementById('pagination');
  if (paginationEl) {
    paginationEl.addEventListener('click', e => {
      const btn = e.target.closest('.page-btn');
      if (!btn || btn.disabled) return;
      const p = parseInt(btn.dataset.page, 10);
      if (!isNaN(p)) {
        state.page = p;
        render();
        document.querySelector('.catalog-controls')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });
  }

  /* Add to cart (event delegation — survives grid re-renders) */
  const gridEl = document.getElementById('product-grid');
  if (gridEl) {
    gridEl.addEventListener('click', e => {
      const btn = e.target.closest('.cat-add');
      if (!btn || btn.disabled) return;
      const id = btn.dataset.addId;
      if (!id || !window.CVCart) return;
      window.CVCart.add(id, 1);
      if (btn.dataset.busy) return;
      btn.dataset.busy = '1';
      const prev = btn.textContent;
      btn.textContent = 'Added ✓';
      btn.classList.add('added');
      setTimeout(() => { btn.textContent = prev; btn.classList.remove('added'); delete btn.dataset.busy; }, 1100);
    });
  }
}

document.addEventListener('DOMContentLoaded', init);
