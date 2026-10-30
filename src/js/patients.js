// ============================================================
// Patients
//
// Firestore wrapper for the shared patients collection.
// Appointments creates patients; BillBook also reads them.
// The rule: Appointments creates only, never edits or deletes.
//
// Search approach: fetch all patients for the clinic, filter
// in JavaScript. Avoids composite indexes and works even if
// older documents lack name_lower or deleted.
// ============================================================

import {
  collection,
  query,
  where,
  getDocs,
  doc,
  getDoc,
  addDoc,
  serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { db } from './lib/firebase-init.js';
import { me } from './lib/auth-guards.js';
import { writeAudit } from './lib/activity-log.js';

const FETCH_LIMIT = 500;

async function fetchAll(clinicId) {
  const q = query(
    collection(db, 'patients'),
    where('clinicId', '==', clinicId)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((x) => x.deleted !== true)
    .slice(0, FETCH_LIMIT);
}

/**
 * Search patients by name prefix (case-insensitive).
 */
export async function searchByName(clinicId, prefix, max = 20) {
  const p = (prefix || '').trim().toLowerCase();
  if (!p) return [];
  const all = await fetchAll(clinicId);
  return all
    .filter((x) => {
      const n = (x.name_lower || x.name || '').toLowerCase();
      return n.startsWith(p);
    })
    .slice(0, max);
}

/**
 * Search patients by exact phone number.
 */
export async function searchByPhone(clinicId, phone) {
  const p = (phone || '').trim();
  if (!p) return [];
  const all = await fetchAll(clinicId);
  return all
    .filter((x) => (x.phone || '').trim() === p)
    .slice(0, 10);
}

/** Fetch a single patient by id. */
export async function get(id) {
  const snap = await getDoc(doc(db, 'patients', id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/** Check for an exact lowercased-name match in the clinic. */
export async function findExact(clinicId, nameLower) {
  const all = await fetchAll(clinicId);
  const match = all.find((x) => (x.name_lower || '').toLowerCase() === nameLower);
  return match || null;
}

/**
 * Create a new patient with the minimum fields the appointment
 * flow needs. Other fields (age, sex, address, referral) are left
 * empty and can be filled in later via BillBook.
 */
export async function create({ clinicId, name, phone }) {
  const m = me();
  const trimmedName = (name || '').trim();
  const trimmedPhone = (phone || '').trim();

  const record = {
    name: trimmedName,
    name_lower: trimmedName.toLowerCase(),
    phone: trimmedPhone,
    clinicId,
    age: null,
    sex: '',
    address: '',
    referral: '',
    created_at: serverTimestamp(),
    createdBy: m.uid,
    created_via: 'appointments',
    deleted: false
  };

  const ref = await addDoc(collection(db, 'patients'), record);
  try { await writeAudit('patient_created', ref.id); } catch {}
  return ref.id;
}