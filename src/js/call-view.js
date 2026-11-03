// ============================================================
// Call view
//
// Controller for /call?id=...
//
// Shows one ad-hoc call with full history and actions:
//   - Call back       -> tel: on mobile, copy on desktop
//   - Mark Resolved   -> status done, outcome completed, back to /calls
//   - Convert         -> status converted, open /book prefilled
//   - Dismiss         -> status done, outcome completed, back to /calls
//   - Add note        -> append to history
// ============================================================

import { esc } from './lib/format.js';
import { me } from './lib/auth-guards.js';
import { get as getCall, resolve, addNote } from './calls.js';
import { showToast } from './lib/toast.js';
import { todayISO } from './date-utils.js';

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
    const tone =
      c.status === 'done' ? 'bg-emerald-100 text-emerald-700'
      : c.status === 'converted' ? 'bg-blue-100 text-blue-700'
      : 'bg-surface-hover text-ink-mute';
    statusEl.className = `text-[11px] md:text-[12px] font-bold uppercase tracking-widest px-3 py-1 rounded-full ${tone}`;
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
        <div class="text-[13px] text-ink">${esc(h.byName || '')} <span class="text-ink-faint">&middot;</span> ${esc(h.action || '')}</div>
        ${h.note ? `<div class="text-[12.5px] text-ink-mute mt-0.5">${esc(h.note)}</div>` : ''}
      </div>
    </div>`).join('');
}

function renderActions() {
  const root = $('#call-actions');
  if (!root) return;
  const c = state.call;

  if (c.status !== 'pending') {
    root.innerHTML = `
      <div class="text-[12.5px] text-ink-mute py-2 mb-3">This call is ${statusLabel(c.status).toLowerCase()}. No further actions.</div>
      <a href="/calls" class="block w-full h-11 rounded-lg bg-ink hover:bg-ink/90 text-white text-[13px] font-bold flex items-center justify-center gap-2 transition-colors">
        <i class="bi bi-arrow-left"></i> Back to Calls
      </a>`;
    return;
  }

  root.innerHTML = `
    <button type="button" data-action="callback" class="w-full h-11 rounded-lg bg-accent hover:bg-accent-hover text-white text-[13px] font-bold transition-colors flex items-center justify-center gap-2">
      <i class="bi bi-telephone-fill"></i> Call back
    </button>
    <button type="button" data-action="complete" class="w-full h-11 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[13px] font-bold transition-colors flex items-center justify-center gap-2 shadow-sm">
      <i class="bi bi-check-circle-fill"></i> Mark Resolved
    </button>
    <button type="button" data-action="convert" class="w-full h-11 rounded-lg bg-ink hover:bg-ink/90 text-white text-[13px] font-bold transition-colors flex items-center justify-center gap-2 shadow-sm">
      <i class="bi bi-calendar-plus"></i> Convert to Appointment
    </button>
    <div class="grid grid-cols-2 gap-2">
      <button type="button" data-action="note" class="h-11 rounded-lg bg-white hover:bg-surface-hover text-ink border border-hairline text-[13px] font-medium transition-colors">Add note</button>
      <button type="button" data-action="dismiss" class="h-11 rounded-lg bg-white hover:bg-red-50 text-red-500 border border-hairline hover:border-red-200 text-[13px] font-medium transition-colors">Dismiss</button>
    </div>`;

  root.querySelectorAll('[data-action]').forEach((el) => {
    el.addEventListener('click', () => onAction(el.getAttribute('data-action')));
  });
}

function setText(sel, value) {
  const el = $(sel);
  if (el) el.textContent = value;
}

function statusLabel(s) {
  return { pending: 'Pending', done: 'Complete', converted: 'Converted' }[s] || s || '—';
}

function fmtTimestamp(ts) {
  if (!ts) return '';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    const y = d.getFullYear();
    const h = String(d.getHours()).padStart(2, '0');
    const mi = String(d.getMinutes()).padStart(2, '0');
    return `${String(d.getDate()).padStart(2, '0')} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][d.getMonth()]} ${y}, ${h}:${mi}`;
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
  if (action === 'complete') return doResolve('completed', 'Mark this call as resolved?');
  if (action === 'convert') return doResolve('add_to_appointment', 'Convert this call to an appointment?');
  if (action === 'dismiss') return doResolve('completed', 'Dismiss this call? It will be marked as complete.');
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

async function doResolve(outcome, confirmMsg) {
  if (state.saving) return;
  if (!confirm(confirmMsg)) return;

  state.saving = true;
  try {
    const note =
      outcome === 'add_to_appointment' ? 'Converted to appointment'
      : 'Marked resolved from detail view';

    await resolve(state.call.id, outcome, note);

    if (outcome === 'add_to_appointment') {
      showToast('Opening booking…', 'success');
      const params = new URLSearchParams();
      if (state.call.patientId) {
        params.set('patientId', state.call.patientId);
      } else {
        if (state.call.patientName) params.set('patientName', state.call.patientName);
        if (state.call.patientPhone) params.set('patientPhone', state.call.patientPhone);
      }
      params.set('date', todayISO());
      params.set('fromCall', state.call.id);

      setTimeout(() => {
        location.href = `/book?${params.toString()}`;
      }, 800);
      return;
    }

    // Mark resolved / dismissed → toast then back to /calls
    showToast(outcome === 'completed' ? 'Call resolved' : 'Call updated', 'success');
    setTimeout(() => { location.href = '/calls'; }, 800);
  } catch (err) {
    console.error('[call-view] resolve failed:', err);
    showToast('Could not update', 'error');
    state.saving = false;
  }
}

async function doNote() {
  const note = prompt('Add a note:');
  if (!note || !note.trim()) return;
  state.saving = true;
  try {
    await addNote(state.call.id, note.trim());
    showToast('Note added', 'success');
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