// ============================================================
// Status flow
//
// Controller for /appointment?id=...
// ============================================================

import { me } from './lib/auth-guards.js';
import { getActiveClinicId } from './lib/clinic-context.js';
import { get as getAppointment, updateStatus, reschedule as rescheduleAppt } from './appointments.js';
import { createFromVisit, findPendingForPatient, supersede } from './followups.js';
import { generateSlots } from './slot-grid.js';
import { fmtDate, fmtSlot, intervalToDate } from './date-utils.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './lib/firebase-init.js';
import { showToast } from './lib/toast.js';
import { checkSlotOccupancy, invalidateOccupancy } from './booking-policy.js';
import { esc } from './lib/format.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  appointment: null,
  clinicId: null,
  schedule: null,
  pendingFollowup: null,
  saving: false
};

// ---------- entry ----------
export async function startStatusFlow() {
  const m = me();
  if (!m) return;

  state.clinicId = getActiveClinicId();
  const id = new URLSearchParams(location.search).get('id');
  if (!id) { renderError('No appointment specified.'); return; }

  try {
    state.appointment = await getAppointment(id);
  } catch (err) {
    renderError('Could not load appointment.');
    return;
  }
  if (!state.appointment) { renderError('Appointment not found.'); return; }

  state.schedule = await loadSchedule(state.clinicId);
  state.pendingFollowup = await findPendingForPatient(state.clinicId, state.appointment.patientId);

  wireEvents();
  renderHeader();
  renderBody();
}

async function loadSchedule(clinicId) {
  try {
    const snap = await getDoc(doc(db, 'clinicSchedule', clinicId));
    if (!snap.exists()) return null;
    return snap.data();
  } catch { return null; }
}

// ---------- rendering ----------
function renderHeader() {
  const a = state.appointment;
  setText('#appt-patient', a.patientName || 'Patient');
  setText('#appt-phone', a.patientPhone || '');
  setText('#appt-date', fmtDate(a.date));
  setText('#appt-slot', fmtSlot(a.slot));
  setText('#appt-type', a.type === 'new' ? 'New' : 'Follow-up');
  setText('#appt-mode', a.mode === 'call' ? 'Call' : 'Visit');
  setText('#appt-status', a.status || 'booked');

  const statusEl = $('#appt-status');
  if (statusEl) {
    statusEl.className = 'text-[11px] font-bold uppercase tracking-wider mt-0.5 ' +
      (a.status === 'seen' ? 'text-accent'
        : a.status === 'cancelled' ? 'text-red-500'
        : 'text-ink-mute');
  }
}

function renderBody() {
  const a = state.appointment;
  const actionsRoot = $('#appt-actions');
  if (!actionsRoot) return;

  const buttons = [];

  if (a.status === 'booked') {
    buttons.push(button('Mark Seen', 'seen', 'primary', 'bi-check-circle-fill'));
    buttons.push(button('Move Time', 'move', 'secondary', 'bi-arrow-right-circle'));
    buttons.push(button('Cancel', 'cancel', 'danger', 'bi-x-circle'));
  }
  if (a.status === 'seen') {
    buttons.push(button('Reopen as Booked', 'reopen', 'secondary', 'bi-arrow-counterclockwise'));
  }
  if (a.status === 'cancelled') {
    buttons.push(button('Restore to Booked', 'reopen', 'secondary', 'bi-arrow-counterclockwise'));
  }

  actionsRoot.innerHTML = buttons.join('');

  actionsRoot.querySelectorAll('[data-action]').forEach((el) => {
    el.addEventListener('click', () => onAction(el.getAttribute('data-action')));
  });
}

function button(label, action, kind, icon) {
  const base = 'w-full h-11 rounded-xl text-[13px] font-bold transition-all flex items-center justify-center gap-2 shadow-sm';
  const styles = {
    primary: 'bg-accent hover:bg-accent-hover text-white',
    danger: 'bg-white hover:bg-red-50 text-red-500 border border-hairline hover:border-red-200',
    secondary: 'bg-white hover:bg-surface-hover text-ink border border-hairline'
  };
  return `<button type="button" data-action="${action}" class="${base} ${styles[kind]}"><i class="bi ${icon}"></i> ${label}</button>`;
}

function setText(sel, value) {
  const el = $(sel);
  if (el) el.textContent = value;
}

// ---------- events ----------
function wireEvents() {
  $('#appt-close')?.addEventListener('click', () => history.back());
  $('#appt-backdrop')?.addEventListener('click', closeModal);
  $('#appt-modal-close')?.addEventListener('click', closeModal);
  
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#appt-modal').classList.contains('hidden')) closeModal();
  });

  ['#fu-date', '#res-date'].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('click', () => {
      try { el.showPicker && el.showPicker(); } catch {}
    });
  });

  $('#fu-back')?.addEventListener('click', () => {
    $('#panel-followup').classList.add('hidden');
    $('#appt-actions').classList.remove('hidden');
  });

  $('#fu-save')?.addEventListener('click', doFollowupSave);

  $('#res-back')?.addEventListener('click', () => {
    $('#panel-reschedule').classList.add('hidden');
    $('#appt-actions').classList.remove('hidden');
  });

  $('#res-date')?.addEventListener('change', populateRescheduleSlots);
  $('#res-save')?.addEventListener('click', doRescheduleSave);

  document.querySelectorAll('#panel-cancel [data-reason]').forEach(el => {
    el.addEventListener('click', () => doCancel(el.getAttribute('data-reason')));
  });

  $('#cancel-back')?.addEventListener('click', () => {
    $('#panel-cancel').classList.add('hidden');
    $('#appt-actions').classList.remove('hidden');
  });
}

async function onAction(action) {
  if (action === 'seen') { showFollowupPicker(); return; }
  if (action === 'move') { showMovePicker(); return; }
  if (action === 'cancel') { showCancelPicker(); return; }
  if (action === 'reopen') { await doReopen(); return; }
}

// ---------- Modal Control ----------
function openModal(title) {
  $('#appt-modal-title').textContent = title;
  $('#panel-followup').classList.add('hidden');
  $('#panel-reschedule').classList.add('hidden');
  $('#panel-cancel').classList.add('hidden');
  
  $('#appt-actions').classList.add('hidden');

  $('#appt-backdrop').classList.remove('hidden');
  $('#appt-modal').classList.remove('hidden');
  $('#appt-modal').classList.add('flex');
}

function closeModal() {
  $('#appt-backdrop').classList.add('hidden');
  $('#appt-modal').classList.add('hidden');
  $('#appt-modal').classList.remove('flex');
  $('#appt-actions').classList.remove('hidden');
}

// ---------- Pickers ----------
function showFollowupPicker() {
  openModal('Mark Seen');
  $('#panel-followup').classList.remove('hidden');
  
  $('#fu-date').value = '';
  $('#fu-interval').value = '';
  
  const note = $('#fu-pending-note');
  if (state.pendingFollowup && note) {
    note.classList.remove('hidden');
    note.className = 'bg-blue-50 text-[12px] text-blue-700 border border-blue-200 p-3 rounded-lg mb-4';
    note.innerHTML = `Patient has an existing follow-up scheduled for <strong>${fmtDate(state.pendingFollowup.dueDate)}</strong>.`;
  } else if (note) {
    note.classList.add('hidden');
  }

  setTimeout(() => {
    try { $('#fu-date').showPicker && $('#fu-date').showPicker(); } catch {}
  }, 150);
}

function showMovePicker() {
  openModal('Reschedule Appointment');
  $('#panel-reschedule').classList.remove('hidden');
  $('#res-date').value = state.appointment.date;
  populateRescheduleSlots();
}

function showCancelPicker() {
  openModal('Cancel Appointment');
  $('#panel-cancel').classList.remove('hidden');
}

// ---------- Actions ----------
async function doFollowupSave() {
  if (state.saving) return;
  const pickedDate = $('#fu-date').value;
  const pickedInterval = $('#fu-interval').value;
  
  let dueDate = null;
  let days = null;

  if (pickedDate) {
    dueDate = pickedDate;
  } else if (pickedInterval) {
    days = Number(pickedInterval);
    dueDate = intervalToDate(state.appointment.date, days);
  }

  // Bulletproof warning check
  if (!dueDate && state.pendingFollowup) {
    const proceed = confirm(
      `No new date picked. The existing follow-up (${fmtDate(state.pendingFollowup.dueDate)}) will remain as is. Continue?`
    );
    if (!proceed) return;
  }

  state.saving = true;
  try {
    await updateStatus(state.appointment.id, 'seen', '');
    
    if (dueDate) {
      if (state.pendingFollowup) {
        await supersede(
          state.pendingFollowup.id, 
          `Visited early on ${state.appointment.date}`, 
          dueDate
        );
      }
      await createFromVisit(state.appointment, days, dueDate);
    }
    
    showToast('Marked seen');
    setTimeout(() => history.back(), 400);
  } catch (err) {
    console.error(err);
    showToast('Could not complete', 'error');
    state.saving = false;
  }
}

async function populateRescheduleSlots() {
  const appt = state.appointment;
  if (!appt || !state.schedule) return;
  
  const dateInput = $('#res-date');
  const slotSelect = $('#res-slot');
  if (!dateInput || !slotSelect) return;

  const pickedDate = dateInput.value || appt.date;
  const slots = generateSlots(state.schedule);

  slotSelect.innerHTML = `<option value="">Loading slots…</option>`;

  const occupancies = await Promise.all(
    slots.map(slot =>
      checkSlotOccupancy({
        clinicId: state.clinicId,
        dateISO: pickedDate,
        slot,
        excludeApptId: appt.id
      }).catch(() => ({ count: 0, conflict: null }))
    )
  );

  slotSelect.innerHTML = slots.map((s, i) => {
    const occ = occupancies[i];
    const isOriginal = s === appt.slot && pickedDate === appt.date;
    const label = occ.count > 0
      ? `${fmtSlot(s)} — Booked (${occ.conflict?.patientName || 'another'})`
      : `${fmtSlot(s)} — Free`;
    return `<option value="${s}" ${isOriginal ? 'selected' : ''}>${esc(label)}</option>`;
  }).join('');
}

async function doRescheduleSave() {
  if (state.saving) return;
  const newDate = $('#res-date').value;
  const newSlot = $('#res-slot').value;
  if (!newDate || !newSlot) { showToast('Pick date and slot', 'error'); return; }

  state.saving = true;
  try {
    const occ = await checkSlotOccupancy({
      clinicId: state.clinicId,
      dateISO: newDate,
      slot: newSlot,
      excludeApptId: state.appointment.id
    });

    if (occ.count > 0) {
      const who = occ.conflict?.patientName || 'another patient';
      const proceed = confirm(
        `This slot already has ${occ.count} booking${occ.count > 1 ? 's' : ''} (${who}). Move anyway?`
      );
      if (!proceed) { state.saving = false; return; }
    }

    await rescheduleAppt(state.appointment.id, newDate, newSlot);
    invalidateOccupancy(state.clinicId, state.appointment.date);
    invalidateOccupancy(state.clinicId, newDate);
    showToast('Appointment moved');
    setTimeout(() => history.back(), 400);
  } catch (err) {
    console.error(err);
    showToast('Could not move', 'error');
    state.saving = false;
  }
}

async function doCancel(reason) {
  if (state.saving) return;
  state.saving = true;
  try {
    await updateStatus(state.appointment.id, 'cancelled', reason);
    
    // Clear the cache so the slot immediately reopens for booking
    invalidateOccupancy(state.clinicId, state.appointment.date);
    
    showToast('Appointment cancelled');
    setTimeout(() => history.back(), 400);
  } catch (err) {
    showToast('Could not cancel', 'error');
    state.saving = false;
  }
}

async function doReopen() {
  if (state.saving) return;
  state.saving = true;
  try {
    await updateStatus(state.appointment.id, 'booked', '');
    invalidateOccupancy(state.clinicId, state.appointment.date);
    showToast('Restored');
    setTimeout(() => history.back(), 400);
  } catch (err) {
    showToast('Could not update', 'error');
    state.saving = false;
  }
}

function renderError(msg) {
  const root = $('#appt-body');
  if (root) {
    root.innerHTML = `<div class="p-8 text-center text-[14px] text-ink-mute">${msg}</div>`;
  }
}