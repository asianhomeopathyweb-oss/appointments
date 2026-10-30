// ============================================================
// Status flow
//
// Controller for /appointment?id=...
//
// The page shows one appointment with actions:
//   - Mark seen        -> status = seen, prompt follow-up interval
//   - Cancel           -> status = cancelled, pick reason
//   - Move             -> change date + slot
//   - Add note         -> append to notes field
//
// Marking seen triggers the follow-up creation flow:
//   1. If the patient has no pending follow-up: create one.
//   2. If they have one: prompt Keep / Replace / Cancel.
// ============================================================

import { me } from './lib/auth-guards.js';
import { getActiveClinicId } from './lib/clinic-context.js';
import { get as getAppointment, updateStatus, reschedule as rescheduleAppt } from './appointments.js';
import { createFromVisit, findPendingForPatient, supersede, resolve as resolveFollowup } from './followups.js';
import { generateSlots, isDayOpen } from './slot-grid.js';
import { todayISO, addDays, addMonths, intervalToDate, fmtDate, fmtSlot } from './date-utils.js';
import { doc, getDoc, updateDoc, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './lib/firebase-init.js';
import { showToast } from './lib/toast.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  appointment: null,
  clinicId: null,
  schedule: null,
  followupInterval: null,   // null | 7 | 15 | 30 | 60 | 90 | 180 | 365 | 'custom'
  followupCustomDate: null,
  pendingFollowup: null,
  saving: false
};

const INTERVALS = [
  { label: '1 week',  days: 7 },
  { label: '15 days', days: 15 },
  { label: '1 month', days: 30 },
  { label: '2 months', days: 60 },
  { label: '3 months', days: 90 },
  { label: '6 months', days: 180 },
  { label: '12 months', days: 365 }
];

// ---------- entry ----------
export async function startStatusFlow() {
  const m = me();
  if (!m) return;

  state.clinicId = getActiveClinicId();
  const id = new URLSearchParams(location.search).get('id');
  if (!id) {
    renderError('No appointment specified.');
    return;
  }

  try {
    state.appointment = await getAppointment(id);
  } catch (err) {
    renderError('Could not load appointment.');
    return;
  }
  if (!state.appointment) {
    renderError('Appointment not found.');
    return;
  }

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
  setText('#appt-type', a.type === 'new' ? 'New patient' : 'Follow-up');
  setText('#appt-mode', a.mode === 'call' ? 'Call' : 'Visit');
  setText('#appt-status', a.status || 'booked');

  const statusEl = $('#appt-status');
  if (statusEl) {
    statusEl.className = 'text-[12.5px] font-medium ' +
      (a.status === 'seen' ? 'text-accent'
        : a.status === 'cancelled' ? 'text-ink-faint line-through'
        : 'text-ink-mute');
  }
}

function renderBody() {
  const a = state.appointment;
  const actionsRoot = $('#appt-actions');
  if (!actionsRoot) return;

  const buttons = [];

  if (a.status === 'booked') {
    buttons.push(button('Mark seen', 'seen', 'primary'));
    buttons.push(button('Cancel', 'cancel', 'danger'));
  }
  if (a.status === 'seen') {
    buttons.push(button('Reopen as booked', 'reopen', 'secondary'));
  }
  if (a.status === 'cancelled') {
    buttons.push(button('Restore to booked', 'reopen', 'secondary'));
  }
  buttons.push(button('Move to another time', 'move', 'secondary'));

  actionsRoot.innerHTML = buttons.join('');

  actionsRoot.querySelectorAll('[data-action]').forEach((el) => {
    el.addEventListener('click', () => onAction(el.getAttribute('data-action')));
  });

  // Reason picker (hidden until cancel)
  const reasonRoot = $('#appt-reason');
  if (reasonRoot) {
    reasonRoot.hidden = true;
    reasonRoot.innerHTML = `
      <div class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Cancellation reason</div>
      <div class="flex flex-wrap gap-1.5">
        <button type="button" data-reason="patient" class="h-8 px-3 rounded-lg text-[12.5px] border border-hairline hover:border-accent">Patient cancelled</button>
        <button type="button" data-reason="no_show" class="h-8 px-3 rounded-lg text-[12.5px] border border-hairline hover:border-accent">No show</button>
        <button type="button" data-reason="clinic" class="h-8 px-3 rounded-lg text-[12.5px] border border-hairline hover:border-accent">Clinic cancelled</button>
        <button type="button" data-reason="rescheduled" class="h-8 px-3 rounded-lg text-[12.5px] border border-hairline hover:border-accent">Rescheduled</button>
      </div>`;
    reasonRoot.querySelectorAll('[data-reason]').forEach((el) => {
      el.addEventListener('click', () => doCancel(el.getAttribute('data-reason')));
    });
  }

  // Follow-up interval picker (hidden until mark seen)
  const fuRoot = $('#appt-followup');
  if (fuRoot) {
    fuRoot.hidden = true;
    const chips = INTERVALS.map((i) =>
      `<button type="button" data-interval="${i.days}" class="h-8 px-3 rounded-lg text-[12.5px] border border-hairline hover:border-accent">${i.label}</button>`
    ).join('');
    fuRoot.innerHTML = `
      <div class="mb-2 text-[11px] font-semibold uppercase tracking-wide text-ink-faint">Follow-up</div>
      <div class="flex flex-wrap gap-1.5">
        ${chips}
        <button type="button" data-interval="none" class="h-8 px-3 rounded-lg text-[12.5px] border border-hairline hover:border-accent">None</button>
      </div>
      <div id="fu-pending-note" hidden class="mt-3 p-3 rounded-lg bg-[#fff7e6] text-[12.5px] text-[#92400e]"></div>
      <div id="fu-custom" hidden class="mt-3">
        <label class="block text-[12.5px] text-ink-mute mb-1">Custom date</label>
        <input id="fu-custom-date" type="date"
          class="w-full h-10 px-3 rounded-lg border border-hairline focus:outline-none focus:shadow-focus focus:border-accent text-[13px]" />
      </div>`;
    fuRoot.querySelectorAll('[data-interval]').forEach((el) => {
      el.addEventListener('click', () => onIntervalPick(el.getAttribute('data-interval')));
    });
  }
}

function button(label, action, kind) {
  const base = 'w-full h-11 rounded-lg text-[13px] font-medium transition-colors';
  const styles = {
    primary: 'bg-accent hover:bg-accent-hover text-white',
    danger: 'bg-white hover:bg-surface-hover text-[#b91c1c] border border-hairline',
    secondary: 'bg-white hover:bg-surface-hover text-ink border border-hairline'
  };
  return `<button type="button" data-action="${action}" class="${base} ${styles[kind]}">${label}</button>`;
}

function setText(sel, value) {
  const el = $(sel);
  if (el) el.textContent = value;
}

// ---------- events ----------
function wireEvents() {
  const close = $('#appt-close');
  if (close) close.addEventListener('click', () => history.back());
}

async function onAction(action) {
  if (action === 'seen') {
    showFollowupPicker();
    return;
  }
  if (action === 'cancel') {
    showCancelPicker();
    return;
  }
  if (action === 'move') {
    showMoveUI();
    return;
  }
  if (action === 'reopen') {
    await doReopen();
    return;
  }
}

function showFollowupPicker() {
  const fu = $('#appt-followup');
  const reason = $('#appt-reason');
  const actions = $('#appt-actions');
  if (reason) reason.hidden = true;
  if (actions) actions.hidden = true;
  if (fu) {
    fu.hidden = false;
    const note = $('#fu-pending-note');
    if (note) {
      if (state.pendingFollowup) {
        note.hidden = false;
        note.innerHTML = `Patient already has a pending follow-up due <strong>${fmtDate(state.pendingFollowup.dueDate)}</strong>. Choosing an interval will <strong>replace</strong> it. Choosing <em>None</em> will <strong>keep</strong> the existing one.`;
      } else {
        note.hidden = true;
      }
    }
  }
}

function showCancelPicker() {
  const fu = $('#appt-followup');
  const reason = $('#appt-reason');
  const actions = $('#appt-actions');
  if (fu) fu.hidden = true;
  if (actions) actions.hidden = true;
  if (reason) reason.hidden = false;
}

async function onIntervalPick(value) {
  if (value === 'none') {
    // Mark seen, no follow-up.
    await markSeen(null, null);
    return;
  }
  if (value === 'custom') {
    const custom = $('#fu-custom');
    if (custom) {
      custom.hidden = false;
      const input = $('#fu-custom-date');
      if (input) input.focus();
    }
    return;
  }
  const days = Number(value);
  const today = state.appointment.date;
  const dueDate = intervalToDate(today, days);
  await markSeen(days, dueDate);
}

async function markSeen(intervalDays, dueDate) {
  if (state.saving) return;
  state.saving = true;

  const a = state.appointment;

  try {
    // 1. Update appointment status.
    await updateStatus(a.id, 'seen', '');

    // 2. Handle follow-up.
    if (intervalDays !== null) {
      if (state.pendingFollowup) {
        await supersede(state.pendingFollowup.id, 'Replaced by new follow-up from visit on ' + a.date);
      }
      await createFromVisit(a, intervalDays, dueDate);
    } else if (state.pendingFollowup) {
      // "None" chosen while a pending one exists — keep it, do nothing.
    }

    showToast('Marked seen');
    setTimeout(() => history.back(), 400);
  } catch (err) {
    console.error('[status-flow] markSeen failed:', err);
    showToast('Could not update', 'error');
    state.saving = false;
  }
}

async function doCancel(reason) {
  if (state.saving) return;
  state.saving = true;
  try {
    await updateStatus(state.appointment.id, 'cancelled', reason);
    showToast('Appointment cancelled');
    setTimeout(() => history.back(), 400);
  } catch (err) {
    console.error('[status-flow] cancel failed:', err);
    showToast('Could not cancel', 'error');
    state.saving = false;
  }
}

async function doReopen() {
  if (state.saving) return;
  state.saving = true;
  try {
    await updateStatus(state.appointment.id, 'booked', '');
    showToast('Restored');
    setTimeout(() => history.back(), 400);
  } catch (err) {
    console.error('[status-flow] reopen failed:', err);
    showToast('Could not update', 'error');
    state.saving = false;
  }
}

function showMoveUI() {
  // Minimal for now: prompt for date and slot. Polish later.
  const newDate = prompt('New date (YYYY-MM-DD):', state.appointment.date);
  if (!newDate) return;
  const newSlot = prompt('New slot (HH:mm, e.g. 10:30):', state.appointment.slot);
  if (!newSlot) return;

  if (!/^\d{4}-\d{2}-\d{2}$/.test(newDate)) {
    showToast('Invalid date format', 'error');
    return;
  }
  if (!/^\d{2}:\d{2}$/.test(newSlot)) {
    showToast('Invalid slot format', 'error');
    return;
  }
  reschedule(state.appointment.id, newDate, newSlot);
}

async function reschedule(id, newDate, newSlot) {
  if (state.saving) return;
  state.saving = true;
  try {
    await rescheduleAppt(id, newDate, newSlot);
    showToast('Moved');
    setTimeout(() => history.back(), 400);
  } catch (err) {
    console.error('[status-flow] reschedule failed:', err);
    showToast('Could not move', 'error');
    state.saving = false;
  }
}

function renderError(msg) {
  const root = $('#appt-body');
  if (root) {
    root.innerHTML = `<div class="p-8 text-center text-[14px] text-ink-mute">${msg}</div>`;
  }
}