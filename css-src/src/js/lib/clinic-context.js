import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './firebase-init.js';
import { me } from './auth-guards.js';

const STORAGE_KEY = 'ah.activeClinicId';

// Hard-coded fallback names. The clinics collection is the source of truth;
// this is only used before the collection is fetched, or if a doc is missing.
const CLINIC_NAMES = {
  'ah-ubl': 'Hubballi',
  'ah-bza': 'Vijayawada'
};

/** Display name for a clinic id, without a Firestore read. */
export function clinicName(id) {
  return CLINIC_NAMES[id] || id;
}

/**
 * Clinics the current user belongs to, as { id, name } pairs.
 * Uses the hard-coded names — cheap, no network. For richer data,
 * fetch the clinic document via getActiveClinic().
 */
export function listClinics() {
  const m = me();
  if (!m) return [];
  return m.clinicIds.map((id) => ({ id, name: clinicName(id) }));
}

/**
 * The active clinic id for this session.
 *
 * Rules:
 * - Staff belong to exactly one clinic → that clinic.
 * - Admins may belong to many → stored preference in localStorage,
 *   falling back to the first clinic in their clinicIds array.
 *
 * Returns null if the user belongs to no clinics.
 */
export function getActiveClinicId() {
  const m = me();
  if (!m || m.clinicIds.length === 0) return null;

  // Staff are single-clinic by definition.
  if (m.clinicIds.length === 1) return m.clinicIds[0];

  // Admin: read stored preference, fall back to first.
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && m.clinicIds.includes(stored)) return stored;

  return m.clinicIds[0];
}

/** Persist the active clinic for this browser. */
export function setActiveClinicId(id) {
  localStorage.setItem(STORAGE_KEY, id);
}

/**
 * The active clinic as a full object.
 * Reads clinics/{id} from Firestore; falls back to the hard-coded name
 * if the document is missing or unreadable.
 */
export async function getActiveClinic() {
  const id = getActiveClinicId();
  if (!id) return null;

  try {
    const snap = await getDoc(doc(db, 'clinics', id));
    if (!snap.exists()) {
      return { id, name: clinicName(id) };
    }
    const data = snap.data();
    return {
      id,
      ...data,
      name: data.name || clinicName(id)
    };
  } catch (err) {
    console.warn('[clinic-context] clinics doc fetch failed, using fallback:', err);
    return { id, name: clinicName(id) };
  }
}