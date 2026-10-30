// ============================================================
// Call view
//
// Controller for /call?id=...
//
// Shows one ad-hoc call with full history and actions:
//   - Call back              -> tel: on mobile, copy on desktop
//   - Complete               -> status done, outcome completed
//   - Convert to appointment -> status converted, open /book prefilled
//   - Add note               -> append to history
// ============================================================

import { me } from './lib/auth-guards.js';
import { get as getCall, resolve, addNote } from './calls.js';
import { showToast } from './lib/toast.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  call: null,
  saving: false
};

// ---------- entry ----------
export async function startCallView() {
  const m = me();
  if (!m) return;

  const id = new URLSearchParams(location.search).get('id');
  if (!id) { renderError('No call specified.'); return; }

  try {
    state.call = await getCall(id);
  } catch (err) {
    renderError('Could not load call.');
    return;
  }
  if (!state.call) { renderError('Call not found.'); return; }

  wireEvents();
  render();
}

// ---------- rendering ----------
function render() {
  const c = state.call;

  setText('#call-name', c.patientName || 'Patient');
  setText('#call-phone', c.patientPhone || '');
  setText('#call-reason', c.reason || '—');
  setText('#call-status', statusLabel(c.status));
  setText('#call-created', fmtTimestamp(c.createdAt));

  const statusEl = $('#call-status');
  if (statusEl) {
    statusEl.className = 'text-[12.5px] font-medium ' +
      (c.status === 'done' ? 'text-accent'
        : c.status === 'converted' ? 'text-ink-mute'
        : 'text-ink');
  }

  renderHistory();
  renderActions();
}

function renderHistory() {
  const root = $('#call-history');
  if (!root) return;
  const items = Array.isArray(state.call.history) ? state.call.history.slice().reverse() : [];
  if (items.length === 0) {
    root.innerHTML = `<div class="text-[12.5px] text-ink-faint py-2">No history yet.</div>`;
    return;
  }
  root.innerHTML = items.map((h) => `
    <div class="flex gap-3 py-2.5 border-b border-hairline last:border-b-0">
      <div class="w-[100px] shrink-0 text-[11.5px] text-ink-faint tnum pt-0.5">${esc(fmtHistoryTime(h.at))}</div>
      <div class="flex-1 min-w-0">
        <div class="text-[13px] text-ink">${esc(h.byName || '')} <span class="text-ink-faint">·</span> ${esc(h.action || '')}</div>
        ${h.note ? `<div class="text-[12.5px] text-ink-mute mt-0.5">${esc(h.note)}</div>` : ''}
      </div>
    </div>`).join('');
}

function renderActions() {
  const root = $('#call-actions');
  if (!root) return;
  const c = state.call;

  if (c.status !== 'pending') {
    root.innerHTML = `<div class="text-[12.5px] text-ink-mute py-2">This call is ${statusLabel(c.status).toLowerCase()}. No actions.</div>`;
    return;
  }

  root.innerHTML = `
    <button type="button" data-action="callback" class="w-full h-11 rounded-lg bg-accent hover:bg-accent-hover text-white text-[13px] font-medium transition-colors">Call back</button>
    <div class="grid grid-cols-2 gap-2">
      <button type="button" data-action="complete" class="h-11 rounded-lg bg-white hover:bg-surface-hover text-accent border border-hairline text-[13px] font-medium">Complete</button>
      <button type="button" data-action="convert" class="h-11 rounded-lg bg-white hover:bg-surface-hover text-ink border border-hairline text-[13px] font-medium">Convert to appointment</button>
    </div>
    <button type="button" data-action="note" class="w-full h-11 rounded-lg bg-white hover:bg-surface-hover text-ink border border-hairline text-[13px] font-medium">Add note</button>`;

  root.querySelectorAll('[data-action]').forEach((el) => {
    el.addEventListener('click', () => onAction(el.getAttribute('data-action')));
  });
}

function setText(sel, value) {
  const el = $(sel);
  if (el) el.textContent = value;
}

function esc(s) {
  return String(s == null ? '' : s)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

function statusLabel(s) {
  return { pending: 'Pending', done: 'Complete', converted: 'Converted' }[s] || s || '—';
}

function fmtTimestamp(ts) {
  if (!ts) return '';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const y = d.getFullYear();
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const da = String(d.getDate()).padStart(2, '0');
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${da} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${y}, ${h}:${mi}`;
  } catch { return ''; }
}

function fmtHistoryTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, '0');
  const da = String(d.getDate()).padStart(2, '0');
  const h = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${da} ${h}:${mi}`;
}

// ---------- events ----------
function wireEvents() {
  const close = $('#call-close');
  if (close) close.addEventListener('click', () => history.back());
}

async function onAction(action) {
  if (action === 'callback') return doCallback();
  if (action === 'complete') return doResolve('completed');
  if (action === 'convert') return doResolve('add_to_appointment');
  if (action === 'note') return doNote();
}

function doCallback() {
  const phone = state.call.patientPhone;
  if (!phone) { showToast('No phone number on file', 'error'); return; }
  if (/Mobi|Android|iPhone/i.test(navigator.userAgent)) {
    location.href = 'tel:' + phone;
  } else {
    navigator.clipboard.writeText(phone).then(() => {
      showToast('Number copied: ' + phone);
    }).catch(() => {
      showToast(phone);
    });
  }
}

async function doResolve(outcome) {
  const label = outcome === 'completed' ? 'Complete' : 'Convert to appointment';
  if (!confirm(`Mark this call as ${label.toLowerCase()}?`)) return;
  state.saving = true;
  try {
    await resolve(state.call.id, outcome, '');
    showToast(outcome === 'completed' ? 'Call completed' : 'Call converted');

    if (outcome === 'add_to_appointment') {
      // Navigate to booking, patient prefilled.
      const url = `/book?patientId=${encodeURIComponent(state.call.patientId)}`;
      setTimeout(() => { location.href = url; }, 400);
      return;
    }

    state.call = await getCall(state.call.id);
    render();
  } catch (err) {
    console.error('[call-view] resolve failed:', err);
    showToast('Could not update', 'error');
  } finally {
    state.saving = false;
  }
}

async function doNote() {
  const note = prompt('Add a note:');
  if (!note || !note.trim()) return;
  state.saving = true;
  try {
    await addNote(state.call.id, note.trim());
    showToast('Note added');
    state.call = await getCall(state.call.id);
    render();
  } catch (err) {
    console.error('[call-view] note failed:', err);
    showToast('Could not add note', 'error');
  } finally {
    state.saving = false;
  }
}

function renderError(msg) {
  const root = $('#call-body');
  if (root) root.innerHTML = `<div class="p-8 text-center text-[14px] text-ink-mute">${msg}</div>`;
}