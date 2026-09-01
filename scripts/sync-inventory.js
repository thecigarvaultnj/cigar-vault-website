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

  // --add-new: line items that must never become catalog products.
  NON_PRODUCT_KEYWORDS: ['gift card', 'store credit', 'deposit', 'adjustment',
    'write-off', 'writeoff', 'write off', 'damage', 'store use', 'testing'],

  DEFAULT_REPORT: 'data/sync-unmatched.txt',
  REVIEW_FILE: 'new-products-review.csv',      // repo root; gitignored
  SKIPPED_FILE: 'new-products-skipped.csv',    // repo root; gitignored
};

/* ---------------- helpers ---------------- */
// Normalize for matching: fold accents (é→e, ó→o, ñ→n) so an encoding
// difference on either side can never cause a silent miss, then lowercase +
// collapse whitespace. NOTE: the Thrive export is decoded as Latin-1 (see
// readExport); the manual CSVs are decoded as UTF-8 (see readFlagCsv).
function norm(s) {
  return String(s == null ? '' : s)
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/\s+/g, ' ').trim();
}
const _hazExcept = new Set(CONFIG.HAZMAT_EXCEPTIONS.map(s => norm(s)));
function isHazmat(name) {
  if (_hazExcept.has(norm(name))) return false;
  const n = String(name || '').toLowerCase();
  return CONFIG.HAZMAT_KEYWORDS.some(k => n.includes(k));
}
// Stable id per the CLAUDE.md convention (slug of brand + ' ' + name), frozen once assigned.
function slug(s) {
  return String(s).toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
// Suggest a brand by longest match against existing brand labels found as a
// normalized substring of the name. Never assigns — just a suggestion you edit.
function makeBrandSuggester(catalog, I) {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const brands = [...new Set(catalog.map(r => r[I.brand]).filter(Boolean))]
    .map(b => ({ brand: b, n: norm(b) })).filter(x => x.n)
    .map(x => ({ brand: x.brand, re: new RegExp('\\b' + esc(x.n) + '\\b'), len: x.n.length }))
    .sort((a, b) => b.len - a.len);   // longest match wins
  return name => {
    const nn = norm(name);
    // Match on word boundaries so e.g. brand "CLE" doesn't match inside "Highclere".
    for (const { brand, re } of brands) { if (re.test(nn)) return brand; }
    return '';
  };
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

// Write that survives a file being open/locked (e.g. the review CSV open in
// Excel): falls back to a ".new" copy instead of crashing the whole run.
function safeWrite(file, content, label) {
  try { fs.writeFileSync(file, content, 'utf8'); return file; }
  catch (e) {
    if (e.code === 'EBUSY' || e.code === 'EPERM' || e.code === 'EACCES') {
      const alt = file.replace(/(\.[^.]+)$/, '.new$1');
      fs.writeFileSync(alt, content, 'utf8');
      console.log(`⚠ ${label} (${file}) is open/locked — wrote ${alt} instead. Close the file and re-run to replace it in place, or use the .new copy.`);
      return alt;
    }
    throw e;
  }
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
  let footer = 0;
  for (let i = headerIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (line == null || line.trim() === '') continue;
    const cells = parseCsvLine(line);
    const product = (cells[col['Product']] || '').trim();
    // Drop Thrive's trailing summary rows (a "Total" line and a marketing
    // tagline) plus any blank-product row — these are not products.
    if (!product || /^total$/i.test(product) || /^drive your business/i.test(product)) { footer++; continue; }
    rows.push({
      product: product,
      location: cells[col['Location']] || '',
      listPrice: cells[col['List Price']],
      inStock: cells[col['In Stock']],
      netSold: cells[col['Net Sold']],
      _raw: line,
    });
  }
  return { header, col, missing, rows, footer };
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
  const addNew = args.includes('--add-new');
  const importNewFile = getOpt('--import-new');

  if (!exportFile) {
    console.error('Usage: node scripts/sync-inventory.js <export.csv> [--write] [--exclude f.csv]\n' +
      '         [--override f.csv] [--add-new] [--import-new new-products-review.csv]');
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
  console.log(`export rows read: ${exp.rows.length}${exp.footer ? `  (ignored ${exp.footer} footer/summary row(s))` : ''}`);

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
    if (idx === undefined) { unmatchedExport.push(row); return; }
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
  reportLines.push(...unmatchedExport.map(r => r.product));
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
  safeWrite(reportFile, reportLines.join('\n'), 'report file');
  console.log(`\nunmatched lists written to: ${reportFile}`);

  /* ---- 4) --add-new: stage unmatched export rows into a review file ---- */
  function csvCell(v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function parseNet(v) { const n = parseInt(String(v == null ? '' : v).replace(/[^0-9.\-]/g, ''), 10); return isNaN(n) ? 0 : n; }
  if (addNew) {
    const suggestBrand = makeBrandSuggester(catalog, I);
    const isNonProduct = n => { const s = String(n).toLowerCase(); return CONFIG.NON_PRODUCT_KEYWORDS.some(k => s.includes(k)); };
    const review = [], skipped = [];
    unmatchedExport.forEach(row => {
      const price = parsePrice(row.listPrice);
      const st = parseStock(row.inStock);
      const netSold = parseNet(row.netSold);
      let reason = null;
      if (isNonProduct(row.product)) reason = 'non-product line item';
      else if (price === null || price === 0) reason = 'blank or $0 price';
      else if (st.value <= 0 && netSold === 0) reason = 'discontinued (no stock, no sales)';
      const rec = { product: row.product, brand: suggestBrand(row.product), stock: st.value, price: price, netSold: netSold };
      (reason ? skipped : review).push(reason ? Object.assign(rec, { reason }) : rec);
    });
    const reviewCsv = ['product,suggested_brand,in_stock,price,net_sold,keep,notes'].concat(
      review.map(r => [csvCell(r.product), csvCell(r.brand), r.stock, (r.price == null ? '' : r.price), r.netSold, '', ''].join(',')));
    const skippedCsv = ['product,in_stock,price,net_sold,reason'].concat(
      skipped.map(r => [csvCell(r.product), r.stock, (r.price == null ? '' : r.price), r.netSold, csvCell(r.reason)].join(',')));
    safeWrite(CONFIG.REVIEW_FILE, reviewCsv.join('\n'), 'review file');
    safeWrite(CONFIG.SKIPPED_FILE, skippedCsv.join('\n'), 'skipped file');

    const byReason = {};
    skipped.forEach(r => { byReason[r.reason] = (byReason[r.reason] || 0) + 1; });
    console.log('\n' + line);
    console.log('ADD-NEW (staging — no catalog changes)');
    console.log(line);
    console.log(`unmatched export rows:      ${unmatchedExport.length}`);
    console.log(`  → review candidates:      ${review.length}   → ${CONFIG.REVIEW_FILE}`);
    console.log(`  → pre-filtered (skipped): ${skipped.length}   → ${CONFIG.SKIPPED_FILE}`);
    Object.keys(byReason).forEach(r => console.log(`        · ${byReason[r]}  ${r}`));
    console.log(`brand suggested on ${review.filter(r => r.brand).length}/${review.length} candidates (blank where no known brand matched)`);
  }

  /* ---- 5) --import-new: append approved (keep=y) rows ---- */
  let imported = 0;
  if (importNewFile) {
    const rows = fs.readFileSync(importNewFile, 'utf8').split(/\r\n|\n|\r/).filter(l => l.trim() !== '');
    const header = parseCsvLine(rows[0]).map(h => h.toLowerCase());
    const ix = name => header.indexOf(name);
    const used = new Set(catalog.map(r => r[I.id]));
    const KEEP = ['y', 'yes', 'x', 'true', '1'];   // case-insensitive, trimmed
    const newHaz = [];
    const appended = [];
    let dataRows = 0;
    for (let i = 1; i < rows.length; i++) {
      const c = parseCsvLine(rows[i]);
      if (!(c[ix('product')] || '').trim()) continue;
      dataRows++;
      if (KEEP.indexOf(String(c[ix('keep')] || '').trim().toLowerCase()) === -1) continue;
      const name = c[ix('product')] || '';
      const brand = ix('suggested_brand') >= 0 ? (c[ix('suggested_brand')] || '') : '';
      const price = parsePrice(c[ix('price')]);
      const stock = Math.max(0, parseNet(c[ix('in_stock')]));
      const type = /\b(box|bundle|pack|sampler|tin|tins|tubos?)\b/i.test(name) ? 'Box/Bundle' : 'Single';
      let base = slug((brand ? brand + ' ' : '') + name) || 'item', id = base, n = 1;
      while (used.has(id)) { n++; id = base + '-' + n; }
      used.add(id);
      const haz = isHazmat(name);
      if (haz) newHaz.push(name);
      catalog.push([name, brand, price, stock, type, id, null, !haz, false, false]);
      appended.push({ name, brand, price, stock, type, id, shippable: !haz });
      imported++;
    }
    console.log('\n' + line);
    console.log('IMPORT-NEW');
    console.log(line);
    console.log(`review rows read: ${dataRows}`);
    console.log(`read as KEPT:     ${imported}   (accepted: ${KEEP.join(', ')} — case-insensitive, trimmed)`);
    if (imported === 0) console.log('⚠ 0 rows kept — nothing would be imported. Check the keep column.');
    else if (imported === dataRows) console.log('⚠ EVERY row is marked keep — double-check that is intended.');
    if (newHaz.length) { console.log(`hazmat-flagged among imports: ${newHaz.length}  (shippable:false)`); newHaz.forEach(n => console.log(`    · ${n}`)); }

    // preview of what would be appended
    const singles = appended.filter(a => a.type === 'Single').length;
    const boxes = appended.length - singles;
    const soldout = appended.filter(a => a.stock <= 0).length;
    const noBrand = appended.filter(a => !a.brand).length;
    const noPrice = appended.filter(a => a.price == null).length;
    console.log(`\nwould append: ${appended.length}  (${singles} Single, ${boxes} Box/Bundle)`);
    console.log(`  shippable:false (hazmat): ${newHaz.length}`);
    console.log(`  zero stock (→ "Sold out"): ${soldout}`);
    console.log(`  blank brand: ${noBrand}   |   null price: ${noPrice}`);
    console.log('\nsample of appended rows [name | brand | price | stock | type | id | shippable]:');
    appended.slice(0, 12).forEach(a =>
      console.log(`  ${a.name} | ${a.brand || '(blank)'} | ${a.price == null ? '—' : '$' + a.price} | ${a.stock} | ${a.type} | ${a.id} | ${a.shippable}`));
    if (appended.length > 12) console.log(`  …and ${appended.length - 12} more`);
  }

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
