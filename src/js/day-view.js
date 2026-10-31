// ============================================================
// Day view
// ============================================================

import { me } from './lib/auth-guards.js';
import { getActiveClinicId, getActiveClinic } from './lib/clinic-context.js';
import { subscribeForDay, updateStatus, softDelete } from './appointments.js';
import { generateSlots, isDayOpen } from './slot-grid.js';
import { todayISO, addDays, fmtDate, fmtSlot, isToday, isoToDate } from './date-utils.js';
import { showToast } from './lib/toast.js';

const state = {
  dateISO: todayISO(),
  clinicId: null,
  clinic: null,
  schedule: null,
  appointments: [],
  unsubscribe: null
};

const $ = (sel) => document.querySelector(sel);

function esc(s) {
  return String(s == null ? '' : s)
    .split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;')
    .split('"').join('&quot;').split("'").join('&#39;');
}

export async function startDayView() {
  const m = me();
  if (!m) return;

  state.clinicId = getActiveClinicId();
  if (!state.clinicId) return;

  state.clinic = await getActiveClinic();
  state.schedule = await loadSchedule(state.clinicId);

  readQueryParams();
  wireNavButtons();
  renderHeader();
  renderGrid();
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
  if (todayBtn) todayBtn.hidden = isToday(state.dateISO);

  const today = todayISO();
  const start = addDays(state.dateISO, -3);
  const days = [];
  for (let i = 0; i < 7; i++) days.push(addDays(start, i));

  const strip = $('#day-strip');
  if (strip) {
    strip.innerHTML = days.map(iso => {
      const isSelected = iso === state.dateISO;
      const isTodayDate = iso === today;
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
          class="flex-1 flex flex-col items-center justify-center min-w-[60px] h-[56px] rounded-xl transition-all ${cls}">
          <span class="text-[9px] font-bold tracking-widest uppercase opacity-70">${dayName}</span>
          <span class="text-[16px] font-bold tnum leading-none mt-1">${dayNum}</span>
        </button>`;
    }).join('');

    strip.querySelectorAll('[data-day]').forEach(el => {
      el.addEventListener('click', () => goDate(el.getAttribute('data-day')));
    });
  }
}

function renderGrid() {
  const root = $('#day-grid');
  if (!root) return;

  if (!state.schedule) {
    root.innerHTML = `<tr><td colspan="3" class="p-10 text-center text-ink-mute">No schedule set up.</td></tr>`;
    return;
  }

  if (!isDayOpen(state.schedule, state.dateISO)) {
    root.innerHTML = `<tr><td colspan="3" class="p-10 text-center text-ink-mute">Clinic is closed on this day.</td></tr>`;
    return;
  }

  const slots = generateSlots(state.schedule);
  const grouped = groupBySlot(state.appointments);

  root.innerHTML = slots.map(slot => {
    const appts = grouped[slot] || [];
    
    if (appts.length === 0) {
      return `
        <tr class="hover:bg-surface-hover/30 transition-colors group cursor-pointer" data-empty-slot="${slot}">
          <td class="px-6 py-4 text-[14px] font-bold text-ink">${fmtSlot(slot)}</td>
          <td class="px-6 py-4 text-[14px] text-ink-faint italic group-hover:text-accent">Click to book...</td>
          <td class="px-6 py-4"></td>
        </tr>`;
    }

    return appts.map(a => {
      const status = a.status || 'booked';
      const isSeen = status === 'seen';
      const isCancelled = status === 'cancelled';
      
      const actionHtml = isCancelled 
        ? `<span class="text-[13px] font-bold text-red-500 uppercase">Cancelled</span>`
        : isSeen 
          ? `<span class="text-[13px] font-bold text-emerald-600 uppercase">Completed</span>`
          : `
            <div class="flex gap-2">
               <button data-action="seen" data-id="${a.id}" class="h-8 px-3 rounded-lg bg-emerald-500 hover:bg-emerald-600 text-white text-[12px] font-bold flex items-center gap-1.5 transition-colors shadow-sm">
                 <i class="bi bi-check-circle-fill"></i> Complete
               </button>
               <button data-action="reschedule" data-id="${a.id}" class="h-8 px-3 rounded-lg bg-orange-400 hover:bg-orange-500 text-white text-[12px] font-bold flex items-center gap-1.5 transition-colors shadow-sm">
                 <i class="bi bi-clock-fill"></i> Reschedule
               </button>
               <button data-action="delete" data-id="${a.id}" class="h-8 px-3 rounded-lg bg-red-500 hover:bg-red-600 text-white text-[12px] font-bold flex items-center gap-1.5 transition-colors shadow-sm">
                 <i class="bi bi-trash-fill"></i> Delete
               </button>
            </div>`;

      return `
        <tr class="hover:bg-surface-hover/30 transition-colors border-b border-hairline">
          <td class="px-6 py-4">
             <div class="text-[14px] font-bold text-ink">${fmtSlot(slot)} - ${fmtSlot(addSlot(slot, state.schedule.slotMinutes, a.durationSlots || 1))}</div>
             <div class="flex gap-1 mt-1.5">
               <span class="px-2 py-0.5 rounded bg-blue-500 text-white text-[10px] font-bold uppercase">${a.type === 'new' ? 'New' : 'Followup'}</span>
               <span class="px-2 py-0.5 rounded bg-pink-500 text-white text-[10px] font-bold uppercase">${a.mode || 'Visit'}</span>
             </div>
          </td>
          <td class="px-6 py-4">
             <div class="text-[15px] font-bold text-ink cursor-pointer hover:underline" data-patient-id="${a.patientId}">${esc(a.patientName)}</div>
             <div class="text-[13px] text-ink-mute mt-0.5">${esc(a.patientPhone || '')}</div>
          </td>
          <td class="px-6 py-4">${actionHtml}</td>
        </tr>`;
    }).join('');
  }).join('');

  root.querySelectorAll('[data-empty-slot]').forEach(el => {
    el.addEventListener('click', () => onEmptySlotClick(el.getAttribute('data-empty-slot')));
  });

  root.querySelectorAll('[data-patient-id]').forEach(el => {
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      location.href = `/patient?id=${encodeURIComponent(el.getAttribute('data-patient-id'))}`;
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
}

async function handleRowAction(action, id) {
  if (action === 'seen') {
    if (!confirm('Mark this appointment as Complete?')) return;
    try {
      await updateStatus(id, 'seen', '');
      showToast('Appointment completed');
    } catch (err) { showToast('Failed to update', 'error'); }
  }
  
  if (action === 'delete') {
    if (!confirm('Are you sure you want to delete this appointment?')) return;
    try {
      await softDelete(id);
      showToast('Appointment deleted');
    } catch (err) { showToast('Failed to delete', 'error'); }
  }

  if (action === 'reschedule') {
    location.href = `/appointment?id=${id}`;
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
