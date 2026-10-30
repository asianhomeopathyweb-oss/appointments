// ============================================================
// Activity
//
// Reads the shared activityLog collection, filtered to actions
// that Appointments writes. BillBook's actions (invoices,
// transactions, expenses) are excluded.
//
// Single-field query — no composite index. Sort and slice in
// JavaScript.
// ============================================================

import {
  collection,
  query,
  where,
  getDocs
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './lib/firebase-init.js';

// Actions that belong to Appointments. Everything not in this set
// (invoice_*, transaction_*, product_*, etc.) is BillBook territory
// and gets filtered out.
const APPOINTMENTS_PREFIXES = ['appointment_', 'followup_', 'call_'];
const APPOINTMENTS_EXACT = ['patient_created'];

// Human-friendly labels for the action pill / subtitle.
const ACTION_LABELS = {
  appointment_created:        'Booked appointment',
  appointment_status_changed: 'Changed status',
  appointment_cancelled:      'Cancelled appointment',
  appointment_rescheduled:    'Moved appointment',
  appointment_deleted:        'Deleted appointment',
  followup_created:           'Created follow-up',
  followup_resolved:          'Resolved follow-up',
  followup_superseded:        'Superseded follow-up',
  call_created:               'Logged call',
  call_resolved:              'Resolved call',
  patient_created:            'Added patient'
};

// Which category each action belongs to — used by the filter pills.
function categoryOf(action) {
  if (!action) return 'other';
  if (action.startsWith('appointment_')) return 'appointments';
  if (action.startsWith('followup_'))    return 'followups';
  if (action.startsWith('call_'))        return 'calls';
  if (action === 'patient_created')      return 'patients';
  return 'other';
}

function isAppointmentsAction(action) {
  if (!action) return false;
  if (APPOINTMENTS_EXACT.includes(action)) return true;
  return APPOINTMENTS_PREFIXES.some((p) => action.startsWith(p));
}

function toMillis(ts) {
  if (!ts) return 0;
  try {
    if (ts.toMillis) return ts.toMillis();
    if (ts.seconds) return ts.seconds * 1000;
    const d = new Date(ts);
    return isNaN(d.getTime()) ? 0 : d.getTime();
  } catch { return 0; }
}

/**
 * Recent Appointments-authored activity for a clinic.
 * Sorted newest first. Default limit 200.
 *
 * Each returned entry:
 *   { id, clinicId, uid, name, role, action, targetId, timestamp,
 *     label, category, ms }
 */
export async function listRecent(clinicId, limit = 200) {
  const q = query(
    collection(db, 'activityLog'),
    where('clinicId', '==', clinicId)
  );
  const snap = await getDocs(q);

  const rows = snap.docs
    .map((d) => {
      const raw = d.data();
      return {
        id: d.id,
        clinicId: raw.clinicId,
        uid: raw.uid,
        name: raw.name,
        role: raw.role,
        action: raw.action,
        targetId: raw.targetId || '',
        timestamp: raw.timestamp,
        ms: toMillis(raw.timestamp)
      };
    })
    .filter((r) => isAppointmentsAction(r.action));

  rows.sort((a, b) => b.ms - a.ms);

  return rows.slice(0, limit).map((r) => ({
    ...r,
    label: ACTION_LABELS[r.action] || r.action.replace(/_/g, ' '),
    category: categoryOf(r.action)
  }));
}

export { categoryOf };