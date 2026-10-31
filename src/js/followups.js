// ============================================================
// Follow-ups
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

export async function listDue(clinicId, upToDateISO) {
  const all = await fetchAll(clinicId);
  return all
    .filter((x) => x.status === 'pending')
    .filter((x) => !upToDateISO || x.dueDate <= upToDateISO)
    .sort((a, b) => (a.dueDate || '').localeCompare(b.dueDate || ''));
}

export async function listForDate(clinicId, dateISO) {
  const all = await fetchAll(clinicId);
  return all
    .filter((x) => x.status === 'pending')
    .filter((x) => x.dueDate === dateISO)
    .sort((a, b) => (a.patientName || '').toLowerCase().localeCompare((b.patientName || '').toLowerCase()));
}

export async function listForPatient(clinicId, patientId) {
  const all = await fetchAll(clinicId);
  return all
    .filter((x) => x.patientId === patientId)
    .sort((a, b) => (b.dueDate || '').localeCompare(a.dueDate || ''));
}

export async function get(id) {
  const snap = await getDoc(doc(db, 'followUps', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

export async function findPendingForPatient(clinicId, patientId) {
  const all = await fetchAll(clinicId);
  const match = all.find((x) => x.patientId === patientId && x.status === 'pending');
  return match || null;
}

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

export async function supersede(id, note) {
  const m = me();
  const entry = {
    at: new Date().toISOString(),
    by: m.uid,
    byName: m.name,
    action: 'superseded',
    note: note || ''
  };
  await updateDoc(doc(db, 'followUps', id), {
    status: 'superseded',
    history: arrayUnion(entry),
    updatedAt: serverTimestamp()
  });
  try { await writeAudit('followup_superseded', id); } catch {}
}

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
