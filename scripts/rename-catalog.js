#!/usr/bin/env node
/* ============================================================
   THE CIGAR VAULT — catalog rename to match Thrive (source of truth)
   Renames existing catalog products whose NAME differs from the export
   only by formatting, plus the Foundation-Cigars→Olmec prefix case.
   The frozen `id` (index 5) is NEVER changed — only `name` (index 0).

   Usage:
     node scripts/rename-catalog.js <export>.csv [--write]
   Dry run by default. Aborts if any new name would collide.
   ============================================================ */
'use strict';
const fs = require('fs');
const path = require('path');

const exportFile = process.argv.find(a => !a.startsWith('--') && a.toLowerCase().endsWith('.csv'));
const write = process.argv.includes('--write');
if (!exportFile) { console.error('Usage: node scripts/rename-catalog.js <export>.csv [--write]'); process.exit(1); }

const fold = x => String(x).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
const strip = x => fold(x).replace(/[^a-z0-9]/g, '');

const catalogPath = path.join(__dirname, '..', 'data', 'catalog.json');
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));

function parseCsvLine(l) {
  const o = []; let c = '', q = false;
  for (let i = 0; i < l.length; i++) { const ch = l[i];
    if (q) { if (ch === '"') { if (l[i + 1] === '"') { c += '"'; i++; } else q = false; } else c += ch; }
    else { if (ch === '"') q = true; else if (ch === ',') { o.push(c); c = ''; } else c += ch; } }
  o.push(c); return o.map(s => s.trim());
}
const lines = fs.readFileSync(exportFile, 'latin1').split(/\r\n|\n|\r/);
const exp = [];
for (let i = 4; i < lines.length; i++) {
  if (!lines[i].trim()) continue;
  const p = parseCsvLine(lines[i])[0].trim();
  if (!p || /^total$/i.test(p) || /^drive your business/i.test(p)) continue;
  exp.push(p);
}
const catFold = new Set(catalog.map(r => fold(r[0])));
const unmatched = exp.filter(p => !catFold.has(fold(p)));

// pure-formatting: catalog name strips to the same as an unmatched export name
const expByStrip = {};
unmatched.forEach(p => { expByStrip[strip(p)] = p; });
const renames = [];
catalog.forEach((r, idx) => {
  const hit = expByStrip[strip(r[0])];
  if (hit && hit !== r[0]) renames.push({ idx, old: r[0], neu: hit, id: r[5], why: 'formatting' });
});
// explicit brand-prefix case
[['Foundation Cigars - Olmec Claro Toro', 'Olmec Claro Toro']].forEach(([oldName, neu]) => {
  const idx = catalog.findIndex(r => r[0] === oldName);
  if (idx >= 0) renames.push({ idx, old: oldName, neu, id: catalog[idx][5], why: 'brand-prefix' });
});

// safety: no new name may collide with an existing (different) catalog name, and new names must be unique
const existing = new Map(); catalog.forEach((r, i) => existing.set(fold(r[0]), i));
const seen = {};
const collisions = [];
renames.forEach(x => {
  const f = fold(x.neu);
  if (existing.has(f) && existing.get(f) !== x.idx) collisions.push(`${x.neu}  (already exists)`);
  if (seen[f]) collisions.push(`${x.neu}  (two renames target this)`);
  seen[f] = true;
});

const bar = '─'.repeat(64);
console.log(bar);
console.log(`CATALOG RENAME   ${write ? '*** WRITE ***' : 'DRY RUN'}   (ids are frozen)`);
console.log(bar);
renames.forEach(x => {
  console.log(`  old:  ${x.old}`);
  console.log(`  new:  ${x.neu}`);
  console.log(`  id :  ${x.id}   [${x.why}]\n`);
});
console.log(`total renames: ${renames.length}`);

if (collisions.length) {
  console.log(`\n⚠ ${collisions.length} COLLISION(S) — would create duplicate names:`);
  collisions.forEach(c => console.log(`   ${c}`));
  console.log('Not writing.');
  process.exit(1);
}

if (write) {
  renames.forEach(x => { catalog[x.idx][0] = x.neu; });   // name only; id untouched
  fs.writeFileSync(catalogPath, JSON.stringify(catalog), 'utf8');
  console.log('\n✔ catalog.json written — names updated, ids unchanged.');
} else {
  console.log('\nDRY RUN — catalog.json not modified. Re-run with --write to apply.');
}
