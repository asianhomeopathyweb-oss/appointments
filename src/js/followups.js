// ============================================================
// Follow-ups
//
// Follow-ups are reminders that a patient should come back.
// They are NOT appointments — no slot, no order, no status
// beyond pending / done / cancelled / superseded.
//
// Search approach: single-field queries, filter in JavaScript.
// Avoids composite indexes. For a clinic with hundreds of
// patients, this is fast enough.
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

const FETCH_LIMIT = 1000;

/**
 * Fetch all follow-ups for a clinic, then filter in JS.
 * Only requires a single-field index on clinicId.
 */
async function fetchAll(clinicId) {
  const q = query(
    collection(db, 'followUps'),
    where('clinicId', '==', clinicId)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((x) => x.deleted !== true)
    .slice(0, FETCH_LIMIT);
}

/**
 * Pending follow-ups due on or before a date.
 * Sorted by dueDate ascending.
 */
export async function listDue(clinicId, upToDateISO) {
  const all = await fetchAll(clinicId);
  return all
    .filter((x) => x.status === 'pending')
    .filter((x) => !upToDateISO || x.dueDate <= upToDateISO)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
}

/**
 * Pending follow-ups due on a specific date.
 * Sorted by patient name (case-insensitive).
 */
export async function listForDate(clinicId, dateISO) {
  const all = await fetchAll(clinicId);
  return all
    .filter((x) => x.status === 'pending')
    .filter((x) => x.dueDate === dateISO)
    .sort((a, b) => (a.patientName || '').toLowerCase().localeCompare((b.patientName || '').toLowerCase()));
}

/**
 * All follow-ups for a patient, newest first.
 */
export async function listForPatient(clinicId, patientId) {
  const all = await fetchAll(clinicId);
  return all
    .filter((x) => x.patientId === patientId)
    .sort((a, b) => (b.dueDate || '').localeCompare(a.dueDate || ''));
}

/** Fetch one follow-up by id. */
export async function get(id) {
  const snap = await getDoc(doc(db, 'followUps', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/** The single pending follow-up for a patient, or null. */
export async function findPendingForPatient(clinicId, patientId) {
  const all = await fetchAll(clinicId);
  const match = all.find((x) => x.patientId === patientId && x.status === 'pending');
  return match || null;
}

/**
 * Create a follow-up from a visit.
 */
export async function createFromVisit(appointment, intervalDays, dueDate) {
  const m = me();
  const seenOn = appointment.date;
  const now = serverTimestamp();

  const record = {
    clinicId: appointment.clinicId,
    patientId: appointment.patientId,
    patientName: appointment.patientName,
    patientPhone: appointment.patientPhone || '',
    fromAppointmentId: appointment.id,
    seenOn,
    dueDate,
    intervalDays,
    status: 'pending',
    bookedAppointmentId: null,
    history: [{
      at: new Date().toISOString(),
      by: m.uid,
      byName: m.name,
      action: 'created',
      note: `Interval ${intervalDays} days`
    }],
    createdAt: now,
    createdBy: { uid: m.uid, name: m.name, role: m.role },
    updatedAt: now,
    deleted: false
  };

  const ref = await addDoc(collection(db, 'followUps'), record);
  try { await writeAudit('followup_created', ref.id); } catch {}
  return ref.id;
}

/** Mark a follow-up done or cancelled with a note. */
export async function resolve(id, status, note) {
  const m = me();
  const entry = {
    at: new Date().toISOString(),
    by: m.uid,
    byName: m.name,
    action: status,
    note: note || ''
  };
  await updateDoc(doc(db, 'followUps', id), {
    status,
    history: arrayUnion(entry),
    updatedAt: serverTimestamp()
  });
  try { await writeAudit('followup_resolved', id); } catch {}
}

/**
 * Mark a follow-up superseded (replaced by a newer one).
 * Accepts an optional replacedByDate to log exactly where it was moved to.
 */
export async function supersede(id, note, replacedByDate) {
  const m = me();
  const entry = {
    at: new Date().toISOString(),
    by: m.uid,
    byName: m.name,
    action: 'superseded',
    note: note || '',
    to: replacedByDate || undefined
  };
  await updateDoc(doc(db, 'followUps', id), {
    status: 'superseded',
    history: arrayUnion(entry),
    updatedAt: serverTimestamp()
  });
  try { await writeAudit('followup_superseded', id); } catch {}
}

/** Change the due date of a pending follow-up. */
export async function move(id, newDueDate, note) {
  const m = me();
  const entry = {
    at: new Date().toISOString(),
    by: m.uid,
    byName: m.name,
    action: 'moved',
    note: note || '',
    to: newDueDate
  };
  await updateDoc(doc(db, 'followUps', id), {
    dueDate: newDueDate,
    history: arrayUnion(entry),
    updatedAt: serverTimestamp()
  });
}

/** Append a note to the history without changing status. */
export async function addNote(id, note) {
  const m = me();
  const entry = {
    at: new Date().toISOString(),
    by: m.uid,
    byName: m.name,
    action: 'note',
    note: note || ''
  };
  await updateDoc(doc(db, 'followUps', id), {
    history: arrayUnion(entry),
    updatedAt: serverTimestamp()
  });
}