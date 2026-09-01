#!/usr/bin/env node
/* ============================================================
   THE CIGAR VAULT — inventory sync
   Merges a weekly Thrive "Sell-Through" export into data/catalog.json.

   Usage:
     node scripts/sync-inventory.js <export.csv> [options]
   Options:
     --write                 Actually write catalog.json (default: DRY RUN)
     --exclude <file.csv>    CSV of products to force excludeOnline = true
     --override <file.csv>   CSV of products to force onlineOverride = true
     --report <file>         Where to write unmatched lists
                             (default: data/sync-unmatched.txt)

   catalog.json row shape (positional):
     [name, brand, price, stock, type, id, image,
      shippable, excludeOnline, onlineOverride]
   The last three are manual availability fields; the sync NEVER
   overwrites a value that already exists — it only fills in defaults
   for products that have never been initialized.
   ============================================================ */

'use strict';
const fs = require('fs');
const path = require('path');

/* ============================================================
   CONFIG — the knobs you are likely to change
   ============================================================ */
const CONFIG = {
  ENCODING: 'latin1',                     // export is Latin-1, NOT UTF-8
  JUNK_LINES: 3,                          // title, timestamp, blank -> header is line 4
  LOCATION_EXPECTED: 'Frisky Cigars Outlet',
  COLUMNS: ['Product', 'Variant', 'Location', 'List Price', 'Cost/unit',
    'In Stock', 'Net Sold', 'Sell-Through', 'Net Product Sales', 'Net Profit', 'Net Margin'],

  // HAZMAT: names containing any of these (case-insensitive substring) cannot ship.
  // Cutters are intentionally NOT here. Substring matching over-catches on purpose;
  // everything it flags is logged so you can veto false positives.
  HAZMAT_KEYWORDS: ['lighter', 'butane', 'torch', 'fuel', 'refill'],
  // Known false positives — cigars whose NAME contains a keyword but that ship fine.
  // Listed by exact product name (case-insensitive). Add to this to spare a product.
  HAZMAT_EXCEPTIONS: [
    'Lunatic Torch Nicaragua',
    'H Upmann 9 Cigar Collab Sampler With Torch',
  ],

  // Availability field indexes + manual fields the sync must preserve.
  IDX: { name: 0, brand: 1, price: 2, stock: 3, type: 4, id: 5, image: 6,
         shippable: 7, excludeOnline: 8, onlineOverride: 9 },
  MANUAL_FIELDS: ['shippable', 'excludeOnline', 'onlineOverride'],

  DEFAULT_REPORT: 'data/sync-unmatched.txt',
};

/* ---------------- helpers ---------------- */
function norm(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }
const _hazExcept = new Set(CONFIG.HAZMAT_EXCEPTIONS.map(s => norm(s)));
function isHazmat(name) {
  if (_hazExcept.has(norm(name))) return false;
  const n = String(name || '').toLowerCase();
  return CONFIG.HAZMAT_KEYWORDS.some(k => n.includes(k));
}
function parsePrice(v) {
  if (v == null) return null;
  const cleaned = String(v).replace(/[^0-9.\-]/g, '');   // strip $, commas, spaces
  if (cleaned === '' || cleaned === '-') return null;
  const n = parseFloat(cleaned);
  return isNaN(n) ? null : n;
}
// Returns { value, blank, negative }
function parseStock(v) {
  const raw = v == null ? '' : String(v).trim();
  if (raw === '') return { value: 0, blank: true, negative: false };
  const cleaned = raw.replace(/[^0-9.\-]/g, '');
  const n = parseInt(cleaned, 10);
  if (isNaN(n)) return { value: 0, blank: true, negative: false };
  if (n < 0) return { value: 0, blank: false, negative: true };
  return { value: n, blank: false, negative: false };
}

// Minimal RFC-4180-ish CSV line parser (handles quotes + embedded commas).
function parseCsvLine(line) {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQ) {
      if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQ = false; }
      else cur += c;
    } else {
      if (c === '"') inQ = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function readExport(file) {
  const text = fs.readFileSync(file, CONFIG.ENCODING);
  const lines = text.split(/\r\n|\n|\r/);
  const headerIdx = CONFIG.JUNK_LINES;                 // 0-based; line 4 == index 3
  const header = parseCsvLine(lines[headerIdx] || '');
  const col = {};
  CONFIG.COLUMNS.forEach(name => { col[name] = header.indexOf(name); });
  const missing = CONFIG.COLUMNS.filter(c => col[c] === -1);
  const rows = [];
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line == null || line.trim() === '') continue;
    const cells = parseCsvLine(line);
    rows.push({
      product: cells[col['Product']] || '',
      location: cells[col['Location']] || '',
      listPrice: cells[col['List Price']],
      inStock: cells[col['In Stock']],
      _raw: line,
    });
  }
  return { header, col, missing, rows };
}

function readFlagCsv(file) {
  // header must have a "product" or "id" column; returns list of {product,id}
  const text = fs.readFileSync(file, 'utf8');
  const lines = text.split(/\r\n|\n|\r/).filter(l => l.trim() !== '');
  if (!lines.length) return [];
  const header = parseCsvLine(lines[0]).map(h => h.toLowerCase());
  const pIdx = header.indexOf('product');
  const iIdx = header.indexOf('id');
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    out.push({ product: pIdx >= 0 ? cells[pIdx] : '', id: iIdx >= 0 ? cells[iIdx] : '' });
  }
  return out;
}

/* ---------------- main ---------------- */
function main() {
  const args = process.argv.slice(2);
  const exportFile = args.find(a => !a.startsWith('--'));
  const write = args.includes('--write');
  const getOpt = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : null; };
  const excludeFile = getOpt('--exclude');
  const overrideFile = getOpt('--override');
  const reportFile = getOpt('--report') || CONFIG.DEFAULT_REPORT;

  if (!exportFile) {
    console.error('Usage: node scripts/sync-inventory.js <export.csv> [--write] [--exclude f.csv] [--override f.csv]');
    process.exit(1);
  }

  const catalogPath = path.join(__dirname, '..', 'data', 'catalog.json');
  const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
  const I = CONFIG.IDX;

  const line = '─'.repeat(64);
  console.log(line);
  console.log(`INVENTORY SYNC   ${write ? '*** WRITE MODE ***' : 'DRY RUN (no files written except the report)'}`);
  console.log(`export:  ${exportFile}`);
  console.log(`catalog: data/catalog.json  (${catalog.length} products)`);
  console.log(line);

  /* ---- read export ---- */
  const exp = readExport(exportFile);
  if (exp.missing.length) {
    console.log(`⚠ header missing expected column(s): ${exp.missing.join(', ')}`);
  }
  console.log(`export rows read: ${exp.rows.length}`);

  /* ---- build name -> index map ---- */
  const byName = {};
  catalog.forEach((r, i) => { byName[norm(r[I.name])] = i; });

  /* ---- 1) availability init + hazmat (only fills UNDEFINED; never overwrites) ---- */
  const hazmatFlagged = [];
  let initialized = 0;
  catalog.forEach(r => {
    const name = r[I.name];
    if (r[I.shippable] === undefined) {
      const haz = isHazmat(name);
      r[I.shippable] = !haz;
      if (haz) hazmatFlagged.push(name);
      initialized++;
    }
    if (r[I.excludeOnline] === undefined) r[I.excludeOnline] = false;
    if (r[I.onlineOverride] === undefined) r[I.onlineOverride] = false;
  });

  /* ---- 2) merge export -> catalog (price + stock only) ---- */
  const matched = new Set();
  const unmatchedExport = [];
  const blankStock = [];
  const negativeStock = [];
  let priceUpdates = 0, stockUpdates = 0;

  exp.rows.forEach(row => {
    const idx = byName[norm(row.product)];
    if (idx === undefined) { unmatchedExport.push(row.product); return; }
    matched.add(idx);
    const r = catalog[idx];

    const price = parsePrice(row.listPrice);
    if (price !== null && price !== r[I.price]) { r[I.price] = price; priceUpdates++; }

    const st = parseStock(row.inStock);
    if (st.blank) blankStock.push(r[I.name]);
    if (st.negative) negativeStock.push({ name: r[I.name], raw: row.inStock });
    if (r[I.stock] !== st.value) { r[I.stock] = st.value; stockUpdates++; }
  });

  const unmatchedCatalog = [];
  catalog.forEach((r, i) => { if (!matched.has(i)) unmatchedCatalog.push(r[I.name]); });

  /* ---- 3) optional manual flag CSVs ---- */
  function applyFlag(file, fieldIdx, label) {
    if (!file) return;
    const list = readFlagCsv(file);
    let hit = 0; const miss = [];
    list.forEach(({ product, id }) => {
      let idx;
      if (id) idx = catalog.findIndex(r => r[I.id] === id);
      if ((idx === undefined || idx < 0) && product) idx = byName[norm(product)];
      if (idx === undefined || idx < 0) { miss.push(product || id); return; }
      catalog[idx][fieldIdx] = true; hit++;
    });
    console.log(`\n${label}: ${hit} set, ${miss.length} unmatched${miss.length ? ' -> ' + miss.slice(0, 5).join('; ') + (miss.length > 5 ? ' …' : '') : ''}`);
  }
  applyFlag(excludeFile, I.excludeOnline, 'excludeOnline CSV');
  applyFlag(overrideFile, I.onlineOverride, 'onlineOverride CSV');

  /* ---- report ---- */
  console.log('\n' + line);
  console.log('RESULTS');
  console.log(line);
  console.log(`matched (export ↔ catalog): ${matched.size}`);
  console.log(`  price updates:            ${priceUpdates}`);
  console.log(`  stock updates:            ${stockUpdates}`);
  console.log(`export rows with NO catalog match: ${unmatchedExport.length}`);
  console.log(`catalog products the export never mentioned: ${unmatchedCatalog.length}`);
  console.log(`\nblank stock (set to 0 — UNCOUNTED, not necessarily sold out): ${blankStock.length}`);
  blankStock.slice(0, 10).forEach(n => console.log(`    · ${n}`));
  if (blankStock.length > 10) console.log(`    …and ${blankStock.length - 10} more (see report file)`);

  if (negativeStock.length) {
    console.log(`\n🚩 NEGATIVE STOCK (DATA ERROR — set to 0): ${negativeStock.length}`);
    negativeStock.slice(0, 30).forEach(n => console.log(`    · ${n.name}  (was ${n.raw})`));
    if (negativeStock.length > 30) console.log(`    …and ${negativeStock.length - 30} more (see report file)`);
  } else {
    console.log(`\nnegative stock in export: 0`);
  }

  console.log(`\nHAZMAT — newly flagged shippable:false: ${hazmatFlagged.length}`);
  hazmatFlagged.forEach(n => console.log(`    · ${n}   ← verify this is really a lighter/butane item, not a cigar`));
  console.log(`availability fields initialized on: ${initialized} product(s)`);

  /* ---- write unmatched report (always — it's a report, not a mutation) ---- */
  const reportLines = [];
  reportLines.push('# Inventory sync — unmatched report');
  reportLines.push(`# ${new Date().toISOString()}   export: ${exportFile}`);
  reportLines.push('');
  reportLines.push(`## Export rows with NO catalog match (${unmatchedExport.length})`);
  reportLines.push(...unmatchedExport);
  reportLines.push('');
  reportLines.push(`## Catalog products the export never mentioned (${unmatchedCatalog.length})`);
  reportLines.push(...unmatchedCatalog);
  reportLines.push('');
  reportLines.push(`## Blank stock — set to 0, UNCOUNTED (${blankStock.length})`);
  reportLines.push(...blankStock);
  reportLines.push('');
  reportLines.push(`## Negative stock — set to 0, DATA ERROR (${negativeStock.length})`);
  reportLines.push(...negativeStock.map(n => `${n.name}\t(was ${n.raw})`));
  reportLines.push('');
  reportLines.push(`## Hazmat newly flagged shippable:false (${hazmatFlagged.length})`);
  reportLines.push(...hazmatFlagged);
  fs.writeFileSync(reportFile, reportLines.join('\n'), 'utf8');
  console.log(`\nunmatched lists written to: ${reportFile}`);

  /* ---- write catalog (only with --write) ---- */
  console.log('\n' + line);
  if (write) {
    fs.writeFileSync(catalogPath, JSON.stringify(catalog), 'utf8');
    console.log('✔ catalog.json WRITTEN.');
  } else {
    console.log('DRY RUN — catalog.json was NOT modified. Re-run with --write to apply.');
  }
  console.log(line);
}

main();
