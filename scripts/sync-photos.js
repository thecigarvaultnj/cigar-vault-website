#!/usr/bin/env node
/* ============================================================
   sync-photos.js — map product photos to catalog rows by id.

   Convention: a product photo is named after the product's frozen id
   (catalog row index 5) and lives in assets/products/, e.g.
     assets/products/egm-cigars-egm-blecos-single.jpg
   This script scans that folder and sets each matching product's image
   field (row index 6) to "/assets/products/<file>". Future photos need
   no manual mapping — drop the file in, named by id, and re-run.

   Photos outrank the brand/line logo in the render fallback chain, and
   render edge to edge (no cream plate) — see js/catalog.js / js/cart.js.

   Usage:
     node scripts/sync-photos.js            # dry run (default) — shows changes
     node scripts/sync-photos.js --write    # write catalog.json
   ============================================================ */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const CATALOG = path.join(ROOT, 'data', 'catalog.json');
const PHOTOS_DIR = path.join(ROOT, 'assets', 'products');
const EXT = ['.jpg', '.jpeg', '.png', '.webp'];   // first match wins, in this order
const WRITE = process.argv.includes('--write');

const cat = JSON.parse(fs.readFileSync(CATALOG, 'utf8'));

// index available photo files by product id (basename without extension)
const byId = {};
if (fs.existsSync(PHOTOS_DIR)) {
  fs.readdirSync(PHOTOS_DIR).forEach(f => {
    const ext = path.extname(f).toLowerCase();
    if (EXT.indexOf(ext) === -1) return;
    const id = path.basename(f, ext);
    // prefer the earliest extension in EXT order if a product has more than one
    if (!byId[id] || EXT.indexOf(ext) < EXT.indexOf(path.extname(byId[id]).toLowerCase())) byId[id] = f;
  });
}

let set = 0, already = 0, orphanFiles = new Set(Object.keys(byId));
const changes = [];
cat.forEach(r => {
  const id = r[5];
  if (!id || !byId[id]) return;
  orphanFiles.delete(id);
  const want = '/assets/products/' + byId[id];
  if (r[6] === want) { already++; return; }
  changes.push({ id, from: r[6] || null, to: want });
  r[6] = want;
  set++;
});

console.log('product photos found: ' + Object.keys(byId).length);
console.log('image fields set/updated: ' + set + '  |  already current: ' + already);
changes.forEach(c => console.log('  ' + c.id + '  ' + (c.from || '(none)') + ' -> ' + c.to));
if (orphanFiles.size) {
  console.warn('\nWARNING: ' + orphanFiles.size + ' photo file(s) match no product id (check the filename = frozen id):');
  orphanFiles.forEach(id => console.warn('  ' + byId[id] + '  (id "' + id + '" not in catalog)'));
}

if (WRITE && set) {
  fs.writeFileSync(CATALOG, JSON.stringify(cat));
  console.log('\ncatalog.json written (' + cat.length + ' rows).');
} else if (!WRITE) {
  console.log('\nDry run — re-run with --write to save.');
}
