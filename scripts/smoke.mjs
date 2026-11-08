#!/usr/bin/env node
// Structural smoke test — no browser, no Firestore. Verifies that
// every file we've touched this epic is wired correctly and that
// the historical bugs we fixed are actually fixed.

import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

let pass = 0;
let fail = 0;
const failures = [];

function ok(label) {
  console.log(`  ✅  ${label}`);
  pass++;
}
function bad(label, why) {
  console.log(`  ❌  ${label}`);
  if (why) console.log(`      → ${why}`);
  fail++;
  failures.push({ label, why });
}

function read(rel) {
  const p = resolve(ROOT, rel);
  if (!existsSync(p)) return null;
  return readFileSync(p, 'utf8');
}

function section(name) {
  console.log('');
  console.log(`━━━ ${name} ━━━`);
}

function has(haystack, needle, label) {
  if (!haystack) { bad(label, 'file missing'); return; }
  if (haystack.includes(needle)) ok(label);
  else bad(label, `missing: ${needle.slice(0, 80)}`);
}

function lacks(haystack, needle, label) {
  if (!haystack) { bad(label, 'file missing'); return; }
  if (!haystack.includes(needle)) ok(label);
  else bad(label, `should NOT contain: ${needle.slice(0, 80)}`);
}

function match(haystack, re, label) {
  if (!haystack) { bad(label, 'file missing'); return; }
  if (re.test(haystack)) ok(label);
  else bad(label, `regex: ${re}`);
}

// ─────────────────────────────────────────────────────────────
section('File presence');
// ─────────────────────────────────────────────────────────────
const files = [
  'src/pages/day.astro',
  'src/pages/calls.astro',
  'src/pages/call.astro',
  'src/pages/dashboard.astro',
  'src/js/day-view.js',
  'src/js/calls.js',
  'src/js/call-view.js',
  'src/js/booking-policy.js',
  'src/js/appointments.js',
  'src/js/lib/billing-drawer.js',
  'src/js/lib/invoice-sync.js',
  'src/layouts/AppLayout.astro'
];
const contents = {};
for (const f of files) {
  const c = read(f);
  contents[f] = c;
  if (c === null) bad(f, 'missing on disk');
  else ok(f);
}

// ─────────────────────────────────────────────────────────────
section('billing-drawer.js (Step 1 fixes)');
// ─────────────────────────────────────────────────────────────
const drawer = contents['src/js/lib/billing-drawer.js'];
has(drawer, "billing-drawer-closed", 'emits billing-drawer-closed');
has(drawer, 'savedThisSession', 'tracks savedThisSession flag');
has(drawer, 'invoiceId = rawId', 'reads invoiceId from URL');
has(drawer, 'if (!rawId) return;', 'null-guard on polling path');
has(drawer, 'closingApptId', 'captures closingApptId for safe nulling');

// ─────────────────────────────────────────────────────────────
section('booking-policy.js (Step 4a fixes)');
// ─────────────────────────────────────────────────────────────
const bp = contents['src/js/booking-policy.js'];
has(bp, 'getDoc(doc(db, "clinicSchedule", clinicId))', 'uses getDoc for schedule (not where)');
lacks(bp, 'where("date", "==", dateISO)', 'no composite-index query on appointments');
match(bp, /where\(\s*["']clinicId["']\s*,\s*["']==["']\s*,\s*clinicId\s*\)/, 'still queries by clinicId');
has(bp, '.filter((a) => a.deleted !== true && a.date === dateISO)', 'filters date in JS');

// ─────────────────────────────────────────────────────────────
section('appointments.js (Step 2 verification)');
// ─────────────────────────────────────────────────────────────
const appts = contents['src/js/appointments.js'];
match(appts, /export async function updateStatus\([^)]*\)\s*\{[\s\S]*?const patch = \{\s*status[\s\S]*?\};/, 'updateStatus patch has only status/updatedAt');
lacks(appts, "notes:", 'updateStatus does NOT touch notes');

// ─────────────────────────────────────────────────────────────
section('calls.js (File 1 patches)');
// ─────────────────────────────────────────────────────────────
const calls = contents['src/js/calls.js'];
has(calls, 'export function subscribeMergedPending', 'exports subscribeMergedPending');
has(calls, 'export async function convertScheduledToVisit', 'exports convertScheduledToVisit');
has(calls, 'return { problem, scheduled }', 'returns { problem, scheduled }');
has(calls, 'x.date === today', 'scheduled calls filtered to today');
lacks(calls, 'where("date", "=="', 'no composite-index query');
has(calls, "onSnapshot", 'uses onSnapshot for realtime');

// ─────────────────────────────────────────────────────────────
section('day-view.js (Files 2 + 3 + Step 4b)');
// ─────────────────────────────────────────────────────────────
const dv = contents['src/js/day-view.js'];
has(dv, "import { startInvoiceSync } from './lib/invoice-sync.js';", 'imports startInvoiceSync');
has(dv, 'startInvoiceSync(state.clinicId, () => state.appointments)', 'calls startInvoiceSync');
has(dv, "from './calls.js'", 'imports from calls.js');
has(dv, 'subscribeMergedPending', 'uses subscribeMergedPending');
has(dv, 'convertScheduledToVisit', 'uses convertScheduledToVisit');
has(dv, 'callsUnsubscribe', 'has callsUnsubscribe state');
has(dv, 'startCallsSubscription', 'has startCallsSubscription');
has(dv, 'billing-drawer-closed', 'listens for billing-drawer-closed');
has(dv, 'billingAppt', 'uses state.billingAppt for billing prompt');
has(dv, 'openBillingPrompt(appt)', 'passes appt to openBillingPrompt');
has(dv, 'state.billingAppt = appt', 'stores appt in billingAppt');
has(dv, 'resetFollowupPanel', 'has resetFollowupPanel helper');
has(dv, 'loadPendingFollowup', 'has loadPendingFollowup helper');
has(dv, 'promptForCancelReason', 'has promptForCancelReason helper');
has(dv, "Dismissed from Day View", 'dismiss uses "Dismissed" note');
has(dv, 'Converted to appointment', 'convert uses "Converted" note');
lacks(dv, "'€”'", 'no mangled characters');
// Check that closeRowModal is called BEFORE openBillingDrawer is called from billing prompt
match(dv, /#bp-btn-bill'\)\?\.addEventListener\('click',\s*\(\)\s*=>\s*\{[\s\S]*?const appt = state\.billingAppt;[\s\S]*?openBillingDrawer\(appt\.patientId, appt\.id\)/, 'billing prompt reads state.billingAppt (not state.activeAppt)');

// ─────────────────────────────────────────────────────────────
section('invoice-sync.js');
// ─────────────────────────────────────────────────────────────
const inv = contents['src/js/lib/invoice-sync.js'];
has(inv, 'export function startInvoiceSync', 'exports startInvoiceSync');
has(inv, 'where("clinicId", "==", clinicId)', 'queries by clinicId only');
lacks(inv, 'where("date", "=="', 'no composite-index query');
has(inv, 'pickBestMatch', 'has pickBestMatch helper');
has(inv, "a.patientId !== inv.patientId", 'matches by patientId');
has(inv, "a.date !== inv.invoiceDate", 'matches by invoiceDate');
has(inv, "if (a.status !== 'seen') return false;", 'only matches seen appointments');
has(inv, 'inv.deleted === true', 'ignores deleted invoices');
has(inv, 'invoiceNumber || change.doc.id', 'falls back to doc id if invoiceNumber missing');

// ─────────────────────────────────────────────────────────────
section('day.astro (Step 3 + File 4)');
// ─────────────────────────────────────────────────────────────
const dayAstro = contents['src/pages/day.astro'];
for (const id of ['bp-modal','bp-btn-bill','bp-btn-nobill','bp-btn-close','ra-panel-followup','ra-followup-note','day-grid','day-mobile-list','day-calls-list','calls-panel-count','quick-add-call-btn']) {
  has(dayAstro, `id="${id}"`, `has #${id}`);
}
has(dayAstro, 'bg-blue-50 text-blue-700 border-blue-200', 'followup-note uses blue/info styling');

// ─────────────────────────────────────────────────────────────
section('calls.astro (page rewrite)');
// ─────────────────────────────────────────────────────────────
const callsAstro = contents['src/pages/calls.astro'];
has(callsAstro, 'subscribeMergedPending', 'uses subscribeMergedPending');
has(callsAstro, 'state.pending.problem', 'reads problem section');
has(callsAstro, 'state.pending.scheduled', 'reads scheduled section');
has(callsAstro, 'Scheduled Calls', 'renders Scheduled header');
has(callsAstro, 'Problem Calls', 'renders Problem header');
has(callsAstro, 'nc-phone', 'has manual phone field');
has(callsAstro, 'No matches', 'shows no-match hint');
has(callsAstro, 'rounded-t-3xl', 'mobile bottom-sheet modal');
has(callsAstro, 'md:rounded-2xl', 'desktop card modal');

// ─────────────────────────────────────────────────────────────
section('call-view.js');
// ─────────────────────────────────────────────────────────────
const cv = contents['src/js/call-view.js'];
has(cv, 'Mark Resolved', 'Mark Resolved button');
has(cv, 'Convert to Appointment', 'Convert to Appointment button');
has(cv, 'Dismiss', 'Dismiss button');
has(cv, 'location.href = \'/calls\'', 'auto-return to /calls');
has(cv, "params.set('patientName'", 'convert fallback to patientName');
has(cv, "params.set('patientPhone'", 'convert fallback to patientPhone');
has(cv, "params.set('fromCall'", 'passes fromCall');
lacks(cv, "'€”'", 'no mangled characters');
has(cv, 'if (state.saving) return;', 're-entrancy guard in doResolve');
has(cv, 'Back to Calls', 'resolved state has Back to Calls link');

// ─────────────────────────────────────────────────────────────
section('call.astro');
// ─────────────────────────────────────────────────────────────
const callAstro = contents['src/pages/call.astro'];
has(callAstro, 'flex-wrap', 'header wraps on mobile');
has(callAstro, 'truncate', 'call-name truncates');
has(callAstro, 'min-w-0', 'name block has min-w-0');

// ─────────────────────────────────────────────────────────────
section('dashboard.astro');
// ─────────────────────────────────────────────────────────────
const dash = contents['src/pages/dashboard.astro'];
has(dash, 'stat-unpaid', 'has Unpaid metric');
has(dash, 'stat-calls-sub', 'has calls sub-line');
has(dash, 'Unpaid', 'Unpaid label present');
lacks(dash, "collection(db, 'patients')", 'removed unused patients query');
has(dash, 'Last 7 Days', 'renamed trend label');
has(dash, 'typeof item.createdAt.seconds', 'guards createdAt in renderCallRows');
has(dash, "a.status === 'booked'", 'desktop calls filter to booked only');
has(dash, 'a.date >= todayISO()', 'mobile calls filter to today+');

// ─────────────────────────────────────────────────────────────
section('Cross-file consistency');
// ─────────────────────────────────────────────────────────────
// Shape { problem, scheduled } should appear in both calls.js and day-view.js
has(calls, 'problem:', 'calls.js uses problem: key');
has(calls, 'scheduled:', 'calls.js uses scheduled: key');
has(dv, 'pendingCalls: { problem: [], scheduled: [] }', 'day-view state has correct shape');
has(callsAstro, 'pending: { problem: [], scheduled: [] }', 'calls.astro state has correct shape');

// data-testid style element ID match between day.astro and day-view.js
const dayViewReferences = ['bp-backdrop','bp-modal','bp-btn-bill','bp-btn-nobill','bp-btn-close',
  'ra-panel-followup','ra-fu-date','ra-fu-interval','ra-followup-note','ra-followup-save','ra-followup-back',
  'ra-panel-actions','ra-panel-reschedule','ra-panel-cancel','ra-btn-complete','ra-btn-bill','ra-btn-no-bill',
  'ra-btn-reschedule','ra-btn-cancel','ra-res-date','ra-res-slot','ra-res-back','ra-res-save',
  'ra-cancel-back','day-grid','day-mobile-list','day-calls-list','calls-panel-count',
  'day-prev','day-next','day-today','day-strip','day-date','day-sub',
  'desktop-date-picker-btn','desktop-date-picker-input','quick-add-call-btn',
  'qc-backdrop','qc-modal','qc-close','qc-name','qc-results','qc-phone','qc-reason','qc-save',
  'ca-backdrop','ca-modal','ca-close','ca-name','ca-reason','ca-type','ca-btn-complete','ca-btn-convert','ca-btn-cancel',
  'ra-backdrop','ra-modal','ra-close','ra-name','ra-time','ra-type','ra-mode'
];
let idMissing = [];
for (const id of dayViewReferences) {
  if (!dayAstro.includes(`id="${id}"`)) idMissing.push(id);
}
if (idMissing.length === 0) ok(`all ${dayViewReferences.length} IDs day-view.js references exist in day.astro`);
else bad('missing IDs in day.astro', idMissing.join(', '));

// ─────────────────────────────────────────────────────────────
section('Garbled-character sweep (all .js and .astro)');
// ─────────────────────────────────────────────────────────────
const garbled = ['€”', '€“', 'â€“', 'â€”', 'Ã©', 'Ã¨'];
let garbledFound = [];
for (const [f, c] of Object.entries(contents)) {
  if (!c) continue;
  for (const g of garbled) {
    if (c.includes(g)) garbledFound.push(`${f} contains ${g}`);
  }
}
if (garbledFound.length === 0) ok('no garbled characters in any tracked file');
else bad('garbled characters found', garbledFound.join('; '));

// ─────────────────────────────────────────────────────────────
section('No composite-index queries anywhere');
// ─────────────────────────────────────────────────────────────
const compositeCheckFiles = [
  'src/js/day-view.js',
  'src/js/calls.js',
  'src/js/booking-policy.js',
  'src/js/lib/invoice-sync.js',
  'src/js/call-view.js'
];
let compositeViolations = [];
for (const f of compositeCheckFiles) {
  const c = contents[f];
  if (!c) continue;
  // Find any query( that contains 2+ where() calls
  const queryBlocks = c.match(/query\([\s\S]*?\)/g) || [];
  for (const block of queryBlocks) {
    const whereCount = (block.match(/where\(/g) || []).length;
    if (whereCount >= 2) compositeViolations.push(`${f}: query with ${whereCount} where() clauses`);
  }
}
if (compositeViolations.length === 0) ok('no composite-index queries in any tracked file');
else bad('composite-index queries found', compositeViolations.join('; '));

// ─────────────────────────────────────────────────────────────
console.log('');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`  ${pass} passed, ${fail} failed`);
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

if (fail > 0) {
  console.log('');
  console.log('Failures:');
  for (const f of failures) {
    console.log(`  • ${f.label}`);
    if (f.why) console.log(`    ${f.why}`);
  }
  process.exit(1);
} else {
  console.log('');
  console.log('✅ All structural checks pass.');
  console.log('   Next: click through /day → /calls → /call → /dashboard in a browser.');
  process.exit(0);
}