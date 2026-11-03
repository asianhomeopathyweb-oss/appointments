#!/usr/bin/env node
// Corrected versions of the 2 false-positive checks.

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

let pass = 0, fail = 0;

function ok(l) { console.log(`  ✅  ${l}`); pass++; }
function bad(l, why) { console.log(`  ❌  ${l}`); if (why) console.log(`      → ${why}`); fail++; }

// ─── Check 1: updateStatus must not write to notes ───────────
const appts = readFileSync(resolve('src/js/appointments.js'), 'utf8');

// Extract ONLY the updateStatus function body
const match = appts.match(/export async function updateStatus\([^)]*\)\s*\{([\s\S]*?)\n\}/);
if (!match) {
  bad('found updateStatus function', 'regex did not match');
} else {
  const body = match[1];
  if (body.includes('notes:')) {
    bad('updateStatus does NOT touch notes', 'found "notes:" inside updateStatus body');
  } else {
    ok('updateStatus does NOT touch notes (verified by body extraction)');
  }
  // Sanity: confirm notes IS written somewhere else (create) — proves we're parsing the right file
  if (appts.includes('notes: payload.notes')) {
    ok('create() still writes notes (expected — different function)');
  } else {
    bad('create() should write notes', 'file does not look like appointments.js');
  }
}

// ─── Check 2: invoice-sync must query by clinicId (any quote style) ──
const inv = readFileSync(resolve('src/js/lib/invoice-sync.js'), 'utf8');

const clinicIdQueryRegex = /where\(\s*['"]clinicId['"]\s*,\s*['"]==['"]\s*,\s*clinicId\s*\)/;
if (clinicIdQueryRegex.test(inv)) {
  ok('invoice-sync.js queries by clinicId (single-field, any quote style)');
} else {
  bad('invoice-sync.js queries by clinicId', 'regex did not match');
}

// Confirm no second where() in same query in invoice-sync
const queryBlocks = inv.match(/query\([\s\S]*?\)/g) || [];
let violations = 0;
for (const block of queryBlocks) {
  const whereCount = (block.match(/where\(/g) || []).length;
  if (whereCount >= 2) violations++;
}
if (violations === 0) ok('invoice-sync.js has no composite-index query');
else bad('composite-index query in invoice-sync.js', `${violations} query/queries with 2+ where()`);

console.log('');
console.log(`  ${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);