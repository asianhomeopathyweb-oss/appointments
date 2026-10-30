import { collection, addDoc, serverTimestamp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './firebase-init.js';
import { me } from './auth-guards.js';
import { getActiveClinicId } from './clinic-context.js';

export async function writeAudit(action, targetId) {
  const m = me();
  const clinicId = getActiveClinicId();
  if (!m || !clinicId) { console.warn('[activity-log] skipped: no user or clinic'); return; }
  try {
    await addDoc(collection(db, 'activityLog'), {
      clinicId, uid: m.uid, name: m.name, role: m.role,
      action, targetId: targetId || '', timestamp: serverTimestamp()
    });
  } catch (err) {
    console.error('[activity-log] write failed:', action, targetId, err);
  }
}
