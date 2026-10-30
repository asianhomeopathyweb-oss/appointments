// ============================================================
// Booking flow
//
// Controller for /book. Handles:
//   - Patient search (existing) and creation (new)
//   - Slot grid for the chosen date + clinic
//   - Type (new / follow-up) and mode (visit / call) toggles
//   - Double-book warning
//   - Save -> create appointment -> redirect to /day
//
// URL params: ?date=YYYY-MM-DD&slot=HH:mm&patientId=xxx
// ============================================================

import { me } from './lib/auth-guards.js';
import { getActiveClinicId, getActiveClinic } from './lib/clinic-context.js';
import { searchByName, searchByPhone, create as createPatient, get as getPatient, findExact } from './patients.js';
import { create as createAppointment, listForDay } from './appointments.js';
import { checkSlot, slotsForType, fitsInGrid } from './booking-policy.js';
import { generateSlots, isDayOpen } from './slot-grid.js';
import { todayISO, fmtDate, fmtSlot } from './date-utils.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './lib/firebase-init.js';
import { showToast } from './lib/toast.js';

const $ = (sel) => document.querySelector(sel);

const state = {
  clinicId: null,
  clinic: null,
  schedule: null,
  dateISO: todayISO(),
  slot: null,
  slots: [],
  existingBySlot: {},
  patient: null,
  type: 'followup',
  mode: 'visit',
  saving: false
};

// ---------- entry ----------
export async function startBookingFlow() {
  const m = me();
  if (!m) return;

  state.clinicId = getActiveClinicId();
  if (!state.clinicId) {
    showToast('No clinic available', 'error');
    return;
  }
  state.clinic = await getActiveClinic();
  state.schedule = await loadSchedule(state.clinicId);

  await readQueryParams();
  wireEvents();
  renderHeader();
  renderSlotGrid();
  await refreshExisting();
  renderSummary();
}

// ---------- schedule ----------
async function loadSchedule(clinicId) {
  try {
    const snap = await getDoc(doc(db, 'clinicSchedule', clinicId));
    if (!snap.exists()) return null;
    return snap.data();
  } catch (err) {
    console.error('[booking-flow] schedule fetch failed:', err);
    return null;
  }
}

// ---------- query params ----------
async function readQueryParams() {
  const p = new URLSearchParams(location.search);
  const d = p.get('date');
  const s = p.get('slot');
  const pid = p.get('patientId');
  if (d) state.dateISO = d;
  if (s) state.slot = s;
  if (pid) {
    try {
      const patient = await getPatient(pid);
      if (patient) {
        state.patient = {
          id: patient.id,
          name: patient.name,
          phone: patient.phone || ''
        };
        const input = $('#patient-search');
        if (input) input.value = state.patient.name;
      }
    } catch (err) {
      console.error('[booking-flow] patient prefill failed:', err);
    }
  }
}

// ---------- render: header ----------
function renderHeader() {
  const dateEl = $('#book-date');
  const clinicEl = $('#book-clinic');
  if (dateEl) dateEl.textContent = fmtDate(state.dateISO);
  if (clinicEl && state.clinic) clinicEl.textContent = state.clinic.name;
}

// ---------- render: slot grid ----------
function renderSlotGrid() {
  const root = $('#book-slots');
  if (!root) return;

  if (!state.schedule) {
    root.innerHTML = `<div class="p-6 text-center text-[13px] text-ink-mute">No schedule set up for this clinic.</div>`;
    return;
  }
  if (!isDayOpen(state.schedule, state.dateISO)) {
    root.innerHTML = `<div class="p-6 text-center text-[13px] text-ink-mute">Clinic is closed on this day.</div>`;
    return;
  }

  state.slots = generateSlots(state.schedule);
  if (state.slots.length === 0) {
    root.innerHTML = `<div class="p-6 text-center text-[13px] text-ink-mute">No slots available.</div>`;
    return;
  }

  const html = state.slots.map((s) => {
    const selected = s === state.slot;
    const count = state.existingBySlot[s] || 0;
    const busy = count > 0;
    const base = 'h-9 rounded-lg text-[12.5px] tnum border transition-colors';
    const cls = selected
      ? 'bg-accent text-white border-accent font-medium'
      : busy
        ? 'bg-surface-press text-ink-mute border-hairline hover:border-accent'
        : 'bg-white text-ink border-hairline hover:border-accent';
    const badge = busy ? `<span class="ml-1 text-[10px] opacity-70">+${count}</span>` : '';
    return `<button type="button" data-slot="${s}" class="${base} ${cls}">${fmtSlot(s)}${badge}</button>`;
  }).join('');

  root.innerHTML = `<div class="grid grid-cols-3 sm:grid-cols-4 gap-1.5">${html}</div>`;

  root.querySelectorAll('[data-slot]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.slot = btn.getAttribute('data-slot');
      renderSlotGrid();
      renderSummary();
    });
  });
}

// ---------- render: summary ----------
function renderSummary() {
  const patientEl = $('#summary-patient');
  const slotEl = $('#summary-slot');
  const typeEl = $('#summary-type');
  const modeEl = $('#summary-mode');
  const warnEl = $('#book-warn');

  if (patientEl) patientEl.textContent = state.patient ? state.patient.name : 'No patient selected';
  if (slotEl) slotEl.textContent = state.slot ? fmtSlot(state.slot) : 'No slot selected';
  if (typeEl) typeEl.textContent = state.type === 'new' ? 'New patient' : 'Follow-up';
  if (modeEl) modeEl.textContent = state.mode === 'call' ? 'Call' : 'Visit';

  if (warnEl) {
    if (!state.slot) { warnEl.hidden = true; }
    else {
      const existing = state.existingBySlot[state.slot] || 0;
      const check = checkSlot({ existingCount: existing, source: 'frontdesk' });
      if (check.warn) {
        warnEl.textContent = check.warn;
        warnEl.hidden = false;
      } else {
        warnEl.hidden = true;
      }
    }
  }

  const saveBtn = $('#book-save');
  if (saveBtn) {
    const ready = state.patient && state.slot && !state.saving;
    saveBtn.disabled = !ready;
    saveBtn.textContent = state.saving ? 'Saving...' : 'Book appointment';
  }
}

// ---------- existing bookings for a date ----------
async function refreshExisting() {
  try {
    const rows = await listForDay(state.clinicId, state.dateISO);
    const g = {};
    for (const r of rows) {
      if (r.status === 'cancelled') continue;
      g[r.slot] = (g[r.slot] || 0) + 1;
    }
    state.existingBySlot = g;
  } catch (err) {
    console.error('[booking-flow] load existing failed:', err);
    state.existingBySlot = {};
  }
}

// ---------- events ----------
function wireEvents() {
  const searchInput = $('#patient-search');
  const results = $('#patient-results');
  const createBtn = $('#patient-create');
  const saveBtn = $('#book-save');
  const cancelBtn = $('#book-cancel');

  let searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim();
      if (q.length < 2) { results.innerHTML = ''; return; }
      searchTimer = setTimeout(() => runSearch(q), 250);
    });
  }

  if (results) {
    results.addEventListener('click', (e) => {
      const row = e.target.closest('[data-patient-id]');
      if (!row) return;
      state.patient = {
        id: row.getAttribute('data-patient-id'),
        name: row.getAttribute('data-patient-name'),
        phone: row.getAttribute('data-patient-phone')
      };
      if (searchInput) searchInput.value = state.patient.name;
      results.innerHTML = '';
      renderSummary();
    });
  }

  if (createBtn) {
    createBtn.addEventListener('click', async () => {
      const name = (searchInput && searchInput.value || '').trim();
      if (!name) { showToast('Enter a name first', 'error'); return; }
      const phone = (prompt('Phone number (optional):') || '').trim();

      // Duplicate check.
      try {
        const existing = await findExact(state.clinicId, name.toLowerCase());
        if (existing) {
          const useExisting = confirm(
            'A patient named "' + existing.name + '" already exists' +
            (existing.phone ? ' (' + existing.phone + ')' : '') +
            '.\n\nClick OK to use the existing patient.\nClick Cancel to create a new patient anyway.'
          );
          if (useExisting) {
            state.patient = { id: existing.id, name: existing.name, phone: existing.phone || '' };
            if (searchInput) searchInput.value = existing.name;
            results.innerHTML = '';
            renderSummary();
            showToast('Using existing patient');
            return;
          }
        }
      } catch (err) {
        console.warn('[booking-flow] duplicate check failed, proceeding:', err);
      }

      try {
        const id = await createPatient({ clinicId: state.clinicId, name, phone });
        state.patient = { id, name, phone };
        results.innerHTML = '';
        renderSummary();
        showToast('Patient created');
      } catch (err) {
        console.error(err);
        showToast('Could not create patient', 'error');
      }
    });
  }

  document.querySelectorAll('[data-type]').forEach((el) => {
    el.addEventListener('click', () => {
      state.type = el.getAttribute('data-type');
      updateToggles();
      renderSummary();
    });
  });
  document.querySelectorAll('[data-mode]').forEach((el) => {
    el.addEventListener('click', () => {
      state.mode = el.getAttribute('data-mode');
      updateToggles();
      renderSummary();
    });
  });

  if (saveBtn) saveBtn.addEventListener('click', save);
  if (cancelBtn) cancelBtn.addEventListener('click', () => history.back());
}

function updateToggles() {
  document.querySelectorAll('[data-type]').forEach((el) => {
    const active = el.getAttribute('data-type') === state.type;
    el.classList.toggle('bg-accent-soft', active);
    el.classList.toggle('text-accent', active);
    el.classList.toggle('font-medium', active);
  });
  document.querySelectorAll('[data-mode]').forEach((el) => {
    const active = el.getAttribute('data-mode') === state.mode;
    el.classList.toggle('bg-accent-soft', active);
    el.classList.toggle('text-accent', active);
    el.classList.toggle('font-medium', active);
  });
}

async function runSearch(q) {
  const results = $('#patient-results');
  if (!results) return;
  try {
    const byName = await searchByName(state.clinicId, q, 10);
    const byPhone = /^[0-9+ -]{4,}$/.test(q) ? await searchByPhone(state.clinicId, q) : [];
    const merged = mergeUnique(byName, byPhone);
    if (merged.length === 0) {
      results.innerHTML = `<div class="px-3 py-2 text-[12.5px] text-ink-faint">No matches</div>`;
      return;
    }
    results.innerHTML = merged.map((p) => `
      <div data-patient-id="${p.id}" data-patient-name="${esc(p.name)}" data-patient-phone="${esc(p.phone || '')}"
        class="px-3 py-2 hover:bg-surface-hover cursor-pointer border-b border-hairline last:border-b-0">
        <div class="text-[14px] font-medium">${esc(p.name)}</div>
        ${p.phone ? `<div class="text-[12px] text-ink-mute">${esc(p.phone)}</div>` : ''}
      </div>`).join('');
  } catch (err) {
    console.error('[booking-flow] search failed:', err);
    results.innerHTML = `<div class="px-3 py-2 text-[12.5px] text-[#b91c1c]">Search failed</div>`;
  }
}

function mergeUnique(a, b) {
  const seen = new Set(a.map((x) => x.id));
  const out = a.slice();
  for (const x of b) { if (!seen.has(x.id)) out.push(x); }
  return out;
}

function esc(s) {
  return String(s == null ? '' : s)
    .split('&').join('&amp;')
    .split('<').join('&lt;')
    .split('>').join('&gt;')
    .split('"').join('&quot;')
    .split("'").join('&#39;');
}

// ---------- save ----------
async function save() {
  if (!state.patient || !state.slot || state.saving) return;
  state.saving = true;
  renderSummary();

  const m = me();
  const duration = slotsForType(state.type, state.schedule && state.schedule.newPatientSlots);

  if (!fitsInGrid(state.slots, state.slot, duration)) {
    showToast('Not enough room in the day for this booking', 'error');
    state.saving = false;
    renderSummary();
    return;
  }

  const existing = state.existingBySlot[state.slot] || 0;
  const order = existing + 1;

  const payload = {
    clinicId: state.clinicId,
    patientId: state.patient.id,
    patientName: state.patient.name,
    patientPhone: state.patient.phone || '',
    date: state.dateISO,
    slot: state.slot,
    durationSlots: duration,
    type: state.type,
    mode: state.mode,
    order,
    doctorId: '',
    status: 'booked',
    source: 'frontdesk',
    cancelledReason: '',
    notes: ''
  };

  try {
    await createAppointment(payload);
    showToast('Appointment booked');
    const back = '/day?date=' + state.dateISO;
    setTimeout(() => { location.replace(back); }, 300);
  } catch (err) {
    console.error('[booking-flow] save failed:', err);
    showToast('Could not save appointment', 'error');
    state.saving = false;
    renderSummary();
  }
}