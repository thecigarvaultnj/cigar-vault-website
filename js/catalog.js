/* ============================================================
   THE CIGAR VAULT — catalog.js
   ============================================================ */

const ITEMS_PER_PAGE = 48;

const state = {
  search: '',
  type: 'all',      // 'all' | 'Single' | 'Box'
  price: 'all',     // 'all' | 'u5' | '5-10' | '10-15' | '15-25' | '25-50' | '50-100' | '100+'
  sort: 'name-az',  // 'name-az' | 'name-za' | 'price-asc' | 'price-desc' | 'stock-asc'
  brand: null,      // null = all brands
  page: 1
};

let allProducts = [];

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

  grid.innerHTML = page.map(([name, brand, price, stock, type]) => {
    const low       = stock <= 3;
    const typeClass = type === 'Single' ? 'single' : 'box';
    const typeLabel = type === 'Single' ? 'Single' : 'Box / Bundle';
    const stockText = low
      ? `<span class="cat-stock low">Only ${stock} left</span>`
      : `<span class="cat-stock">${stock} in stock</span>`;

    return `<article class="cat-card reveal">
  <span class="type-badge ${typeClass}">${typeLabel}</span>
  <p class="cat-brand">${escHtml(brand)}</p>
  <h3 class="cat-name">${escHtml(name)}</h3>
  <p class="cat-price">$${price.toFixed(2)}</p>
  ${stockText}
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

  const brands = Object.keys(counts).sort();
  const list   = document.getElementById('brand-list');

  list.innerHTML = `<li>
    <button class="brand-item${state.brand === null ? ' active' : ''}" data-brand="">
      All Brands <span class="brand-count">${baseFiltered.length}</span>
    </button>
  </li>` + brands.map(b => `<li>
    <button class="brand-item${state.brand === b ? ' active' : ''}" data-brand="${escAttr(b)}">
      ${escHtml(b)} <span class="brand-count">${counts[b]}</span>
    </button>
  </li>`).join('');
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
    const res = await fetch('data/catalog.json');
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    allProducts = await res.json();
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
}

document.addEventListener('DOMContentLoaded', init);
