// ============================================================
// Appointments
//
// Read and write appointments in the appointments collection.
// Every query filters by clinicId. Every document carries a
// clinicId field, enforced by rules.
// ============================================================

import {
  collection,
  query,
  where,
  onSnapshot,
  getDocs,
  doc,
  getDoc,
  addDoc,
  updateDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./lib/firebase-init.js";
import { me } from "./lib/auth-guards.js";
import { writeAudit } from "./lib/activity-log.js";

/**
 * All appointments for a clinic on a given date.
 * SAFE: Only queries by clinicId (single field), then filters by
 * date and deleted in JavaScript. This avoids composite indexes.
 */
export async function listForDay(clinicId, dateISO) {
  const q = query(
    collection(db, "appointments"),
    where("clinicId", "==", clinicId)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => a.deleted !== true && a.date === dateISO)
    .sort((a, b) => {
      const slotCompare = (a.slot || '').localeCompare(b.slot || '');
      if (slotCompare !== 0) return slotCompare;
      return (a.order || 1) - (b.order || 1);
    });
}

/**
 * Subscribe to appointments for a clinic + date.
 * SAFE: Only queries by clinicId (single field), then filters by
 * date and deleted in JavaScript. This avoids composite indexes.
 */
export function subscribeForDay(clinicId, dateISO, onData, onError) {
  const q = query(
    collection(db, "appointments"),
    where("clinicId", "==", clinicId)
  );
  return onSnapshot(
    q,
    (snap) => {
      const rows = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .filter((a) => a.deleted !== true && a.date === dateISO)
        .sort((a, b) => {
          const slotCompare = (a.slot || '').localeCompare(b.slot || '');
          if (slotCompare !== 0) return slotCompare;
          return (a.order || 1) - (b.order || 1);
        });
      onData(rows);
    },
    (err) => {
      console.error("[appointments] subscribe failed:", err);
      if (onError) onError(err);
    }
  );
}

/**
 * All appointments for a patient, newest first.
 */
export async function listForPatient(clinicId, patientId) {
  const q = query(
    collection(db, "appointments"),
    where("clinicId", "==", clinicId)
  );
  const snap = await getDocs(q);
  return snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => a.patientId === patientId)
    .filter((a) => a.deleted !== true)
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''));
}

/**
 * Fetch a single appointment by id.
 */
export async function get(id) {
  const snap = await getDoc(doc(db, "appointments", id));
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() };
}

/**
 * Create a new appointment.
 */
export async function create(payload) {
  const m = me();
  const now = serverTimestamp();
  const record = {
    ...payload,
    status: payload.status || "booked",
    cancelledReason: payload.cancelledReason || "",
    notes: payload.notes || "",
    deleted: false,
    createdAt: now,
    updatedAt: now,
    createdBy: {
      uid: m.uid,
      name: m.name,
      role: m.role
    }
  };
  const ref = await addDoc(collection(db, "appointments"), record);
  try { await writeAudit("appointment_created", ref.id); } catch {}
  return ref.id;
}

/**
 * Change status of an appointment.
 */
export async function updateStatus(id, status, cancelledReason) {
  const patch = {
    status,
    updatedAt: serverTimestamp()
  };
  if (status === "cancelled") {
    patch.cancelledReason = cancelledReason || "";
  }
  await updateDoc(doc(db, "appointments", id), patch);
  const action = status === "cancelled" ? "appointment_cancelled" : "appointment_status_changed";
  try { await writeAudit(action, id); } catch {}
}

/**
 * Change order within a slot (for double-booked slots).
 */
export async function updateOrder(id, order) {
  await updateDoc(doc(db, "appointments", id), {
    order,
    updatedAt: serverTimestamp()
  });
}

/**
 * Move an appointment to a new date and slot.
 */
export async function reschedule(id, newDate, newSlot) {
  await updateDoc(doc(db, "appointments", id), {
    date: newDate,
    slot: newSlot,
    updatedAt: serverTimestamp()
  });
  try { await writeAudit("appointment_rescheduled", id); } catch {}
}

/**
 * Soft-delete an appointment (admin only, enforced by rules).
 */
export async function softDelete(id) {
  await updateDoc(doc(db, "appointments", id), {
    deleted: true,
    updatedAt: serverTimestamp()
  });
  try { await writeAudit("appointment_deleted", id); } catch {}
}