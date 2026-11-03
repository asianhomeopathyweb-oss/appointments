// ============================================================
// Patient view
// ============================================================

import { esc } from './lib/format.js';
import { me } from './lib/auth-guards.js';
import { getActiveClinicId } from './lib/clinic-context.js';
import { get as getPatient, updatePatient } from './patients.js';
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
  $('#ep-modal').classList.add('flex'); // Ensure display:flex

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