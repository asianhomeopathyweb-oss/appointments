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
  onSnapshot,
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

// ============================================================
// MERGED PENDING — Problem Calls + Scheduled Phone Appointments
//
// Returns { problem: [...], scheduled: [...] }.
//   - problem:   calls where status === 'pending'
//   - scheduled: appointments where mode === 'call' && status === 'booked'
//                && date === todayISO
//
// Scheduled calls are filtered to TODAY only. Future/past call-mode
// appointments are not shown here — they belong in the day grid on
// their own day.
//
// Single where('clinicId') query per collection. All other filtering
// happens in JS. No composite indexes.
// ============================================================

function todayISOLocal() {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

function buildMerged(callsAll, apptsAll) {
  const today = todayISOLocal();

  const problem = callsAll
    .filter((x) => x.status === 'pending')
    .map((x) => ({ ...x, _type: 'problem' }))
    .sort((a, b) => (a.createdAt?.toMillis?.() || 0) - (b.createdAt?.toMillis?.() || 0));

  const scheduled = apptsAll
    .filter((x) =>
      x.deleted !== true &&
      x.mode === 'call' &&
      x.status === 'booked' &&
      x.date === today
    )
    .map((x) => ({ ...x, _type: 'scheduled' }))
    .sort((a, b) => (a.slot || '').localeCompare(b.slot || ''));

  return { problem, scheduled };
}

/** One-shot fetch — used by pages that don't need live updates. */
export async function listMergedPending(clinicId) {
  const [callsAll, apptsAll] = await Promise.all([
    fetchAll(clinicId),
    (async () => {
      const q = query(
        collection(db, 'appointments'),
        where('clinicId', '==', clinicId)
      );
      const snap = await getDocs(q);
      return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    })()
  ]);
  return buildMerged(callsAll, apptsAll);
}

/**
 * Realtime subscription for the merged pending list.
 * onData receives { problem: [...], scheduled: [...] } every time
 * either collection changes for this clinic.
 *
 * Returns an unsubscribe function.
 */
export function subscribeMergedPending(clinicId, onData, onError) {
  if (!clinicId) return () => {};

  let callsRows = [];
  let apptsRows = [];
  let callsReady = false;
  let apptsReady = false;

  const emit = () => {
    if (!callsReady || !apptsReady) return;
    try {
      onData(buildMerged(callsRows, apptsRows));
    } catch (err) {
      console.error('[calls] onData threw:', err);
    }
  };

  const callsQ = query(
    collection(db, 'calls'),
    where('clinicId', '==', clinicId)
  );
  const unsubCalls = onSnapshot(
    callsQ,
    (snap) => {
      callsRows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((x) => x.deleted !== true)
        .slice(0, FETCH_LIMIT);
      callsReady = true;
      emit();
    },
    (err) => {
      console.error('[calls] subscribe calls failed:', err);
      if (onError) onError(err);
    }
  );

  const apptsQ = query(
    collection(db, 'appointments'),
    where('clinicId', '==', clinicId)
  );
  const unsubAppts = onSnapshot(
    apptsQ,
    (snap) => {
      apptsRows = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      apptsReady = true;
      emit();
    },
    (err) => {
      console.error('[calls] subscribe appointments failed:', err);
      if (onError) onError(err);
    }
  );

  return () => {
    try { unsubCalls(); } catch {}
    try { unsubAppts(); } catch {}
  };
}

/**
 * Convert a scheduled call-mode appointment to a regular visit.
 * Flips mode: 'call' → 'visit'. Same slot, same patient, same date.
 * Used by the "Convert to Visit" button in the call action modal.
 *
 * Returns the updated appointment id on success.
 */
export async function convertScheduledToVisit(appointmentId) {
  if (!appointmentId) throw new Error('appointmentId required');
  await updateDoc(doc(db, 'appointments', appointmentId), {
    mode: 'visit',
    updatedAt: serverTimestamp()
  });
  try { await writeAudit('appointment_mode_changed', appointmentId); } catch {}
  return appointmentId;
}