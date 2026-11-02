// ============================================================
// Day view
// ============================================================

import { esc } from './lib/format.js';
import { me } from './lib/auth-guards.js';
import { getActiveClinicId, getActiveClinic } from './lib/clinic-context.js';
import { subscribeForDay, updateStatus, softDelete, reschedule as rescheduleAppt } from './appointments.js';
import { createFromVisit, findPendingForPatient, supersede } from './followups.js';
import { create as createCall, listMergedPending, resolve as resolveCall } from './calls.js';
import { searchByName } from './patients.js';
import { generateSlots, isDayOpen } from './slot-grid.js';
import { todayISO, addDays, fmtDate, fmtSlot, isToday, isoToDate, intervalToDate } from './date-utils.js';
import { showToast } from './lib/toast.js';
import { checkSlotOccupancy, invalidateOccupancy } from './booking-policy.js';

const state = {
  dateISO: todayISO(),
  clinicId: null,
  clinic: null,
  schedule: null,
  appointments: [],
  pendingCalls: [],
  unsubscribe: null,
  activeAppt: null,
  activeCall: null,
  pendingFollowup: null,
  qcPatient: null // For Quick Add Call
};

const $ = (sel) => document.querySelector(sel);

export async function startDayView() {
  const m = me();
  if (!m) return;

  state.clinicId = getActiveClinicId();
  if (!state.clinicId) return;

  state.clinic = await getActiveClinic();
  state.schedule = await loadSchedule(state.clinicId);

  readQueryParams();
  wireNavButtons();
  wireDatePickers();
  wireRowModal();
  wireQuickCallModal();
  wireCallActionModal();
  
  renderHeader();
  renderGrid();
  loadCallsPanel(); // Load the right-side panel
  subscribe();
}

function readQueryParams() {
  const p = new URLSearchParams(location.search);
  const d = p.get('date');
  if (d) state.dateISO = d;
}

async function loadSchedule(clinicId) {
  const { doc, getDoc } = await import('https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js');
  const { db } = await import('./lib/firebase-init.js');
  try {
    const snap = await getDoc(doc(db, 'clinicSchedule', clinicId));
    if (!snap.exists()) return null;
    return snap.data();
  } catch { return null; }
}

function renderHeader() {
  const dateEl = $('#day-date');
  const subEl = $('#day-sub');

  if (dateEl) dateEl.textContent = fmtDate(state.dateISO);
  if (subEl) {
    const total = state.appointments.filter((a) => a.status !== 'cancelled').length;
    const seen = state.appointments.filter((a) => a.status === 'seen').length;
    subEl.textContent = total === 0 ? 'No appointments' : `${total} booked · ${seen} seen`;
  }

  const todayBtn = $('#day-today');
  if (todayBtn) todayBtn.classList.toggle('hidden', isToday(state.dateISO));

  const start = addDays(state.dateISO, -3);
  const days = [];
  for (let i = 0; i < 7; i++) days.push(addDays(start, i));

  const strip = $('#day-strip');
  if (strip) {
    strip.innerHTML = days.map(iso => {
      const isSelected = iso === state.dateISO;
      const isTodayDate = iso === todayISO();
      const d = isoToDate(iso);
      const dayName = ['SUN','MON','TUE','WED','THU','FRI','SAT'][d.getDay()];
      const dayNum = d.getDate();

      const cls = isSelected
        ? 'bg-ink text-white shadow-md'
        : isTodayDate
          ? 'bg-accent-soft text-accent'
          : 'bg-transparent text-ink-mute hover:bg-surface-hover hover:text-ink';

      return `
        <button type="button" data-day="${iso}"
          class="flex-1 flex flex-col items-center justify-center min-w-[55px] md:min-w-[60px] h-[52px] md:h-[56px] rounded-xl transition-all ${cls}">
          <span class="text-[9px] font-bold tracking-widest uppercase opacity-70">${dayName}</span>
          <span class="text-[15px] md:text-[16px] font-bold tnum leading-none mt-1">${dayNum}</span>
        </button>`;
    }).join('');

    strip.querySelectorAll('[data-day]').forEach(el => {
      el.addEventListener('click', () => goDate(el.getAttribute('data-day')));
    });

    const selectedEl = strip.querySelector('.bg-ink');
    if (selectedEl) {
      selectedEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'center' });
    }
  }
}

function renderGrid() {
  const tableRoot = $('#day-grid');
  const mobileRoot = $('#day-mobile-list');
  if (!tableRoot || !mobileRoot) return;

  if (!state.schedule) {
    tableRoot.innerHTML = `<tr><td colspan="5" class="p-10 text-center text-ink-mute">No schedule set up.</td></tr>`;
    mobileRoot.innerHTML = `<div class="p-10 text-center text-ink-mute">No schedule set up.</div>`;
    return;
  }

  if (!isDayOpen(state.schedule, state.dateISO)) {
    tableRoot.innerHTML = `<tr><td colspan="5" class="p-10 text-center text-ink-mute">Clinic is closed on this day.</td></tr>`;
    mobileRoot.innerHTML = `<div class="p-10 text-center text-ink-mute">Clinic is closed on this day.</div>`;
    return;
  }

  const slots = generateSlots(state.schedule);
  const grouped = groupBySlot(state.appointments);

  let tableHtml = '';
  let mobileHtml = '';

  slots.forEach(slot => {
    const appts = grouped[slot] || [];

    if (appts.length === 0) {
      tableHtml += `
        <tr class="hover:bg-surface-hover/30 transition-colors group cursor-pointer" data-empty-slot="${slot}">
          <td class="px-4 md:px-6 py-3 md:py-4 text-[13px] md:text-[14px] font-bold text-ink whitespace-nowrap">${fmtSlot(slot)}</td>
          <td colspan="4" class="px-4 md:px-6 py-3 md:py-4 text-[13px] md:text-[14px] text-ink-faint italic group-hover:text-accent">Click to book...</td>
        </tr>`;
      
      mobileHtml += `
        <div class="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover/30 transition-colors cursor-pointer border-b border-hairline last:border-0" data-empty-slot="${slot}">
          <div class="w-[60px] shrink-0 text-[13px] font-bold text-ink whitespace-nowrap">${fmtSlot(slot)}</div>
          <div class="flex-1 text-[13px] text-ink-faint italic">Click to book...</div>
        </div>`;
    } else {
      appts.forEach(a => {
        const status = a.status || 'booked';
        const isSeen = status === 'seen';
        const isCancelled = status === 'cancelled';

        const desktopActions = isCancelled
          ? `<button data-action="rebook" data-id="${a.id}" class="h-8 px-3 rounded-lg bg-red-500 hover:bg-red-600 text-white text-[11px] md:text-[12px] font-bold flex items-center gap-1.5 transition-colors shadow-sm whitespace-nowrap">
               <i class="bi bi-arrow-counterclockwise"></i> Re-book
             </button>`
          : isSeen
            ? `<span class="text-[11px] md:text-[13px] font-bold text-emerald-600 uppercase">Completed</span>`
            : `
              <div class="hidden md:flex flex-nowrap gap-2 justify-end">
                 <button data-action="seen" data-id="${a.id}" class="h-8 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[11px] md:text-[12px] font-bold flex items-center gap-1.5 transition-colors shadow-sm whitespace-nowrap">
                   <i class="bi bi-check-circle-fill"></i> Complete
                 </button>
                 <button data-action="reschedule" data-id="${a.id}" class="h-8 px-3 rounded-lg bg-orange-400 hover:bg-orange-500 text-white text-[11px] md:text-[12px] font-bold flex items-center gap-1.5 transition-colors shadow-sm whitespace-nowrap">
                   <i class="bi bi-clock-fill"></i> Reschedule
                 </button>
                 <button data-action="delete" data-id="${a.id}" class="h-8 px-3 rounded-lg bg-red-500 hover:bg-red-600 text-white text-[11px] md:text-[12px] font-bold flex items-center gap-1.5 transition-colors shadow-sm whitespace-nowrap">
                   <i class="bi bi-trash-fill"></i> Delete
                 </button>
              </div>`;

        tableHtml += `
          <tr class="hover:bg-surface-hover/30 transition-colors border-b border-hairline cursor-pointer group" data-appt-id="${a.id}">
            <td class="px-4 md:px-6 py-2.5 md:py-3 whitespace-nowrap text-[13px] font-bold text-ink ${isCancelled ? 'opacity-50' : ''}">
              ${fmtSlot(slot)} – ${fmtSlot(addSlot(slot, state.schedule.slotMinutes, a.durationSlots || 1))}
            </td>
            <td class="hidden md:table-cell px-2 py-3 whitespace-nowrap">
              <div class="flex gap-1 ${isCancelled ? 'opacity-50' : ''}">
                <span class="px-2 py-0.5 rounded bg-blue-500 text-white text-[9px] font-bold uppercase tracking-wider">${a.type === 'new' ? 'New' : 'F/U'}</span>
                <span class="px-2 py-0.5 rounded bg-pink-500 text-white text-[9px] font-bold uppercase tracking-wider">${a.mode || 'Visit'}</span>
              </div>
            </td>
            <td class="px-4 md:px-6 py-2.5 md:py-3 text-[14px] font-bold text-ink group-hover:text-accent transition-colors ${isCancelled ? 'opacity-50 line-through' : ''}">
              ${esc(a.patientName)}
            </td>
            <td class="hidden md:table-cell px-4 py-3 text-[13px] text-ink-mute whitespace-nowrap ${isCancelled ? 'opacity-50' : ''}">
              ${esc(a.patientPhone || '—')}
            </td>
            <td class="px-4 md:px-6 py-2.5 md:py-3 text-right">
               ${desktopActions}
            </td>
          </tr>`;

        mobileHtml += `
          <div class="flex items-center gap-3 px-4 py-3 hover:bg-surface-hover/30 transition-colors cursor-pointer group border-b border-hairline last:border-0 ${isSeen ? 'opacity-50 grayscale' : ''}" data-appt-id="${a.id}">
            <div class="w-[60px] shrink-0 text-[13px] font-bold text-ink whitespace-nowrap ${isCancelled ? 'opacity-50' : ''}">
              ${fmtSlot(slot)}
            </div>
            <div class="flex-1 min-w-0 text-[13.5px] font-bold text-ink group-hover:text-accent transition-colors truncate ${isCancelled ? 'opacity-50 line-through' : ''}">
              ${esc(a.patientName)}
            </div>
            <div class="shrink-0 flex items-center gap-1">
               ${isCancelled 
                 ? `<button data-action="rebook" data-id="${a.id}" class="px-2 py-1 rounded bg-red-500 text-white text-[9px] font-bold uppercase tracking-wider shadow-sm hover:bg-red-600 transition-colors">Re-book</button>` 
                 : isSeen
                   ? `<span class="px-2 py-1 rounded bg-emerald-100 text-emerald-700 text-[9px] font-bold uppercase tracking-wider flex items-center gap-1"><i class="bi bi-check-circle-fill"></i> Done</span>`
                   : `<span class="px-1.5 py-0.5 rounded bg-blue-500 text-white text-[9px] font-bold uppercase tracking-wider">${a.type === 'new' ? 'N' : 'F'}</span>
                      <span class="px-1.5 py-0.5 rounded bg-pink-500 text-white text-[9px] font-bold uppercase tracking-wider">${a.mode === 'call' ? 'C' : 'V'}</span>`}
            </div>
          </div>`;
      });
    }
  });

  tableRoot.innerHTML = tableHtml;
  mobileRoot.innerHTML = mobileHtml;

  [tableRoot, mobileRoot].forEach(root => {
    root.querySelectorAll('[data-empty-slot]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onEmptySlotClick(el.getAttribute('data-empty-slot'));
      });
    });

    root.querySelectorAll('[data-appt-id]').forEach(el => {
      el.addEventListener('click', (e) => {
        if (e.target.closest('[data-action]')) return;
        const id = el.getAttribute('data-appt-id');
        const appt = state.appointments.find(a => a.id === id);
        if (!appt) return;

        if (window.innerWidth < 768) {
          openRowModal(appt);
        } else {
          location.href = `/appointment?id=${encodeURIComponent(id)}`;
        }
      });
    });

    root.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', async (e) => {
        e.stopPropagation();
        const action = el.getAttribute('data-action');
        const id = el.getAttribute('data-id');
        await handleRowAction(action, id);
      });
    });
  });
}

// ============================================================
// CALLS PANEL (Right Side)
// ============================================================

async function loadCallsPanel() {
  try {
    state.pendingCalls = await listMergedPending(state.clinicId);
    renderCallsPanel();
  } catch (err) {
    console.error('[day-view] load calls failed', err);
  }
}

function renderCallsPanel() {
  const root = $('#day-calls-list');
  const countEl = $('#calls-panel-count');
  if (!root) return;

  if (countEl) {
    countEl.textContent = state.pendingCalls.length;
    if (state.pendingCalls.length > 0) countEl.classList.remove('hidden');
    else countEl.classList.add('hidden');
  }

  if (state.pendingCalls.length === 0) {
    root.innerHTML = `<div class="p-8 text-center text-ink-faint text-[13px]">No pending calls.</div>`;
    return;
  }

  root.innerHTML = state.pendingCalls.map(c => {
    const isProblem = c._type === 'problem';
    let timeStr, dateStr;
    
    if (isProblem) {
      const cDate = new Date(c.createdAt.seconds * 1000);
      timeStr = `${String(cDate.getHours()).padStart(2,'0')}:${String(cDate.getMinutes()).padStart(2,'0')}`;
      dateStr = `${String(cDate.getDate()).padStart(2,'0')} ${['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][cDate.getMonth()]}`;
    } else {
      timeStr = fmtSlot(c.slot);
      dateStr = fmtDate(c.date);
    }

    return `
      <div class="flex items-start gap-3 px-4 py-3 hover:bg-surface-hover cursor-pointer transition-colors border-b border-hairline/50 last:border-b-0" data-call-id="${c.id}" data-type="${c._type}">
        <div class="w-[50px] shrink-0 pt-0.5">
          <div class="text-[12px] font-bold text-ink tnum">${timeStr}</div>
          <div class="text-[10px] text-ink-faint tnum">${dateStr}</div>
        </div>
        <div class="flex-1 min-w-0">
          <div class="text-[13.5px] font-bold text-ink truncate">${esc(c.patientName)}</div>
          <div class="text-[11px] text-ink-mute truncate">${esc(isProblem ? c.reason || 'No reason' : 'Scheduled Call')}</div>
        </div>
        <div class="shrink-0">
          <span class="px-1.5 py-0.5 rounded text-[9px] font-bold uppercase tracking-wider ${
            isProblem ? 'bg-pink-100 text-pink-700' : 'bg-blue-100 text-blue-700'
          }">${isProblem ? 'P' : 'S'}</span>
        </div>
      </div>`;
  }).join('');

  root.querySelectorAll('[data-call-id]').forEach(el => {
    el.addEventListener('click', () => {
      const type = el.getAttribute('data-type');
      const id = el.getAttribute('data-call-id');
      const call = state.pendingCalls.find(c => c.id === id && c._type === type);
      if (call) openCallActionModal(call);
    });
  });
}

// ============================================================
// CALL ACTION MODAL
// ============================================================

function openCallActionModal(call) {
  state.activeCall = call;
  const isProblem = call._type === 'problem';

  $('#ca-name').textContent = call.patientName || 'Patient';
  $('#ca-reason').textContent = isProblem ? (call.reason || 'No reason') : `Scheduled for ${call.date} at ${call.slot}`;
  $('#ca-type').textContent = isProblem ? 'Problem Call' : 'Scheduled Call';
  $('#ca-type').className = `px-2 py-0.5 rounded text-white text-[9px] font-bold uppercase ${isProblem ? 'bg-pink-500' : 'bg-blue-500'}`;

  $('#ca-backdrop').classList.remove('hidden');
  $('#ca-modal').classList.remove('hidden');
  $('#ca-modal').classList.add('flex');
}

function closeCallActionModal() {
  $('#ca-backdrop').classList.add('hidden');
  $('#ca-modal').classList.add('hidden');
  $('#ca-modal').classList.remove('flex');
  state.activeCall = null;
}

function wireCallActionModal() {
  $('#ca-backdrop')?.addEventListener('click', closeCallActionModal);
  $('#ca-close')?.addEventListener('click', closeCallActionModal);

  $('#ca-btn-complete')?.addEventListener('click', async () => {
    if (!state.activeCall) return;
    try {
      if (state.activeCall._type === 'problem') {
        await resolveCall(state.activeCall.id, 'completed', 'Marked from Day View');
      } else {
        await updateStatus(state.activeCall.id, 'seen', '');
        invalidateOccupancy(state.clinicId, state.activeCall.date);
      }
      showToast('Call completed', 'success');
      closeCallActionModal();
      loadCallsPanel();
    } catch (err) { showToast('Could not complete', 'error'); }
  });

  $('#ca-btn-convert')?.addEventListener('click', async () => {
    if (!state.activeCall) return;
    closeCallActionModal();
    // Redirect to book page with patient prefilled
    location.href = `/book?patientId=${state.activeCall.patientId}`;
  });

  $('#ca-btn-cancel')?.addEventListener('click', async () => {
    if (!state.activeCall) return;
    if (!confirm('Are you sure you want to cancel this call?')) return;
    
    try {
      if (state.activeCall._type === 'problem') {
        await resolveCall(state.activeCall.id, 'add_to_appointment', 'Cancelled');
      } else {
        await updateStatus(state.activeCall.id, 'cancelled', 'clinic');
        invalidateOccupancy(state.clinicId, state.activeCall.date);
      }
      showToast('Call cancelled', 'success');
      closeCallActionModal();
      loadCallsPanel();
    } catch (err) { showToast('Could not cancel', 'error'); }
  });
}

// ============================================================
// QUICK ADD CALL MODAL
// ============================================================
function wireQuickCallModal() {
  const btn = $('#quick-add-call-btn');
  const backdrop = $('#qc-backdrop');
  const modal = $('#qc-modal');
  const closeBtn = $('#qc-close');
  const saveBtn = $('#qc-save');
  const searchIn = $('#qc-name');
  const resultsEl = $('#qc-results');
  const phoneIn = $('#qc-phone');

  if (!btn || !backdrop || !modal) return;

  const close = () => {
    backdrop.classList.add('hidden');
    modal.classList.add('hidden');
    modal.classList.remove('flex');
    searchIn.value = '';
    phoneIn.value = '';
    $('#qc-reason').value = '';
    resultsEl.innerHTML = '';
    state.qcPatient = null;
  };

  btn.addEventListener('click', () => {
    backdrop.classList.remove('hidden');
    modal.classList.remove('hidden');
    modal.classList.add('flex');
    setTimeout(() => searchIn.focus(), 150);
  });

  closeBtn?.addEventListener('click', close);
  backdrop?.addEventListener('click', close);

  let timer = null;
  searchIn?.addEventListener('input', (e) => {
    clearTimeout(timer);
    const q = e.target.value.trim();
    if (q.length < 2) { resultsEl.innerHTML = ''; return; }
    timer = setTimeout(async () => {
      const byName = await searchByName(state.clinicId, q, 5);
      if (byName.length > 0) {
        resultsEl.innerHTML = byName.map(p => `
          <div data-pid="${p.id}" data-pname="${esc(p.name)}" data-pphone="${esc(p.phone || '')}" class="px-3 py-2 hover:bg-surface-hover cursor-pointer border-b border-hairline last:border-0 text-[13px]">
            <div class="font-bold text-ink">${esc(p.name)}</div>
            ${p.phone ? `<div class="text-[11px] text-ink-mute">${esc(p.phone)}</div>` : ''}
          </div>`).join('');
      } else {
        resultsEl.innerHTML = '';
      }
    }, 250);
  });

  resultsEl?.addEventListener('click', (e) => {
    const row = e.target.closest('[data-pid]');
    if (!row) return;
    state.qcPatient = {
      id: row.getAttribute('data-pid'),
      name: row.getAttribute('data-pname'),
      phone: row.getAttribute('data-pphone')
    };
    searchIn.value = state.qcPatient.name;
    phoneIn.value = state.qcPatient.phone;
    resultsEl.innerHTML = '';
  });

  saveBtn?.addEventListener('click', async () => {
    const name = searchIn.value.trim();
    const phone = phoneIn.value.trim();
    const reason = $('#qc-reason').value.trim();

    if (!name || !reason) {
      showToast('Name and reason are required', 'error');
      return;
    }

    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    try {
      await createCall({
        clinicId: state.clinicId,
        patientId: state.qcPatient ? state.qcPatient.id : null,
        patientName: name,
        patientPhone: phone,
        reason: reason
      });
      showToast('Call added', 'success');
      close();
      loadCallsPanel(); // Refresh right panel
    } catch (err) {
      console.error(err);
      showToast('Could not save call', 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save Call';
    }
  });
}

// ============================================================
// EXISTING APPOINTMENT MODAL (Row Actions)
// ============================================================

async function handleRowAction(action, id) {
  const appt = state.appointments.find(a => a.id === id);
  if (!appt) return;

  if (action === 'rebook') {
    location.href = `/book?date=${encodeURIComponent(state.dateISO)}&slot=${encodeURIComponent(appt.slot)}`;
    return;
  }

  if (action === 'seen' || action === 'reschedule') {
    openRowModal(appt);
    if (action === 'reschedule') {
      $('#ra-panel-actions')?.classList.add('hidden');
      $('#ra-panel-reschedule')?.classList.remove('hidden');
      populateRescheduleSlots();
    } else {
      $('#ra-panel-actions')?.classList.add('hidden');
      $('#ra-panel-followup')?.classList.remove('hidden');
      $('#ra-fu-date').value = '';
      $('#ra-fu-interval').value = '';
      
      try {
        state.pendingFollowup = await findPendingForPatient(state.clinicId, appt.patientId);
        const note = $('#ra-followup-note');
        if (state.pendingFollowup && note) {
          note.classList.remove('hidden');
          note.className = 'bg-blue-50 text-[12px] text-blue-700 border border-blue-200 p-3 rounded-lg mb-4';
          note.innerHTML = `Patient has an existing follow-up scheduled for <strong>${fmtDate(state.pendingFollowup.dueDate)}</strong>.`;
        } else if (note) {
          note.classList.add('hidden');
        }
      } catch (err) {}
    }
    return;
  }

  if (action === 'delete') {
    if (!confirm('Are you sure you want to delete this appointment?')) return;
    try {
      await softDelete(id);
      invalidateOccupancy(state.clinicId, appt.date);
      showToast('Appointment deleted', 'success');
    } catch (err) {
      showToast('Failed to delete', 'error');
    }
  }
}

function addSlot(slot, mins, n) {
  const [h, m] = slot.split(':').map(Number);
  const total = h * 60 + m + (mins * n);
  const hh = String(Math.floor(total / 60)).padStart(2, '0');
  const mm = String(total % 60).padStart(2, '0');
  return `${hh}:${mm}`;
}

function groupBySlot(appointments) {
  const g = {};
  for (const a of appointments) {
    if (!a.slot) continue;
    if (!g[a.slot]) g[a.slot] = [];
    g[a.slot].push(a);
  }
  return g;
}

function subscribe() {
  if (state.unsubscribe) state.unsubscribe();
  state.unsubscribe = subscribeForDay(
    state.clinicId,
    state.dateISO,
    (rows) => {
      state.appointments = rows;
      renderHeader();
      renderGrid();
    },
    (err) => console.error(err)
  );
}

function wireNavButtons() {
  const prev = $('#day-prev');
  const next = $('#day-next');
  const today = $('#day-today');

  if (prev) prev.addEventListener('click', () => goDate(addDays(state.dateISO, -1)));
  if (next) next.addEventListener('click', () => goDate(addDays(state.dateISO, 1)));
  if (today) today.addEventListener('click', () => goDate(todayISO()));
}

function wireDatePickers() {
  const dBtn = $('#desktop-date-picker-btn');
  const dInput = $('#desktop-date-picker-input');
  if (dBtn && dInput) {
    dBtn.addEventListener('click', () => {
      dInput.value = state.dateISO;
      try { dInput.showPicker && dInput.showPicker(); } catch {}
    });
    dInput.addEventListener('change', (e) => {
      if (e.target.value) goDate(e.target.value);
    });
  }
}

function goDate(iso) {
  state.dateISO = iso;
  const url = new URL(location.href);
  url.searchParams.set('date', iso);
  history.replaceState(null, '', url);
  renderHeader();
  renderGrid();
  subscribe();
}

function onEmptySlotClick(slot) {
  location.href = `/book?date=${encodeURIComponent(state.dateISO)}&slot=${encodeURIComponent(slot)}`;
}

// ============================================================
// ROW ACTION MODAL
// ============================================================

function openRowModal(appt) {
  state.activeAppt = appt;

  const status = appt.status || 'booked';
  const isSeen = status === 'seen';
  const isCancelled = status === 'cancelled';

  $('#ra-name').textContent = appt.patientName || 'Patient';
  $('#ra-time').textContent = `${fmtSlot(appt.slot)} - ${fmtSlot(addSlot(appt.slot, state.schedule.slotMinutes, appt.durationSlots || 1))}`;
  $('#ra-type').textContent = appt.type === 'new' ? 'New' : 'Followup';
  $('#ra-mode').textContent = appt.mode || 'Visit';

  const btnComplete = $('#ra-btn-complete');
  const btnReschedule = $('#ra-btn-reschedule');
  const btnCancel = $('#ra-btn-cancel');

  if (isSeen || isCancelled) {
    btnComplete.disabled = true;
    btnComplete.classList.add('opacity-40');
    btnReschedule.disabled = true;
    btnReschedule.classList.add('opacity-40');
    btnCancel.disabled = true;
    btnCancel.classList.add('opacity-40');
  } else {
    btnComplete.disabled = false;
    btnComplete.classList.remove('opacity-40');
    btnReschedule.disabled = false;
    btnReschedule.classList.remove('opacity-40');
    btnCancel.disabled = false;
    btnCancel.classList.remove('opacity-40');
  }

  $('#ra-panel-actions').classList.remove('hidden');
  $('#ra-panel-followup').classList.add('hidden');
  $('#ra-panel-reschedule').classList.add('hidden');
  $('#ra-panel-cancel').classList.add('hidden');

  const backdrop = $('#ra-backdrop');
  const modal = $('#ra-modal');
  backdrop.classList.remove('hidden');
  modal.classList.remove('hidden');
  modal.classList.add('flex');

  setTimeout(() => {
    if (!btnComplete.disabled) btnComplete.focus();
    else btnCancel.focus();
      }, 150);
}

function closeRowModal() {
  const backdrop = $('#ra-backdrop');
  const modal = $('#ra-modal');
  backdrop.classList.add('hidden');
  modal.classList.add('hidden');
  modal.classList.remove('flex');
  state.activeAppt = null;
  state.pendingFollowup = null;
}

function wireRowModal() {
  $('#ra-backdrop')?.addEventListener('click', closeRowModal);
  $('#ra-close')?.addEventListener('click', closeRowModal);

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.activeAppt) closeRowModal();
  });

  $('#ra-name')?.addEventListener('click', () => {
    if (state.activeAppt) {
      const pid = state.activeAppt.patientId;
      closeRowModal();
      location.href = `/patient?id=${encodeURIComponent(pid)}`;
    }
  });

  ['#ra-res-date', '#ra-fu-date'].forEach(sel => {
    const el = $(sel);
    if (!el) return;
    el.addEventListener('click', () => {
      try { el.showPicker && el.showPicker(); } catch {}
    });
  });

  $('#ra-btn-complete')?.addEventListener('click', async () => {
    const appt = state.activeAppt;
    if (!appt) return;

    $('#ra-panel-actions').classList.add('hidden');
    $('#ra-panel-followup').classList.remove('hidden');

    $('#ra-fu-date').value = '';
    $('#ra-fu-interval').value = '';

    try {
      state.pendingFollowup = await findPendingForPatient(state.clinicId, appt.patientId);
      const note = $('#ra-followup-note');
      if (state.pendingFollowup && note) {
        note.classList.remove('hidden');
        note.className = 'bg-blue-50 text-[12px] text-blue-700 border border-blue-200 p-3 rounded-lg mb-4';
        note.innerHTML = `Patient has an existing follow-up scheduled for <strong>${fmtDate(state.pendingFollowup.dueDate)}</strong>.`;
      } else if (note) {
        note.classList.add('hidden');
      }
    } catch (err) {}
  });

  $('#ra-btn-reschedule')?.addEventListener('click', () => {
    $('#ra-panel-actions').classList.add('hidden');
    $('#ra-panel-reschedule').classList.remove('hidden');
    populateRescheduleSlots();
  });

  $('#ra-btn-cancel')?.addEventListener('click', () => {
    $('#ra-panel-actions').classList.add('hidden');
    $('#ra-panel-cancel').classList.remove('hidden');
  });

  $('#ra-res-date')?.addEventListener('change', () => {
    populateRescheduleSlots();
  });

  $('#ra-followup-save')?.addEventListener('click', async () => {
    const appt = state.activeAppt;
    if (!appt) return;

    const pickedDate = $('#ra-fu-date').value;
    const pickedInterval = $('#ra-fu-interval').value;

    let dueDate = null;
    let days = null;

    if (pickedDate) {
      dueDate = pickedDate;
    } else if (pickedInterval) {
      days = Number(pickedInterval);
      dueDate = intervalToDate(appt.date, days);
    }

    // THE BULLETPROOF WARNING
    if (!dueDate) {
      const msg = state.pendingFollowup 
        ? `No new date picked. The existing follow-up (${fmtDate(state.pendingFollowup.dueDate)}) will remain as is. Continue?`
        : `No follow-up date selected. Are you sure you want to mark this patient as complete without a follow-up?`;
      
      const proceed = confirm(msg);
      if (!proceed) return; 
    }

    try {
      await updateStatus(appt.id, 'seen', '');
      invalidateOccupancy(state.clinicId, appt.date);

      if (dueDate) {
        if (state.pendingFollowup) {
          await supersede(
            state.pendingFollowup.id, 
            `Visited early on ${appt.date}`, 
            dueDate
          );
        }
        await createFromVisit(appt, days || null, dueDate);
      }

      showToast('Marked as complete', 'success');
      closeRowModal();
    } catch (err) {
      console.error(err);
      showToast('Could not complete', 'error');
    }
  });

  $('#ra-followup-back')?.addEventListener('click', () => {
    $('#ra-panel-followup').classList.add('hidden');
    $('#ra-panel-actions').classList.remove('hidden');
  });

  $('#ra-res-back')?.addEventListener('click', () => {
    $('#ra-panel-reschedule').classList.add('hidden');
    $('#ra-panel-actions').classList.remove('hidden');
  });

  $('#ra-res-save')?.addEventListener('click', async () => {
    const appt = state.activeAppt;
    if (!appt) return;

    const newDate = $('#ra-res-date').value;
    const newSlot = $('#ra-res-slot').value;
    if (!newDate || !newSlot) { showToast('Pick date and slot', 'error'); return; }

    try {
      const occ = await checkSlotOccupancy({
        clinicId: state.clinicId,
        dateISO: newDate,
        slot: newSlot,
        excludeApptId: appt.id
      });

      if (occ.count > 0) {
        const who = occ.conflict?.patientName || 'another patient';
        const proceed = confirm(
          `This slot already has ${occ.count} booking${occ.count > 1 ? 's' : ''} (${who}). Move anyway?`
        );
        if (!proceed) return;
      }

      await rescheduleAppt(appt.id, newDate, newSlot);
      invalidateOccupancy(state.clinicId, appt.date);
      invalidateOccupancy(state.clinicId, newDate);
      showToast('Appointment moved', 'success');
      closeRowModal();
    } catch (err) {
      console.error(err);
      showToast('Could not move', 'error');
    }
  });

  document.querySelectorAll('#ra-panel-cancel [data-reason]').forEach(el => {
    el.addEventListener('click', async () => {
      const reason = el.getAttribute('data-reason');
      const appt = state.activeAppt;
      try {
        await updateStatus(appt.id, 'cancelled', reason);
        invalidateOccupancy(state.clinicId, appt.date);
        showToast('Appointment cancelled', 'success');
        closeRowModal();
      } catch (err) {
        showToast('Could not cancel', 'error');
      }
    });
  });

  $('#ra-cancel-back')?.addEventListener('click', () => {
    $('#ra-panel-cancel').classList.add('hidden');
    $('#ra-panel-actions').classList.remove('hidden');
  });
}

async function populateRescheduleSlots() {
  const appt = state.activeAppt;
  if (!appt) return;

  if (!state.schedule) {
    showToast('Could not load schedule', 'error');
    return;
  }

  const dateInput = $('#ra-res-date');
  const slotSelect = $('#ra-res-slot');
  if (!dateInput || !slotSelect) return;

  if (!dateInput.value) dateInput.value = appt.date;

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