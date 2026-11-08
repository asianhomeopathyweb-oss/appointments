// ============================================================
// Patient view
// ============================================================

import { esc } from './lib/format.js';
import { me, isAdmin } from './lib/auth-guards.js';
import { getActiveClinicId } from './lib/clinic-context.js';
import { get as getPatient, updatePatient, mergePatients, deletePatient, checkPatientReferences } from './patients.js';
import { listForPatient as listApptsForPatient } from './appointments.js';
import { listForPatient as listFollowupsForPatient } from './followups.js';
import { openBillingDrawer } from './lib/billing-drawer.js';
import { todayISO, fmtDate, fmtSlot, fmtRelative } from './date-utils.js';
import { showToast } from './lib/toast.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  patientId: null,
  clinicId: null,
  patient: null,
  appointments: [],
  followups: [],
  allPatients: [],      // for merge search
  mergeAbsorb: null,
  mergeCandidates: [],
  merging: false,
  deleting: false,
  loading: true,
  saving: false
};

// ---------- entry ----------
export async function startPatientView() {
  const m = me();
  if (!m) return;

  state.clinicId = getActiveClinicId();
  state.patientId = new URLSearchParams(location.search).get('id');
  if (!state.patientId) { renderError('No patient specified.'); return; }

  try {
    state.patient = await getPatient(state.patientId);
  } catch (err) {
    renderError('Could not load patient.');
    return;
  }
  if (!state.patient) { renderError('Patient not found.'); return; }

  renderHeader();
  await loadHistory();
  renderSections();
  wireEditModal();
  wireAdminActions();
  wireMergeModal();
  wireDeleteModal();
}

// ---------- data ----------
async function loadHistory() {
  state.loading = true;
  try {
    const [appts, fus] = await Promise.all([
      listApptsForPatient(state.clinicId, state.patientId),
      listFollowupsForPatient(state.clinicId, state.patientId)
    ]);
    state.appointments = appts || [];
    state.followups = fus || [];
  } catch (err) {
    state.appointments = [];
    state.followups = [];
  } finally {
    state.loading = false;
  }
}

// ---------- render: header ----------
function renderHeader() {
  const p = state.patient;
  setText('#pt-name', p.name || 'Patient');
  setText('#pt-phone', p.phone || '');

  const bookBtn = $('#pt-book');
  if (bookBtn) bookBtn.addEventListener('click', () => {
    location.href = `/book?patientId=${encodeURIComponent(state.patientId)}`;
  });

  const billBtn = $('#pt-bill');
  if (billBtn) billBtn.addEventListener('click', () => {
    openBillingDrawer(state.patientId);
  });

  const callBtn = $('#pt-call');
  if (callBtn) callBtn.addEventListener('click', () => {
    const phone = state.patient.phone;
    if (!phone) { showToast('No phone on file', 'error'); return; }
    if (/Mobi|Android|iPhone/i.test(navigator.userAgent)) {
      location.href = 'tel:' + phone;
    } else {
      navigator.clipboard.writeText(phone).then(() => showToast('Copied: ' + phone)).catch(() => showToast(phone));
    }
  });
}

// ---------- render: sections ----------
function renderSections() {
  const root = $('#pt-sections');
  if (!root) return;

  if (state.loading) {
    root.innerHTML = `<div class="p-8 text-center text-[13px] text-ink-mute">Loading...</div>`;
    return;
  }

  const today = todayISO();
  const upcoming = state.appointments
    .filter((a) => a.status === 'booked' && a.date >= today)
    .sort((a, b) => (a.date + a.slot).localeCompare(b.date + b.slot));
  const past = state.appointments
    .filter((a) => a.status === 'seen' || (a.status === 'booked' && a.date < today))
    .sort((a, b) => (b.date + b.slot).localeCompare(a.date + a.slot));
  const cancelled = state.appointments
    .filter((a) => a.status === 'cancelled')
    .sort((a, b) => (b.date + b.slot).localeCompare(a.date + a.slot));
  const followups = state.followups
    .slice()
    .sort((a, b) => (b.dueDate || '').localeCompare(a.dueDate || ''));

  const parts = [];
  if (upcoming.length > 0)  parts.push(section('Upcoming',  upcoming.length,  upcoming.map(apptRow).join('')));
  if (past.length > 0)      parts.push(section('Past visits', past.length, past.map(apptRow).join('')));
  if (followups.length > 0) parts.push(section('Follow-ups', followups.length, followups.map(fuRow).join('')));
  if (cancelled.length > 0) parts.push(section('Cancelled', cancelled.length, cancelled.map(apptRow).join('')));

  if (parts.length === 0) {
    root.innerHTML = `
      <div class="p-10 text-center">
        <div class="text-[14px] text-ink-mute mb-1">No history yet.</div>
        <div class="text-[12.5px] text-ink-faint">Book the first appointment to see it here.</div>
      </div>`;
    return;
  }

  root.innerHTML = parts.join('');

  root.querySelectorAll('[data-appt-id]').forEach((el) => {
    el.addEventListener('click', () => {
      location.href = `/appointment?id=${encodeURIComponent(el.getAttribute('data-appt-id'))}`;
    });
  });
  root.querySelectorAll('[data-fu-id]').forEach((el) => {
    el.addEventListener('click', () => {
      location.href = `/followup?id=${encodeURIComponent(el.getAttribute('data-fu-id'))}`;
    });
  });
}

function section(title, count, inner) {
  return `
    <div class="border-t border-hairline first:border-t-0">
      <div class="px-4 md:px-6 pt-5 pb-2">
        <div class="text-[10px] md:text-[11px] font-bold uppercase tracking-widest text-ink-faint">${esc(title)} &middot; ${count}</div>
      </div>
      ${inner}
    </div>`;
}

function apptRow(a) {
  const status = a.status || 'booked';
  const dot = status === 'seen'
    ? '<i class="bi bi-check-circle-fill text-accent text-[14px]"></i>'
    : status === 'cancelled'
      ? '<i class="bi bi-dash-circle text-ink-faint text-[14px]"></i>'
      : '<span class="inline-block w-2 h-2 rounded-full bg-ink-faint"></span>';
  const nameStyle = status === 'cancelled' ? 'line-through text-ink-faint' : 'text-ink';
  const meta = [];
  if (a.type) meta.push(a.type === 'new' ? 'New' : 'Follow-up');
  if (a.mode) meta.push(a.mode === 'call' ? 'Call' : 'Visit');
  if (status === 'cancelled' && a.cancelledReason) meta.push('&middot; ' + a.cancelledReason.replace('_', ' '));
  return `
    <div data-appt-id="${esc(a.id)}"
      class="flex items-center gap-3 px-4 md:px-6 h-[60px] hover:bg-surface-hover cursor-pointer transition-colors">
      <div class="w-[80px] shrink-0">
        <div class="text-[12px] font-semibold text-ink tnum">${esc(fmtDate(a.date))}</div>
        <div class="text-[11px] text-ink-faint tnum">${esc(fmtSlot(a.slot))}</div>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[13.5px] font-medium ${nameStyle} truncate">${esc(meta.join(' &middot; '))}</div>
      </div>
      <div class="shrink-0">${dot}</div>
    </div>`;
}

function fuRow(f) {
  const statusPill = f.status === 'pending'
    ? `<span class="text-[11px] font-bold text-accent">pending</span>`
    : f.status === 'done'
      ? `<span class="text-[11px] text-ink-mute">done</span>`
      : f.status === 'superseded'
        ? `<span class="text-[11px] text-ink-faint">superseded</span>`
        : `<span class="text-[11px] text-ink-faint">${esc(f.status || '')}</span>`;
  return `
    <div data-fu-id="${esc(f.id)}"
      class="flex items-center gap-3 px-4 md:px-6 h-[60px] hover:bg-surface-hover cursor-pointer transition-colors">
      <div class="w-[80px] shrink-0">
        <div class="text-[12px] font-semibold text-ink tnum">${esc(fmtDate(f.dueDate))}</div>
        <div class="text-[11px] text-ink-faint">${esc(fmtRelative(f.dueDate))}</div>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[12.5px] text-ink-mute truncate">
          ${f.seenOn ? `seen ${esc(fmtDate(f.seenOn))}` : ''}
          ${f.intervalDays ? `<span class="mx-1 text-ink-faint">&middot;</span>${esc(intervalLabel(f.intervalDays))}` : ''}
        </div>
      </div>
      <div class="shrink-0">${statusPill}</div>
    </div>`;
}

function intervalLabel(days) {
  const map = { 7: '1 week', 15: '15 days', 30: '1 month', 60: '2 months', 90: '3 months', 180: '6 months', 365: '12 months' };
  return map[days] || (days ? `${days} days` : '—');
}

function setText(sel, value) {
  const el = $(sel);
  if (el) el.textContent = value;
}

function renderError(msg) {
  const root = $('#pt-sections');
  if (root) root.innerHTML = `<div class="p-8 text-center text-[14px] text-ink-mute">${msg}</div>`;
}

// ---------- edit patient modal ----------
function openEditModal() {
  const p = state.patient;
  
  $('#ep-name').value = p.name || '';
  $('#ep-phone').value = p.phone || '';
  $('#ep-sex').value = p.sex || 'Male';
  $('#ep-referral').value = p.referral || '';
  $('#ep-address').value = p.address || '';

  if (p.age) {
    $('#ep-age').value = p.age;
    $('#ep-age-unit').value = 'years';
  } else {
    $('#ep-age').value = '';
    $('#ep-age-unit').value = 'years';
  }
  
  $('#ep-backdrop').classList.remove('hidden');
  $('#ep-modal').classList.remove('hidden');
  $('#ep-modal').classList.add('flex');

  updateSaveState();
  setTimeout(() => $('#ep-name').focus(), 150);
}

function closeEditModal() {
  $('#ep-backdrop').classList.add('hidden');
  $('#ep-modal').classList.add('hidden');
  $('#ep-modal').classList.remove('flex');
}

function updateSaveState() {
  const name = $('#ep-name').value.trim();
  const phone = $('#ep-phone').value.trim();
  $('#ep-save').disabled = !name || !phone || state.saving;
}

async function savePatient() {
  if (state.saving) return;
  
  const name = $('#ep-name').value.trim();
  const phone = $('#ep-phone').value.trim();
  if (!name || !phone) return;

  state.saving = true;
  const btn = $('#ep-save');
  btn.textContent = 'Saving...';
  updateSaveState();

  let finalAge = $('#ep-age').value;
  const unit = $('#ep-age-unit').value;
  
  if (finalAge) {
    finalAge = Number(finalAge);
    if (unit === 'months') finalAge = Math.round(finalAge / 12);
    if (unit === 'days') finalAge = Math.round(finalAge / 365);
  }

  const changes = {
    name: name,
    phone: phone,
    age: finalAge || null,
    sex: $('#ep-sex').value,
    address: $('#ep-address').value,
    referral: $('#ep-referral').value
  };

  try {
    await updatePatient(state.patientId, changes);
    showToast('Patient updated', 'success');
    setTimeout(() => location.reload(), 400);
  } catch (err) {
    console.error(err);
    showToast('Could not save changes', 'error');
    state.saving = false;
    btn.textContent = 'Save Changes';
    updateSaveState();
  }
}

function wireEditModal() {
  const editBtn = $('#pt-edit');
  if (editBtn) editBtn.addEventListener('click', openEditModal);

  const closeBtn = $('#ep-close');
  if (closeBtn) closeBtn.addEventListener('click', closeEditModal);

  const cancelBtn = $('#ep-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closeEditModal);

  const backdrop = $('#ep-backdrop');
  if (backdrop) backdrop.addEventListener('click', closeEditModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#ep-modal').classList.contains('hidden')) closeEditModal();
  });

  const nameIn = $('#ep-name');
  if (nameIn) {
    nameIn.addEventListener('input', (e) => {
      const v = e.target.value;
      const next = v.replace(/(^|\s)([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase());
      if (next !== v) {
        const pos = e.target.selectionStart;
        e.target.value = next;
        try { e.target.setSelectionRange(pos, pos); } catch {}
      }
      updateSaveState();
    });
  }

  ['#ep-phone', '#ep-age', '#ep-age-unit', '#ep-sex', '#ep-address', '#ep-referral'].forEach(sel => {
    const el = $(sel);
    if (el) el.addEventListener('input', updateSaveState);
  });

  const saveBtn = $('#ep-save');
  if (saveBtn) saveBtn.addEventListener('click', savePatient);
}

// ============================================================
// ADMIN ACTIONS (Merge + Delete) — header icons
// ============================================================
function wireAdminActions() {
  const wrap = $('#pt-admin-actions');
  if (!wrap) return;

  const admin = (typeof isAdmin === 'function') ? isAdmin() : (me()?.role === 'admin');
  if (!admin) return;

  // Reveal the header buttons
  wrap.classList.remove('hidden');
  wrap.classList.add('flex');

  $('#pt-merge')?.addEventListener('click', () => openMergeModal());
  $('#pt-delete')?.addEventListener('click', () => openDeleteModal());
}

// ============================================================
// MERGE MODAL
// ============================================================
async function openMergeModal() {
  // Lazy-load all patients for the search box
  if (state.allPatients.length === 0) {
    try {
      const { searchByName } = await import('./patients.js');
      // We just need all patients; searchByName requires prefix. Use an empty-ish
      // trick by calling fetchAll through searchByName with common letters is messy.
      // Simpler: use the same query the /patients page uses.
      const { collection, query, where, getDocs } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
      const { db } = await import('./lib/firebase-init.js');
      const q = query(collection(db, 'patients'), where('clinicId', '==', state.clinicId));
      const snap = await getDocs(q);
      state.allPatients = snap.docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(p => p.deleted !== true);
    } catch (err) {
      showToast('Could not load patients for merge', 'error');
      return;
    }
  }

  state.mergeAbsorb = null;
  state.mergeCandidates = [];
  state.merging = false;

  renderMergeKeepCard();
  resetMergeAbsorb();

  $('#merge-backdrop').classList.remove('hidden');
  $('#merge-modal').classList.remove('hidden');
  $('#merge-modal').classList.add('flex');

  setTimeout(() => $('#merge-search')?.focus(), 150);
}

function closeMergeModal() {
  $('#merge-backdrop').classList.add('hidden');
  $('#merge-modal').classList.add('hidden');
  $('#merge-modal').classList.remove('flex');
  state.mergeAbsorb = null;
  state.mergeCandidates = [];
  state.merging = false;
}

function renderMergeKeepCard() {
  const el = $('#merge-keep-card');
  if (!el || !state.patient) return;
  const p = state.patient;
  el.innerHTML = `
    <div class="flex items-center gap-3">
      <div class="w-9 h-9 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-[13px] shrink-0">
        ${esc((p.name || '?').charAt(0).toUpperCase())}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[13.5px] font-bold text-ink truncate">${esc(p.name)}</div>
        <div class="text-[11.5px] text-ink-mute truncate">${esc(p.phone || 'No phone')}</div>
      </div>
    </div>`;
}

function resetMergeAbsorb() {
  state.mergeAbsorb = null;

  $('#merge-absorb-empty')?.classList.remove('hidden');
  const list = $('#merge-absorb-list');
  if (list) { list.classList.add('hidden'); list.innerHTML = ''; }
  const card = $('#merge-absorb-card');
  if (card) { card.classList.add('hidden'); card.innerHTML = ''; }
  const search = $('#merge-search');
  if (search) search.value = '';
  $('#merge-confirm-wrap')?.classList.add('hidden');
  const ci = $('#merge-confirm-input');
  if (ci) ci.value = '';
  const exec = $('#merge-execute');
  if (exec) exec.disabled = true;
}

function renderMergeCandidates(q) {
  const list = $('#merge-absorb-list');
  if (!list) return;

  const query = (q || '').trim().toLowerCase();
  const keepId = state.patientId;

  state.mergeCandidates = state.allPatients.filter(p => {
    if (p.id === keepId) return false;
    if (!query) return true;
    return (p.name || '').toLowerCase().includes(query) || (p.phone || '').includes(query);
  }).slice(0, 30);

  if (state.mergeCandidates.length === 0) {
    list.innerHTML = `<div class="p-4 text-center text-ink-faint text-[13px]">No matches. Try a different name or phone.</div>`;
    list.classList.remove('hidden');
    return;
  }

  list.innerHTML = state.mergeCandidates.map(p => `
    <button type="button" data-absorb-id="${esc(p.id)}"
      class="w-full text-left flex items-center gap-3 px-4 py-3 hover:bg-surface-hover transition-colors">
      <div class="w-8 h-8 rounded-full bg-red-100 text-red-600 flex items-center justify-center font-bold text-[12px] shrink-0">
        ${esc((p.name || '?').charAt(0).toUpperCase())}
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-[13px] font-bold text-ink truncate">${esc(p.name)}</div>
        <div class="text-[11px] text-ink-mute truncate">${esc(p.phone || 'No phone')}</div>
      </div>
    </button>
  `).join('');

  list.classList.remove('hidden');

  list.querySelectorAll('[data-absorb-id]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.getAttribute('data-absorb-id');
      const picked = state.mergeCandidates.find(x => x.id === id);
      if (picked) selectAbsorb(picked);
    });
  });
}

function selectAbsorb(patient) {
  state.mergeAbsorb = patient;

  $('#merge-absorb-empty')?.classList.add('hidden');
  const list = $('#merge-absorb-list');
  if (list) { list.classList.add('hidden'); list.innerHTML = ''; }

  const card = $('#merge-absorb-card');
  if (card) {
    card.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-full bg-red-500 text-white flex items-center justify-center font-bold text-[13px] shrink-0">
          ${esc((patient.name || '?').charAt(0).toUpperCase())}
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-[13.5px] font-bold text-ink truncate">${esc(patient.name)}</div>
          <div class="text-[11.5px] text-ink-mute truncate">${esc(patient.phone || 'No phone')}</div>
        </div>
        <button type="button" id="merge-change-absorb"
          class="text-[11px] font-bold text-accent hover:underline shrink-0">Change</button>
      </div>`;
    card.classList.remove('hidden');

    $('#merge-change-absorb')?.addEventListener('click', () => {
      resetMergeAbsorb();
      $('#merge-search')?.focus();
      renderMergeCandidates('');
    });
  }

  $('#merge-confirm-wrap')?.classList.remove('hidden');
  updateMergeExecuteState();
}

function updateMergeExecuteState() {
  const exec = $('#merge-execute');
  const ci = $('#merge-confirm-input');
  if (!exec || !ci) return;

  const ok = !!state.patient
    && !!state.mergeAbsorb
    && ci.value.trim() === 'MERGE'
    && !state.merging;

  exec.disabled = !ok;
}

async function executeMerge() {
  if (state.merging) return;
  if (!state.patient || !state.mergeAbsorb) return;

  const keep = state.patient;
  const absorb = state.mergeAbsorb;

  const proceed = confirm(
    `Merge "${absorb.name}" INTO "${keep.name}"?\n\n` +
    `• All appointments, follow-ups, calls and invoices of "${absorb.name}" will be moved to "${keep.name}".\n` +
    `• "${absorb.name}" will be soft-deleted.\n\n` +
    `This cannot be undone from the UI. Continue?`
  );
  if (!proceed) return;

  state.merging = true;
  const exec = $('#merge-execute');
  if (exec) { exec.disabled = true; exec.textContent = 'Merging...'; }

  try {
    await mergePatients(keep.id, absorb.id, keep);
    showToast(`Merged "${absorb.name}" into "${keep.name}"`, 'success');
    closeMergeModal();
    // Reload history since absorbed appointments are now ours
    await loadHistory();
    renderSections();
  } catch (err) {
    console.error('[merge] failed', err);
    showToast(err.message || 'Merge failed', 'error');
    state.merging = false;
    if (exec) {
      exec.textContent = 'Merge and Delete Duplicate';
      updateMergeExecuteState();
    }
  }
}

function wireMergeModal() {
  $('#merge-close')?.addEventListener('click', closeMergeModal);
  $('#merge-cancel')?.addEventListener('click', closeMergeModal);
  $('#merge-backdrop')?.addEventListener('click', closeMergeModal);

  const search = $('#merge-search');
  if (search) {
    let timer = null;
    search.addEventListener('input', (e) => {
      clearTimeout(timer);
      timer = setTimeout(() => renderMergeCandidates(e.target.value), 150);
    });
    search.addEventListener('focus', () => {
      if (!state.mergeAbsorb) renderMergeCandidates(search.value);
    });
  }

  $('#merge-confirm-input')?.addEventListener('input', updateMergeExecuteState);
  $('#merge-execute')?.addEventListener('click', executeMerge);
}

// ============================================================
// DELETE MODAL
// ============================================================
async function openDeleteModal() {
  if (!state.patient) return;

  const body = $('#del-body');
  const confirmWrap = $('#del-confirm-wrap');
  const exec = $('#del-execute');

  if (body) body.innerHTML = `<div class="p-4 text-center text-[13px] text-ink-mute">Checking references...</div>`;
  if (confirmWrap) confirmWrap.classList.add('hidden');
  if (exec) { exec.disabled = true; exec.textContent = 'Delete Patient'; }
  const ci = $('#del-confirm-input');
  if (ci) ci.value = '';

  $('#del-backdrop').classList.remove('hidden');
  $('#del-modal').classList.remove('hidden');
  $('#del-modal').classList.add('flex');

  let refs = { hasReferences: false, count: 0 };
  try {
    refs = await checkPatientReferences(state.patient.id);
  } catch (err) {
    console.error('[delete] ref check failed', err);
  }

  const p = state.patient;

  if (refs.hasReferences) {
    body.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
          <i class="bi bi-shield-exclamation text-red-600 text-[18px]"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-[14px] font-bold text-ink mb-1">Cannot delete "${esc(p.name)}"</div>
          <div class="text-[12.5px] text-ink-mute leading-relaxed">
            This patient has <strong>${refs.count}</strong> associated record${refs.count === 1 ? '' : 's'} (appointments, bills, calls, or follow-ups).
          </div>
        </div>
      </div>
      <div class="mt-3 p-3 rounded-xl bg-surface-hover/50 border border-hairline text-[12.5px] text-ink-mute leading-relaxed">
        Deleting a patient with history would break their past records. Instead, use the <strong>Merge</strong> tool to combine them with the correct patient.
      </div>`;
    confirmWrap.classList.add('hidden');
    exec.disabled = true;
    exec.textContent = 'Cannot Delete';
  } else {
    body.innerHTML = `
      <div class="flex items-start gap-3">
        <div class="w-10 h-10 rounded-full bg-red-100 flex items-center justify-center shrink-0">
          <i class="bi bi-trash text-red-600 text-[18px]"></i>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-[14px] font-bold text-ink mb-1">Delete "${esc(p.name)}"?</div>
          <div class="text-[12.5px] text-ink-mute leading-relaxed">
            This patient has <strong>no appointments, bills, calls, or follow-ups</strong>. They can be safely removed from the directory.
          </div>
        </div>
      </div>
      <div class="mt-3 p-3 rounded-xl bg-orange-50 border border-orange-200 text-[12px] text-orange-800 leading-relaxed">
        <div class="flex gap-2">
          <i class="bi bi-exclamation-triangle-fill text-orange-600 mt-0.5 shrink-0"></i>
          <div>The record will be <strong>soft-deleted</strong>. It will disappear from search and the directory, but remain in the database for audit.</div>
        </div>
      </div>`;
    confirmWrap.classList.remove('hidden');
    exec.disabled = true;
    exec.textContent = 'Delete Patient';
  }

  setTimeout(() => $('#del-confirm-input')?.focus(), 150);
}

function closeDeleteModal() {
  $('#del-backdrop').classList.add('hidden');
  $('#del-modal').classList.add('hidden');
  $('#del-modal').classList.remove('flex');
  state.deleting = false;
}

function updateDeleteExecuteState() {
  const exec = $('#del-execute');
  const ci = $('#del-confirm-input');
  if (!exec || !ci) return;
  // Only allow if the confirm wrap is visible AND input is DELETE
  const wrapVisible = !$('#del-confirm-wrap').classList.contains('hidden');
  exec.disabled = !(wrapVisible && ci.value.trim() === 'DELETE' && !state.deleting);
}

async function executeDelete() {
  if (state.deleting) return;
  if (!state.patient) return;

  state.deleting = true;
  const exec = $('#del-execute');
  if (exec) { exec.disabled = true; exec.textContent = 'Deleting...'; }

  try {
    await deletePatient(state.patient.id);
    showToast(`"${state.patient.name}" deleted`, 'success');
    closeDeleteModal();
    setTimeout(() => { location.href = '/patients'; }, 600);
  } catch (err) {
    console.error('[delete] failed', err);
    showToast(err.message || 'Delete failed', 'error');
    state.deleting = false;
    if (exec) {
      exec.textContent = 'Delete Patient';
      updateDeleteExecuteState();
    }
  }
}

function wireDeleteModal() {
  $('#del-close')?.addEventListener('click', closeDeleteModal);
  $('#del-cancel')?.addEventListener('click', closeDeleteModal);
  $('#del-backdrop')?.addEventListener('click', closeDeleteModal);
  $('#del-confirm-input')?.addEventListener('input', updateDeleteExecuteState);
  $('#del-execute')?.addEventListener('click', executeDelete);
}