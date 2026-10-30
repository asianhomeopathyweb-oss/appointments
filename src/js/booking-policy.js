// ============================================================
// Booking policy
//
// Decides whether a slot can be booked, and whether to warn.
// Warnings are non-blocking: staff can always override.
// Blocks are for patient-facing bookings only (future).
// ============================================================

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
