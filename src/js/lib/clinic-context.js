import { doc, getDoc } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from './firebase-init.js';
import { me } from './auth-guards.js';

const STORAGE_KEY = 'ah.activeClinicId';
const CLINIC_NAMES = { 'ah-ubl': 'Hubballi', 'ah-bza': 'Vijayawada' };

export function clinicName(id) { return CLINIC_NAMES[id] || id; }

export function listClinics() {
  const m = me();
  if (!m) return [];
  return m.clinicIds.map((id) => ({ id, name: clinicName(id) }));
}

export function getActiveClinicId() {
  const m = me();
  if (!m || m.clinicIds.length === 0) return null;
  if (m.clinicIds.length === 1) return m.clinicIds[0];
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored && m.clinicIds.includes(stored)) return stored;
  return m.clinicIds[0];
}

export function setActiveClinicId(id) {
  localStorage.setItem(STORAGE_KEY, id);
}

export async function getActiveClinic() {
  const id = getActiveClinicId();
  if (!id) return null;
  try {
    const snap = await getDoc(doc(db, 'clinics', id));
    if (!snap.exists()) return { id, name: clinicName(id) };
    const data = snap.data();
    return { id, ...data, name: data.name || clinicName(id) };
  } catch (err) {
    console.warn('[clinic-context] clinics doc fetch failed, using fallback:', err);
    return { id, name: clinicName(id) };
  }
}
