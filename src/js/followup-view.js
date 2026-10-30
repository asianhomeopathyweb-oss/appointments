// ============================================================
// Followup view
//
// Controller for /followup?id=...
//
// Shows one follow-up with full history, and offers:
//   - Call              -> tel: link on mobile, copy on desktop
//   - Book              -> navigate to /book?patientId=...
//   - Move              -> pick a new date
//   - Add note          -> append to history
//   - Mark done         -> status = done
//   - Cancel            -> status = cancelled
// ============================================================

import { me } from './lib/auth-guards.js';
import { getActiveClinicId } from './lib/clinic-context.js';
import {
  get as getFollowup,
  resolve,
  move,
  addNote
} from './followups.js';
import { fmtDate, fmtRelative, isPast, addDays, addMonths, todayISO } from './date-utils.js';
import { showToast } from './lib/toast.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  fu: null,
  clinicId: null,
  saving: false
};

// ---------- entry ----------
export async function startFollowupView() {
  const m = me();
  if (!m) return;

  state.clinicId = getActiveClinicId();
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { renderError('No follow-up specified.'); return; }

  try {
    state.fu = await getFollowup(id);
  } catch (err) {
    renderError('Could not load follow-up.');
    return;
  }
  if (!state.fu) { renderError('Follow-up not found.'); return; }

  wireEvents();
  render();
}

// ---------- rendering ----------
function render() {
  const f = state.fu;

  setText('#fu-name', f.patientName || 'Patient');
  setText('#fu-phone', f.patientPhone || '');
  setText('#fu-due', fmtDate(f.dueDate));
  setText('#fu-seen', fmtDate(f.seenOn));
  setText('#fu-interval', intervalLabel(f.intervalDays));
  setText('#fu-status', statusLabel(f.status));

  const rel = $('#fu-due-rel');
  if (rel) {
    if (f.status !== 'pending') {
      rel.textContent = '';
    } else if (isPast(f.dueDate)) {
      rel.textContent = 'Overdue';
      rel.className = 'text-[12.5px] text-[#b91c1c] font-medium';
    } else if (f.dueDate === todayISO()) {
      rel.textContent = 'Due today';
      rel.className = 'text-[12.5px] text-accent font-medium';
    } else {
      rel.textContent = fmtRelative(f.dueDate);
      rel.className = 'text-[12.5px] text-ink-mute';
    }
  }

  renderHistory();
  renderActions();
}

function renderHistory() {
  const root = $('#fu-history');
  if (!root) return;
  const items = Array.isArray(state.fu.history) ? state.fu.history.slice().reverse() : [];
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
        ${h.to ? `<div class="text-[12.5px] text-ink-mute mt-0.5">Moved to ${esc(fmtDate(h.to))}</div>` : ''}
      </div>
    </div>`).join('');
}

function renderActions() {
  const root = $('#fu-actions');
  if (!root) return;
  const f = state.fu;

  if (f.status !== 'pending') {
    root.innerHTML = `<div class="text-[12.5px] text-ink-mute py-2">This follow-up is ${statusLabel(f.status).toLowerCase()}. No actions.</div>`;
    return;
  }

  root.innerHTML = `
    <button type="button" data-action="call" class="w-full h-11 rounded-lg bg-accent hover:bg-accent-hover text-white text-[13px] font-medium transition-colors">Call patient</button>
    <button type="button" data-action="book" class="w-full h-11 rounded-lg bg-white hover:bg-surface-hover text-ink border border-hairline text-[13px] font-medium transition-colors">Book appointment</button>
    <div class="grid grid-cols-2 gap-2">
      <button type="button" data-action="move" class="h-11 rounded-lg bg-white hover:bg-surface-hover text-ink border border-hairline text-[13px] font-medium">Move date</button>
      <button type="button" data-action="note" class="h-11 rounded-lg bg-white hover:bg-surface-hover text-ink border border-hairline text-[13px] font-medium">Add note</button>
    </div>
    <div class="grid grid-cols-2 gap-2">
      <button type="button" data-action="done" class="h-11 rounded-lg bg-white hover:bg-surface-hover text-accent border border-hairline text-[13px] font-medium">Mark done</button>
      <button type="button" data-action="cancel" class="h-11 rounded-lg bg-white hover:bg-surface-hover text-[#b91c1c] border border-hairline text-[13px] font-medium">Cancel</button>
    </div>`;

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

function intervalLabel(days) {
  const map = { 7: '1 week', 15: '15 days', 30: '1 month', 60: '2 months', 90: '3 months', 180: '6 months', 365: '12 months' };
  return map[days] || (days ? `${days} days` : '—');
}

function statusLabel(s) {
  return { pending: 'Pending', done: 'Done', cancelled: 'Cancelled', superseded: 'Superseded' }[s] || s || '—';
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
  const close = $('#fu-close');
  if (close) close.addEventListener('click', () => history.back());
}

async function onAction(action) {
  if (action === 'call') return doCall();
  if (action === 'book') return doBook();
  if (action === 'move') return doMove();
  if (action === 'note') return doNote();
  if (action === 'done') return doResolve('done');
  if (action === 'cancel') return doResolve('cancelled');
}

function doCall() {
  const phone = state.fu.patientPhone;
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

function doBook() {
  const url = `/book?patientId=${encodeURIComponent(state.fu.patientId)}`;
  location.href = url;
}

async function doMove() {
  const current = state.fu.dueDate;
  const newDate = prompt('New due date (YYYY-MM-DD):', current);
  if (!newDate || newDate === current) return;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) { showToast('Invalid date', 'error'); return; }
  state.saving = true;
  try {
    await move(state.fu.id, newDate, `Moved from ${current} to ${newDate}`);
    showToast('Due date moved');
    state.fu = await getFollowup(state.fu.id);
    render();
  } catch (err) {
    console.error('[followup-view] move failed:', err);
    showToast('Could not move', 'error');
  } finally { state.saving = false; }
}

async function doNote() {
  const note = prompt('Add a note:');
  if (!note || !note.trim()) return;
  state.saving = true;
  try {
    await addNote(state.fu.id, note.trim());
    showToast('Note added');
    state.fu = await getFollowup(state.fu.id);
    render();
  } catch (err) {
    console.error('[followup-view] note failed:', err);
    showToast('Could not add note', 'error');
  } finally { state.saving = false; }
}

async function doResolve(status) {
  const label = status === 'done' ? 'Done' : 'Cancelled';
  if (!confirm(`Mark this follow-up as ${label.toLowerCase()}?`)) return;
  state.saving = true;
  try {
    await resolve(state.fu.id, status, '');
    showToast('Follow-up ' + status);
    state.fu = await getFollowup(state.fu.id);
    render();
  } catch (err) {
    console.error('[followup-view] resolve failed:', err);
    showToast('Could not update', 'error');
  } finally { state.saving = false; }
}

function renderError(msg) {
  const root = $('#fu-body');
  if (root) root.innerHTML = `<div class="p-8 text-center text-[14px] text-ink-mute">${msg}</div>`;
}