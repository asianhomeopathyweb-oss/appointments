// ============================================================
// Patients
//
// Firestore wrapper for the shared patients collection.
// Appointments creates and edits patients; BillBook also reads
// and edits them. Appointments never deletes.
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
  updateDoc,
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
 * Create a new patient.
 *
 * Required: clinicId, name.
 * Optional: phone, age, sex, address, referral.
 *
 * Fields not provided are stored as empty/null so the record
 * matches the shape of BillBook-created patients.
 */
export async function create({
  clinicId,
  name,
  phone,
  age,
  sex,
  address,
  referral
}) {
  const m = me();
  const trimmedName = (name || '').trim();
  const trimmedPhone = (phone || '').trim();

  const record = {
    name: trimmedName,
    name_lower: trimmedName.toLowerCase(),
    phone: trimmedPhone,
    clinicId,
    age: (age === null || age === undefined || age === '') ? null : Number(age),
    sex: sex || '',
    address: (address || '').trim(),
    referral: referral || '',
    created_at: serverTimestamp(),
    createdBy: m.uid,
    created_via: 'appointments',
    deleted: false
  };

  const ref = await addDoc(collection(db, 'patients'), record);
  try { await writeAudit('patient_created', ref.id); } catch {}
  return ref.id;
}

/**
 * Update an existing patient.
 *
 * Pass only the fields you want to change. This function will:
 *   - Trim string fields
 *   - Recompute name_lower if name is provided
 *   - Stamp updated_at, updatedBy, updated_via
 *   - Write an audit log entry
 *
 * It does NOT touch fields you don't pass in. So if BillBook
 * has a field that Appointments doesn't know about, it stays.
 */
export async function updatePatient(id, changes) {
  if (!id) throw new Error('updatePatient: id required');
  if (!changes || typeof changes !== 'object') {
    throw new Error('updatePatient: changes object required');
  }

  const m = me();
  const patch = { ...changes };

  // Normalize string fields if present
  if (typeof patch.name === 'string') {
    patch.name = patch.name.trim();
    patch.name_lower = patch.name.toLowerCase();
  }
  if (typeof patch.phone === 'string') {
    patch.phone = patch.phone.trim();
  }
  if (typeof patch.address === 'string') {
    patch.address = patch.address.trim();
  }
  if (patch.age === '' || patch.age === undefined) {
    patch.age = null;
  } else if (patch.age !== null && patch.age !== undefined) {
    patch.age = Number(patch.age);
  }

  // Stamp the update
  patch.updated_at = serverTimestamp();
  patch.updatedBy = m.uid;
  patch.updated_via = 'appointments';

  await updateDoc(doc(db, 'patients', id), patch);
  try { await writeAudit('patient_updated', id); } catch {}
  return true;
}