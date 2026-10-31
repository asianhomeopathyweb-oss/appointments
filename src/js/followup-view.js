// ============================================================
// Followup view
// ============================================================

import { esc } from './lib/format.js';
import { me } from './lib/auth-guards.js';
import { getActiveClinicId } from './lib/clinic-context.js';
import {
  get as getFollowup,
  resolve,
  move,
  addNote
} from './followups.js';
import { fmtDate, fmtRelative, isPast, todayISO } from './date-utils.js';
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
  wireModal();
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
  setText('#fu-status-inline', statusLabel(f.status));

  const rel = $('#fu-due-rel');
  if (rel) {
    if (f.status !== 'pending') {
      rel.textContent = '';
    } else if (isPast(f.dueDate)) {
      rel.textContent = 'Overdue';
      rel.className = 'text-[12px] text-red-500 font-bold uppercase tracking-wider';
    } else if (f.dueDate === todayISO()) {
      rel.textContent = 'Due today';
      rel.className = 'text-[12px] text-accent font-bold uppercase tracking-wider';
    } else {
      rel.textContent = fmtRelative(f.dueDate);
      rel.className = 'text-[12px] text-ink-mute font-semibold';
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
    root.innerHTML = `<div class="text-[13px] text-ink-faint py-4 text-center">No history yet.</div>`;
    return;
  }
  
  root.innerHTML = items.map((h) => `
    <div class="flex gap-4 py-3 border-b border-hairline/50 last:border-b-0 relative">
      <!-- Timeline dot -->
      <div class="w-2 h-2 rounded-full bg-accent/40 mt-1.5 shrink-0 relative z-10"></div>
      
      <div class="flex-1 min-w-0">
        <div class="flex items-baseline justify-between gap-2">
          <div class="text-[13.5px] font-semibold text-ink">${esc(h.byName || 'System')}</div>
          <div class="text-[11px] text-ink-faint tnum shrink-0">${esc(fmtHistoryTime(h.at))}</div>
        </div>
        <div class="text-[13px] text-ink-mute capitalize mt-0.5">${esc(h.action || '')}</div>
        ${h.note ? `<div class="text-[12.5px] text-ink bg-surface-hover p-2 rounded-lg mt-2 border border-hairline/50">${esc(h.note)}</div>` : ''}
        ${h.to ? `<div class="text-[12.5px] font-medium text-accent mt-1">Moved to ${esc(fmtDate(h.to))}</div>` : ''}
      </div>
    </div>`).join('');
}

function renderActions() {
  const root = $('#fu-actions');
  if (!root) return;
  const f = state.fu;

  if (f.status !== 'pending') {
    root.innerHTML = `<div class="text-[13px] font-medium text-ink-mute py-4 text-center border border-hairline border-dashed rounded-xl bg-surface-hover/50">This follow-up is ${statusLabel(f.status).toLowerCase()}. No further actions available.</div>`;
    return;
  }

  root.innerHTML = `
    <!-- Primary Actions -->
    <button type="button" data-action="call" class="w-full h-12 rounded-xl bg-accent hover:bg-accent-hover text-white text-[14px] font-bold transition-colors shadow-sm flex items-center justify-center gap-2">
      <i class="bi bi-telephone-fill"></i> Call Patient
    </button>
    
    <!-- Secondary Actions -->
    <div class="grid grid-cols-2 gap-3 mt-3">
      <button type="button" data-action="book" class="h-11 rounded-xl bg-ink hover:bg-ink/90 text-white text-[13px] font-semibold transition-colors shadow-sm flex items-center justify-center gap-2">
        <i class="bi bi-calendar-plus"></i> Book
      </button>
      <button type="button" data-action="move" class="h-11 rounded-xl bg-white hover:bg-surface-hover text-ink border border-hairline text-[13px] font-semibold transition-colors shadow-sm flex items-center justify-center gap-2">
        <i class="bi bi-arrow-right-circle"></i> Move Date
      </button>
    </div>
    <div class="grid grid-cols-2 gap-3 mt-3">
      <button type="button" data-action="note" class="h-11 rounded-xl bg-white hover:bg-surface-hover text-ink border border-hairline text-[13px] font-semibold transition-colors shadow-sm flex items-center justify-center gap-2">
        <i class="bi bi-journal-text"></i> Note
      </button>
      <button type="button" data-action="done" class="h-11 rounded-xl bg-white hover:bg-emerald-50 text-emerald-600 border border-hairline hover:border-emerald-200 text-[13px] font-semibold transition-colors shadow-sm flex items-center justify-center gap-2">
        <i class="bi bi-check-circle"></i> Done
      </button>
    </div>
    
    <!-- Danger Action -->
    <button type="button" data-action="cancel" class="w-full mt-3 h-11 rounded-xl bg-white hover:bg-red-50 text-red-500 border border-hairline hover:border-red-200 text-[13px] font-semibold transition-colors shadow-sm flex items-center justify-center gap-2">
      <i class="bi bi-x-circle"></i> Cancel Follow-up
    </button>`;

  root.querySelectorAll('[data-action]').forEach((el) => {
    el.addEventListener('click', () => onAction(el.getAttribute('data-action')));
  });
}

function setText(sel, value) {
  const el = $(sel);
  if (el) el.textContent = value;
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
  if (action === 'move') return showMoveDialog();
  if (action === 'note') return showNoteDialog();
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

// ---------- Modal Logic ----------
function openModal(title, type) {
  $('#fu-modal-title').textContent = title;
  $('#fu-move-panel').classList.add('hidden');
  $('#fu-note-panel').classList.add('hidden');
  
  if (type === 'move') {
    $('#fu-move-panel').classList.remove('hidden');
    $('#fu-move-date').value = state.fu.dueDate;
    setTimeout(() => {
      try { $('#fu-move-date').showPicker && $('#fu-move-date').showPicker(); } catch {}
    }, 150);
  } else if (type === 'note') {
    $('#fu-note-panel').classList.remove('hidden');
    $('#fu-note-text').value = '';
    setTimeout(() => $('#fu-note-text').focus(), 150);
  }

  $('#fu-backdrop').classList.remove('hidden');
  $('#fu-modal').classList.remove('hidden');
  $('#fu-modal').classList.add('flex');
}

function closeModal() {
  $('#fu-backdrop').classList.add('hidden');
  $('#fu-modal').classList.add('hidden');
  $('#fu-modal').classList.remove('flex');
}

function wireModal() {
  $('#fu-backdrop')?.addEventListener('click', closeModal);
  $('#fu-modal-close')?.addEventListener('click', closeModal);
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#fu-modal').classList.contains('hidden')) closeModal();
  });

  $('#fu-move-date')?.addEventListener('click', () => {
    try { $('#fu-move-date').showPicker && $('#fu-move-date').showPicker(); } catch {}
  });

  $('#fu-move-save')?.addEventListener('click', () => {
    const d = $('#fu-move-date').value;
    if (!d) return;
    closeModal();
    performMove(d);
  });

  $('#fu-note-save')?.addEventListener('click', () => {
    const n = $('#fu-note-text').value.trim();
    if (!n) return;
    closeModal();
    performNote(n);
  });
}

function showMoveDialog() { openModal('Move Due Date', 'move'); }
function showNoteDialog() { openModal('Add Note', 'note'); }

// ---------- Actions ----------
async function performMove(newDate) {
  if (state.saving) return;
  const current = state.fu.dueDate;
  state.saving = true;
  try {
    await move(state.fu.id, newDate, `Moved from ${current} to ${newDate}`);
    showToast('Due date moved');
    state.fu = await getFollowup(state.fu.id);
    render();
  } catch (err) {
    showToast('Could not move', 'error');
  } finally { state.saving = false; }
}

async function performNote(note) {
  if (state.saving) return;
  state.saving = true;
  try {
    await addNote(state.fu.id, note);
    showToast('Note added');
    state.fu = await getFollowup(state.fu.id);
    render();
  } catch (err) {
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
    showToast('Could not update', 'error');
  } finally { state.saving = false; }
}

function renderError(msg) {
  const root = $('#fu-body');
  if (root) root.innerHTML = `<div class="p-10 text-center text-[14px] font-medium text-ink-mute">${msg}</div>`;
}