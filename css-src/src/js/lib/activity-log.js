import { collection, addDoc, serverTimestamp }
  from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './firebase-init.js';
import { me } from './auth-guards.js';
import { getActiveClinicId } from './clinic-context.js';

/**
 * Append an entry to the shared activityLog collection.
 *
 * Called after a successful mutation (create, status change, delete, etc.)
 * on an appointment, follow-up, call, or patient.
 *
 * - Never throws. If the log write fails, the mutation still succeeded —
 *   we log to the console and carry on. A missing audit entry must not
 *   fail the user's action.
 * - Append-only. Never updates, never deletes. Same shape as BillBook
 *   and Case Papers write; new action names are additive.
 *
 * Actions used by Appointments (must match BUILD.md §5):
 *   appointment_created
 *   appointment_status_changed
 *   appointment_cancelled
 *   appointment_rescheduled
 *   appointment_deleted
 *   followup_created
 *   followup_resolved
 *   followup_superseded
 *   call_created
 *   call_resolved
 *   patient_created
 */
export async function writeAudit(action, targetId) {
  const m = me();
  const clinicId = getActiveClinicId();
  if (!m || !clinicId) {
    console.warn('[activity-log] skipped: no user or clinic');
    return;
  }

  try {
    await addDoc(collection(db, 'activityLog'), {
      clinicId,
      uid: m.uid,
      name: m.name,
      role: m.role,
      action,
      targetId: targetId || '',
      timestamp: serverTimestamp()
    });
  } catch (err) {
    console.error('[activity-log] write failed:', action, targetId, err);
  }
}