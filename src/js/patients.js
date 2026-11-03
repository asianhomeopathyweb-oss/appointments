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

// Helper to force Title Case
function toTitleCase(str) {
  if (!str) return '';
  return String(str).trim().replace(/\s+/g, ' ').replace(/\S+/g, w =>
    w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()
  );
}

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
  const finalName = toTitleCase(name);
  const trimmedPhone = (phone || '').trim();

  const record = {
    name: finalName,
    name_lower: finalName.toLowerCase(),
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
    patch.name = toTitleCase(patch.name);
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
  
  // Sync denormalized data if name or phone changed
  if (patch.name || patch.phone) {
    await syncPatientDetails(id, patch.name, patch.phone);
  }

  try { await writeAudit('patient_updated', id); } catch {}
  return true;
}

/**
 * Sync updated name/phone to appointments, followUps, and calls
 */
async function syncPatientDetails(patientId, newName, newPhone) {
  const collections = ['appointments', 'followUps', 'calls'];
  
  for (const colName of collections) {
    try {
      // Query only by patientId to avoid composite index
      const q = query(collection(db, colName), where('patientId', '==', patientId));
      const snap = await getDocs(q);
      
      const updates = [];
      snap.forEach(d => {
        const data = d.data();
        const updateData = {};
        let needsUpdate = false;

        if (newName && data.patientName !== newName) {
          updateData.patientName = newName;
          needsUpdate = true;
        }
        if (newPhone && data.patientPhone !== newPhone) {
          updateData.patientPhone = newPhone;
          needsUpdate = true;
        }

        if (needsUpdate) {
          updates.push(updateDoc(doc(db, colName, d.id), updateData));
        }
      });

      if (updates.length > 0) {
        await Promise.all(updates);
      }
    } catch (err) {
      console.warn(`Failed to sync details in ${colName}`, err);
    }
  }
}