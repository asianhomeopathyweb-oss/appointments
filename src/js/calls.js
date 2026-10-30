// ============================================================
// Calls
//
// Firestore wrapper for the calls collection.
//
// A call is a phone request:
//   - ad-hoc: patient called in with a problem (status pending)
//   - resolved: doctor talked / converted / dismissed
//
// Scheduled call-mode appointments live in `appointments`,
// not here. This collection is only for ad-hoc calls.
//
// Single-field queries, filter in JS — no composite indexes.
// ============================================================

import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  serverTimestamp,
  arrayUnion
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './lib/firebase-init.js';
import { me } from './lib/auth-guards.js';
import { writeAudit } from './lib/activity-log.js';

const FETCH_LIMIT = 500;

/** Fetch all non-deleted calls for a clinic, filter in JS. */
async function fetchAll(clinicId) {
  const q = query(
    collection(db, 'calls'),
    where('clinicId', '==', clinicId)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((x) => x.deleted !== true)
    .slice(0, FETCH_LIMIT);
}

/** Pending calls, newest first. */
export async function listPending(clinicId) {
  const all = await fetchAll(clinicId);
  return all
    .filter((x) => x.status === 'pending')
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

/** All calls for a patient, newest first. */
export async function listForPatient(clinicId, patientId) {
  const all = await fetchAll(clinicId);
  return all
    .filter((x) => x.patientId === patientId)
    .sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
}

/** Fetch one call by id. */
export async function get(id) {
  const snap = await getDoc(doc(db, 'calls', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/** Create a new pending call. */
export async function create({ clinicId, patientId, patientName, patientPhone, reason }) {
  const m = me();
  const now = serverTimestamp();
  const record = {
    clinicId,
    patientId,
    patientName,
    patientPhone: patientPhone || '',
    reason: reason || '',
    status: 'pending',
    outcome: null,
    history: [{
      at: new Date().toISOString(),
      by: m.uid,
      byName: m.name,
      action: 'created',
      note: reason || ''
    }],
    createdAt: now,
    createdBy: { uid: m.uid, name: m.name, role: m.role },
    resolvedAt: null,
    resolvedBy: null,
    deleted: false
  };
  const ref = await addDoc(collection(db, 'calls'), record);
  try { await writeAudit('call_created', ref.id); } catch {}
  return ref.id;
}

/**
 * Resolve a call.
 * outcome: 'completed' | 'add_to_appointment'
 */
export async function resolve(id, outcome, note) {
  const m = me();
  const status = outcome === 'add_to_appointment' ? 'converted' : 'done';
  const entry = {
    at: new Date().toISOString(),
    by: m.uid,
    byName: m.name,
    action: status,
    note: note || '',
    outcome
  };
  await updateDoc(doc(db, 'calls', id), {
    status,
    outcome,
    history: arrayUnion(entry),
    resolvedAt: serverTimestamp(),
    resolvedBy: { uid: m.uid, name: m.name, role: m.role }
  });
  try { await writeAudit('call_resolved', id); } catch {}
}

/** Append a note to the call history without changing status. */
export async function addNote(id, note) {
  const m = me();
  const entry = {
    at: new Date().toISOString(),
    by: m.uid,
    byName: m.name,
    action: 'note',
    note: note || ''
  };
  await updateDoc(doc(db, 'calls', id), {
    history: arrayUnion(entry)
  });
}