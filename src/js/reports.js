import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './lib/firebase-init.js';
import { getActiveClinicId } from './lib/clinic-context.js';
import { addDays, todayISO, fmtDate } from './date-utils.js';

// Fetch and filter helpers (No composite indexes required)
export async function fetchNewPatients(startISO, endISO) {
  const clinicId = getActiveClinicId();
  const q = query(collection(db, 'patients'), where('clinicId', '==', clinicId));
  const snap = await getDocs(q);
  
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(p => p.deleted !== true)
    .filter(p => {
      const date = p.created_at ? p.created_at.slice(0, 10) : '';
      return date >= startISO && date <= endISO;
    });

  // Group by referral
  const referrals = {};
  rows.forEach(p => {
    const ref = p.referral || 'Unknown';
    referrals[ref] = (referrals[ref] || 0) + 1;
  });

  return { total: rows.length, referrals };
}

export async function fetchFollowupStats(startISO, endISO) {
  const clinicId = getActiveClinicId();
  const q = query(collection(db, 'followUps'), where('clinicId', '==', clinicId));
  const snap = await getDocs(q);
  
  const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }))
    .filter(f => f.deleted !== true)
    .filter(f => f.dueDate >= startISO && f.dueDate <= endISO);

  const stats = { total: rows.length, pending: 0, done: 0, cancelled: 0, overdue: 0 };
  const today = todayISO();

  rows.forEach(f => {
    if (f.status === 'pending') {
      stats.pending++;
      if (f.dueDate < today) stats.overdue++;
    } else if (f.status === 'done') {
      stats.done++;
    } else if (f.status === 'cancelled') {
      stats.cancelled++;
    }
  });

  const completionRate = stats.total > 0 
    ? Math.round((stats.done / stats.total) * 100) 
    : 0;

  return { ...stats, completionRate };
}

// Setup the standard date range dropdown on report pages
export function wireDateRange(onChange) {
  const select = document.querySelector('#report-range');
  if (!select) return;

  select.addEventListener('change', () => {
    const days = parseInt(select.value, 10);
    const end = todayISO();
    const start = addDays(end, -days + 1);
    onChange(start, end);
  });

  // Trigger initial load
  select.dispatchEvent(new Event('change'));
}