// ============================================================
// Booking flow
// ============================================================

import { me } from './lib/auth-guards.js';
import { getActiveClinicId, getActiveClinic } from './lib/clinic-context.js';
import { searchByName, searchByPhone, create as createPatient, get as getPatient } from './patients.js';
import { create as createAppointment, listForDay, listForPatient } from './appointments.js';
import { slotsForType, fitsInGrid, checkSlotOccupancy, invalidateOccupancy } from './booking-policy.js';
import { generateSlots, isDayOpen } from './slot-grid.js';
import { todayISO, fmtDate, fmtSlot, addDays, isoToDate } from './date-utils.js';
import { doc, getDoc } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './lib/firebase-init.js';
import { showToast } from './lib/toast.js';
import { esc } from './lib/format.js';

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
  saving: false,
  weekStart: todayISO()
};

export async function startBookingFlow() {
  const m = me();
  if (!m) return;

  state.clinicId = getActiveClinicId();
  if (!state.clinicId) return;

  state.clinic = await getActiveClinic();
  state.schedule = await loadSchedule(state.clinicId);

  await readQueryParams();
  wireEvents();
  renderDateStrip();
  
  // Show loading state while we fetch existing bookings
  $('#book-slots').innerHTML = `<div class="p-6 text-center text-[13px] text-ink-mute">Loading slots...</div>`;
  
  await refreshExisting();
  
  renderSlotGrid();
  renderSummary();
  updateToggles();
}

async function loadSchedule(clinicId) {
  try {
    const snap = await getDoc(doc(db, 'clinicSchedule', clinicId));
    if (!snap.exists()) return null;
    return snap.data();
  } catch { return null; }
}

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
      if (patient) await selectPatient(patient);
    } catch (err) {}
  }
}

// SMART DEFAULTS & HISTORY CONTEXT
async function selectPatient(patient) {
  state.patient = { id: patient.id, name: patient.name, phone: patient.phone || '' };

  const searchWrap = $('#patient-search-wrap');
  const selectedWrap = $('#patient-selected-wrap');
  if (searchWrap) searchWrap.classList.add('hidden');
  if (selectedWrap) selectedWrap.classList.remove('hidden');

  const pName = $('#summary-patient');
  const pPhone = $('#summary-phone');
  if (pName) pName.textContent = state.patient.name;
  if (pPhone) pPhone.textContent = state.patient.phone || 'No phone';

  const results = $('#patient-results');
  if (results) results.innerHTML = '';

  try {
    const history = await listForPatient(state.clinicId, patient.id);

    if (history && history.length > 0) {
      state.type = 'followup';
      state.mode = history[0].mode || 'visit';

      const last = history[0];
      const lastDate = fmtDate(last.date);
      const lastType = last.type === 'new' ? 'New' : 'Follow-up';
      const ctxEl = $('#patient-last-visit');
      if (ctxEl) {
        ctxEl.textContent = `Last visited: ${lastDate} · ${lastType}`;
        ctxEl.classList.remove('hidden');
      }
    } else {
      state.type = 'new';
      state.mode = 'visit';
      const ctxEl = $('#patient-last-visit');
      if (ctxEl) ctxEl.classList.add('hidden');
    }
  } catch {
    state.type = 'new';
    state.mode = 'visit';
  }

  updateToggles();
  renderSummary();
}

function renderDateStrip() {
  const strip = $('#booking-date-strip');
  if (!strip) return;

  const start = addDays(state.weekStart, -3);
  const days = [];
  for (let i = 0; i < 7; i++) days.push(addDays(start, i));

  strip.innerHTML = days.map(iso => {
    const isSelected = iso === state.dateISO;
    const d = isoToDate(iso);
    const dayName = ['SUN','MON','TUE','WED','THU','FRI','SAT'][d.getDay()];
    const dayNum = d.getDate();

    const cls = isSelected
      ? 'bg-ink text-white shadow-md'
      : 'bg-white text-ink border border-hairline hover:border-accent/50 shadow-sm';

    return `
      <button type="button" data-day="${iso}"
        class="flex-1 flex flex-col items-center justify-center min-w-[55px] h-[52px] rounded-xl transition-all ${cls}">
        <span class="text-[9px] font-bold tracking-widest uppercase opacity-70">${dayName}</span>
        <span class="text-[16px] font-bold tnum leading-none mt-0.5">${dayNum}</span>
      </button>`;
  }).join('');

  strip.querySelectorAll('[data-day]').forEach(el => {
    el.addEventListener('click', async () => {
      state.dateISO = el.getAttribute('data-day');
      state.slot = null;
      renderDateStrip();
      
      $('#book-slots').innerHTML = `<div class="p-6 text-center text-[13px] text-ink-mute">Loading slots...</div>`;
      await refreshExisting();
      renderSlotGrid();
      renderSummary();
    });
  });
}

function renderSlotGrid() {
  const root = $('#book-slots');
  if (!root) return;

  if (!state.schedule) {
    root.innerHTML = `<div class="p-6 text-center text-[13px] text-ink-mute">No schedule set up.</div>`;
    return;
  }
  if (!isDayOpen(state.schedule, state.dateISO)) {
    root.innerHTML = `<div class="p-6 text-center text-[13px] text-ink-mute">Clinic is closed.</div>`;
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

    const base = 'h-9 rounded-lg text-[12.5px] tnum border transition-all font-medium flex items-center justify-center';
    const cls = selected
      ? 'bg-ink text-white border-ink shadow-md scale-[1.02]'
      : count > 0
        ? 'bg-surface-press text-ink-mute border-transparent hover:border-accent'
        : 'bg-white text-ink border-hairline hover:border-accent shadow-sm';

    const badge = count > 0 ? `<span class="ml-1.5 px-1.5 py-0.5 rounded text-[9px] bg-red-100 text-red-600 font-bold">${count}</span>` : '';

    return `<button type="button" data-slot="${s}" class="${base} ${cls}">${fmtSlot(s)} ${badge}</button>`;
  }).join('');

  root.innerHTML = `<div class="grid grid-cols-3 sm:grid-cols-4 lg:grid-cols-5 gap-1.5 md:gap-2">${html}</div>`;

  root.querySelectorAll('[data-slot]').forEach((btn) => {
    btn.addEventListener('click', () => {
      state.slot = btn.getAttribute('data-slot');
      renderSlotGrid();
      renderSummary();
    });
  });
}

function renderSummary() {
  const pDesktop = $('#summary-patient');
  const dDesktop = $('#summary-date');
  const sDesktop = $('#summary-slot');
  const pMobile = $('#mobile-summary-patient');
  const sMobile = $('#mobile-summary-slot');

  if (pDesktop) pDesktop.textContent = state.patient ? state.patient.name : '—';
  if (dDesktop) dDesktop.textContent = fmtDate(state.dateISO);
  if (sDesktop) sDesktop.textContent = state.slot ? fmtSlot(state.slot) : '—';

  if (pMobile) pMobile.textContent = state.patient ? state.patient.name : '—';
  if (sMobile) sMobile.textContent = state.slot ? fmtSlot(state.slot) : '—';

  const saveDesktop = $('#book-save-desktop');
  const saveMobile = $('#book-save');

  const ready = state.patient && state.slot && !state.saving;
  const label = state.saving ? 'Saving...' : 'Book Appointment';

  if (saveDesktop) { saveDesktop.disabled = !ready; saveDesktop.textContent = label; }
  if (saveMobile) { saveMobile.disabled = !ready; saveMobile.textContent = label; }
}

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
    state.existingBySlot = {};
  }
}

function wireEvents() {
  const searchInput = $('#patient-search');
  const results = $('#patient-results');
  const createBtn = $('#patient-create');
  const cancelBtn = $('#book-cancel');
  const clearBtn = $('#patient-clear');

  const prev = $('#day-prev');
  const next = $('#day-next');
  if (prev) prev.addEventListener('click', () => { state.weekStart = addDays(state.weekStart, -7); renderDateStrip(); });
  if (next) next.addEventListener('click', () => { state.weekStart = addDays(state.weekStart, 7); renderDateStrip(); });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      state.patient = null;
      const searchWrap = $('#patient-search-wrap');
      const selectedWrap = $('#patient-selected-wrap');
      if (searchWrap) searchWrap.classList.remove('hidden');
      if (selectedWrap) selectedWrap.classList.add('hidden');
      if (searchInput) { searchInput.value = ''; searchInput.focus(); }
      renderSummary();
    });
  }

  // SEARCH
  let searchTimer = null;
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      clearTimeout(searchTimer);
      const q = searchInput.value.trim();
      if (q.length < 2) { results.innerHTML = ''; return; }
      searchTimer = setTimeout(() => runSearch(q), 250);
    });

    searchInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const firstResult = results.querySelector('[data-patient-id]');
        if (firstResult) firstResult.click();
      }
    });
  }

  if (results) {
    results.addEventListener('click', (e) => {
      const row = e.target.closest('[data-patient-id]');
      if (!row) return;
      const patient = {
        id: row.getAttribute('data-patient-id'),
        name: row.getAttribute('data-patient-name'),
        phone: row.getAttribute('data-patient-phone')
      };
      selectPatient(patient);
    });
  }

  if (createBtn) {
    createBtn.addEventListener('click', () => {
      openPatientModal();
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

  // GLOBAL KEYBOARD SHORTCUTS
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      state.slot = null;
      renderSlotGrid();
      renderSummary();
    }
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      save();
    }
  });

  const saveBtn = $('#book-save');
  if (saveBtn) saveBtn.addEventListener('click', save);
  const saveBtnDesktop = $('#book-save-desktop');
  if (saveBtnDesktop) saveBtnDesktop.addEventListener('click', save);
  if (cancelBtn) cancelBtn.addEventListener('click', () => history.back());
}

function updateToggles() {
  document.querySelectorAll('[data-type]').forEach((el) => {
    const active = el.getAttribute('data-type') === state.type;
    el.className = active
      ? 'flex-1 h-8 md:h-9 rounded-lg text-[11px] md:text-[12.5px] font-medium border border-hairline bg-ink text-white shadow-md transition-all'
      : 'flex-1 h-8 md:h-9 rounded-lg text-[11px] md:text-[12.5px] font-medium border border-hairline hover:border-accent bg-white text-ink transition-all';
  });
  document.querySelectorAll('[data-mode]').forEach((el) => {
    const active = el.getAttribute('data-mode') === state.mode;
    el.className = active
      ? 'flex-1 h-8 md:h-9 rounded-lg text-[11px] md:text-[12.5px] font-medium border border-hairline bg-ink text-white shadow-md transition-all'
      : 'flex-1 h-8 md:h-9 rounded-lg text-[11px] md:text-[12.5px] font-medium border border-hairline hover:border-accent bg-white text-ink transition-all';
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
      results.innerHTML = `<div class="px-3 py-3 text-[13px] text-ink-faint">No matches</div>`;
      return;
    }
    results.innerHTML = merged.map((p) => `
      <div data-patient-id="${p.id}" data-patient-name="${esc(p.name)}" data-patient-phone="${esc(p.phone || '')}"
        class="px-4 py-3 hover:bg-surface-hover cursor-pointer border-b border-hairline last:border-b-0 transition-colors">
        <div class="text-[14px] font-bold text-ink">${esc(p.name)}</div>
        ${p.phone ? `<div class="text-[12px] text-ink-mute mt-0.5">${esc(p.phone)}</div>` : ''}
      </div>`).join('');
  } catch (err) {
    results.innerHTML = `<div class="px-3 py-3 text-[13px] text-red-500">Search failed</div>`;
  }
}

function mergeUnique(a, b) {
  const seen = new Set(a.map((x) => x.id));
  const out = a.slice();
  for (const x of b) { if (!seen.has(x.id)) out.push(x); }
  return out;
}

async function save() {
  if (!state.patient || !state.slot || state.saving) return;
  state.saving = true;
  renderSummary();

  const duration = slotsForType(state.type, state.schedule && state.schedule.newPatientSlots);

  if (!fitsInGrid(state.slots, state.slot, duration)) {
    showToast('Not enough room in the day', 'error');
    state.saving = false;
    renderSummary();
    return;
  }

  // Centralised collision check (same helper used by reschedule)
  let occ;
  try {
    occ = await checkSlotOccupancy({
      clinicId: state.clinicId,
      dateISO: state.dateISO,
      slot: state.slot
    });
  } catch {
    occ = { count: 0, conflict: null };
  }

  if (occ.count > 0) {
    const who = occ.conflict?.patientName || 'another patient';
    const proceed = confirm(
      `This slot already has ${occ.count} booking${occ.count > 1 ? 's' : ''} (${who}). Book anyway?`
    );
    if (!proceed) {
      state.saving = false;
      renderSummary();
      return;
    }
  }

  const order = (state.existingBySlot[state.slot] || 0) + 1;

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
    invalidateOccupancy(state.clinicId, state.dateISO);
    showToast('Appointment booked');
    const back = '/day?date=' + state.dateISO;
    setTimeout(() => { location.replace(back); }, 300);
  } catch (err) {
    showToast('Could not save appointment', 'error');
    state.saving = false;
    renderSummary();
  }
}

// ---------- Patient Modal Logic ----------
function openPatientModal() {
  const npName = $('#np-name');
  const npPhone = $('#np-phone');
  const npAge = $('#np-age');
  const npAgeUnit = $('#np-age-unit');
  const npSex = $('#np-sex');
  const npAddress = $('#np-address');
  const npReferral = $('#np-referral');
  const npSave = $('#np-save');

  if (npName) npName.value = '';
  if (npPhone) npPhone.value = '';
  if (npAge) npAge.value = '';
  if (npAgeUnit) npAgeUnit.value = 'years';
  if (npSex) npSex.value = 'Male';
  if (npAddress) npAddress.value = '';
  if (npReferral) npReferral.value = 'Google';
  if (npSave) npSave.disabled = true;

  const backdrop = $('#np-backdrop');
  const modal = $('#np-modal');
  if (backdrop) backdrop.classList.remove('hidden');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }

  setTimeout(() => { if (npName) npName.focus(); }, 100);
}

function closePatientModal() {
  const backdrop = $('#np-backdrop');
  const modal = $('#np-modal');
  if (backdrop) backdrop.classList.add('hidden');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function updateModalSaveState() {
  const name = $('#np-name');
  const phone = $('#np-phone');
  const saveBtn = $('#np-save');
  if (!name || !phone || !saveBtn) return;
  saveBtn.disabled = !name.value.trim() || !phone.value.trim();
}

async function saveNewPatientModal() {
  const nameEl = $('#np-name');
  const phoneEl = $('#np-phone');
  const ageEl = $('#np-age');
  const ageUnitEl = $('#np-age-unit');
  const sexEl = $('#np-sex');
  const addressEl = $('#np-address');
  const referralEl = $('#np-referral');
  const saveBtn = $('#np-save');

  if (!nameEl || !phoneEl) return;

  const name = nameEl.value.trim();
  const phone = phoneEl.value.trim();
  if (!name || !phone) return;

  let finalAge = ageEl ? ageEl.value : '';
  const unit = ageUnitEl ? ageUnitEl.value : 'years';
  if (finalAge) {
    finalAge = Number(finalAge);
    if (unit === 'months') finalAge = Math.round(finalAge / 12);
    if (unit === 'days') finalAge = Math.round(finalAge / 365);
  }

  if (saveBtn) {
    saveBtn.textContent = 'Creating...';
    saveBtn.disabled = true;
  }

  try {
    const id = await createPatient({
      clinicId: state.clinicId,
      name: name,
      phone: phone,
      age: finalAge || null,
      sex: sexEl ? sexEl.value : '',
      address: addressEl ? addressEl.value.trim() : '',
      referral: referralEl ? referralEl.value : ''
    });

    showToast('Patient added');

    await selectPatient({ id, name, phone });
    closePatientModal();
  } catch (err) {
    showToast('Could not add patient', 'error');
    if (saveBtn) {
      saveBtn.textContent = 'Create Patient';
      updateModalSaveState();
    }
  }
}

// Attach modal listeners once
document.getElementById('np-close')?.addEventListener('click', closePatientModal);
document.getElementById('np-cancel')?.addEventListener('click', closePatientModal);
document.getElementById('np-backdrop')?.addEventListener('click', closePatientModal);
document.getElementById('np-name')?.addEventListener('input', (e) => {
  const v = e.target.value;
  const next = v.replace(/(^|\s)([a-z])/g, (m, pre, ch) => pre + ch.toUpperCase());
  if (next !== v) {
    const pos = e.target.selectionStart;
    e.target.value = next;
    try { e.target.setSelectionRange(pos, pos); } catch {}
  }
  updateModalSaveState();
});
document.getElementById('np-phone')?.addEventListener('input', updateModalSaveState);
document.getElementById('np-save')?.addEventListener('click', saveNewPatientModal);