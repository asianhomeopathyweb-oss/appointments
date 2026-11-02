// ============================================================
// Booking policy
// ============================================================

import { collection, query, where, getDocs } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";
import { db } from "./lib/firebase-init.js";
import { generateSlots } from "./slot-grid.js";

export function checkSlot({ existingCount, source }) {
  const count = Number(existingCount) || 0;
  const src = source || "frontdesk";
  if (src === "patient" && count >= 1) {
    return { allowed: false, reason: "This slot is already taken." };
  }
  if (count >= 1) {
    const n = count + 1;
    return {
      allowed: true,
      warn: `Slot already has ${count} patient${count > 1 ? "s" : ""}. This will be patient ${n}.`
    };
  }
  return { allowed: true };
}

export function slotsForType(type, newPatientSlots) {
  const n = Number(newPatientSlots) || 2;
  return type === "new" ? n : 1;
}

export function fitsInGrid(slots, slot, n) {
  const i = slots.indexOf(slot);
  if (i < 0) return false;
  return i + n <= slots.length;
}

// ============================================================
// Occupancy cache
// ============================================================

const _cache = new Map();

function _cacheKey(clinicId, dateISO) {
  return `${clinicId}|${dateISO}`;
}

async function _loadDay(clinicId, dateISO) {
  const key = _cacheKey(clinicId, dateISO);
  const hit = _cache.get(key);
  const now = Date.now();
  if (hit && now - hit.at < 30_000) return hit.rows;

  const q = query(
    collection(db, "appointments"),
    where("clinicId", "==", clinicId),
    where("date", "==", dateISO)
  );
  const snap = await getDocs(q);
  const rows = snap.docs
    .map((d) => ({ id: d.id, ...d.data() }))
    .filter((a) => a.deleted !== true);
  _cache.set(key, { at: now, rows });
  return rows;
}

export function invalidateOccupancy(clinicId, dateISO) {
  _cache.delete(_cacheKey(clinicId, dateISO));
}

export async function checkSlotOccupancy({ clinicId, dateISO, slot, excludeApptId }) {
  if (!clinicId || !dateISO || !slot) return { count: 0, conflict: null };

  const rows = await _loadDay(clinicId, dateISO);
  
  const scheduleSnap = await getDocs(query(collection(db, 'clinicSchedule'), where('clinicId', '==', clinicId)));
  const schedule = scheduleSnap.docs[0]?.data();
  const allSlots = schedule ? generateSlots(schedule) : [];
  const targetIndex = allSlots.indexOf(slot);

  let count = 0;
  let conflict = null;

  for (const a of rows) {
    if (a.id === excludeApptId) continue;
    if (a.status === 'cancelled') continue;

    const startIndex = allSlots.indexOf(a.slot);
    if (startIndex === -1) continue;

    const duration = a.durationSlots || 1;
    const endIndex = startIndex + duration;

    if (targetIndex !== -1 && targetIndex >= startIndex && targetIndex < endIndex) {
      count++;
      
      const isDurationConflict = targetIndex !== startIndex;
      
      // Prioritize the duration conflict in the conflict object
      if (!conflict || (isDurationConflict && !conflict.isDurationConflict)) {
        conflict = {
          id: a.id,
          patientName: a.patientName || "Patient",
          status: a.status || "booked",
          isDurationConflict: isDurationConflict
        };
      }
    }
  }

  return { count, conflict };
}