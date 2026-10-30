import { doc, getDoc, setDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './lib/firebase-init.js';
import { getActiveClinicId } from './lib/clinic-context.js';
import { showToast } from './lib/toast.js';
import { writeAudit } from './lib/activity-log.js';

const $ = (sel) => document.querySelector(sel);

export async function startSettingsView() {
  const clinicId = getActiveClinicId();
  if (!clinicId) return;

  const form = $('#settings-form');
  const saveBtn = $('#settings-save');
  if (!form || !saveBtn) return;

  // 1. Load existing schedule
  try {
    const snap = await getDoc(doc(db, 'clinicSchedule', clinicId));
    if (snap.exists()) {
      const data = snap.data();
      if (data.openTime) $('#set-open').value = data.openTime;
      if (data.closeTime) $('#set-close').value = data.closeTime;
      if (data.slotMinutes) $('#set-slot').value = data.slotMinutes;
      if (data.newPatientSlots) $('#set-new-slots').value = data.newPatientSlots;
      if (data.breakStart) $('#set-break-start').value = data.breakStart;
      if (data.breakEnd) $('#set-break-end').value = data.breakEnd;
      
      if (Array.isArray(data.daysOpen)) {
        document.querySelectorAll('input[name="days"]').forEach((cb) => {
          cb.checked = data.daysOpen.includes(parseInt(cb.value));
        });
      }
    }
  } catch (err) {
    console.error('[settings] load failed:', err);
    showToast('Could not load schedule', 'error');
  }

  // 2. Handle save
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    
    saveBtn.disabled = true;
    saveBtn.textContent = 'Saving...';

    const daysOpen = Array.from(document.querySelectorAll('input[name="days"]:checked')).map((cb) => parseInt(cb.value));
    
    const payload = {
      clinicId,
      openTime: $('#set-open').value,
      closeTime: $('#set-close').value,
      slotMinutes: parseInt($('#set-slot').value, 10),
      newPatientSlots: parseInt($('#set-new-slots').value, 10),
      breakStart: $('#set-break-start').value,
      breakEnd: $('#set-break-end').value,
      daysOpen
    };

    try {
      await setDoc(doc(db, 'clinicSchedule', clinicId), payload, { merge: true });
      try { await writeAudit('settings_updated', clinicId); } catch {}
      showToast('Schedule updated');
    } catch (err) {
      console.error('[settings] save failed:', err);
      showToast('Failed to save', 'error');
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Save changes';
    }
  });
}