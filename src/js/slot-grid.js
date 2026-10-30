// ============================================================
// Slot grid
//
// Turns a clinicSchedule into a list of time slots for a given day.
// Every slot is a 24-hour "HH:mm" string, e.g. "09:30", "09:45".
//
// If a day is closed, or no schedule is provided, the list is empty.
// If a break is configured (breakStart and breakEnd are non-empty),
// the slots between them are excluded from the grid.
// ============================================================

import { isoToDate } from "./date-utils.js";

/**
 * Generate every slot in a day, from openTime to closeTime,
 * stepping by slotMinutes. Excludes break slots if configured.
 * Returns an array of "HH:mm" strings.
 */
export function generateSlots(schedule) {
  if (!schedule) return [];
  const { openTime, closeTime, slotMinutes, breakStart, breakEnd } = schedule;
  if (!openTime || !closeTime || !slotMinutes) return [];

  const slots = [];
  const [openH, openM] = openTime.split(":").map(Number);
  const [closeH, closeM] = closeTime.split(":").map(Number);
  let cur = openH * 60 + openM;
  const end = closeH * 60 + closeM;
  const step = slotMinutes;

  const hasBreak = Boolean(breakStart) && Boolean(breakEnd);
  let brkS = -1;
  let brkE = -1;
  if (hasBreak) {
    const [bhS, bmS] = breakStart.split(":").map(Number);
    const [bhE, bmE] = breakEnd.split(":").map(Number);
    brkS = bhS * 60 + bmS;
    brkE = bhE * 60 + bmE;
  }

  while (cur < end) {
    if (!(hasBreak && cur >= brkS && cur < brkE)) {
      const h = String(Math.floor(cur / 60)).padStart(2, "0");
      const m = String(cur % 60).padStart(2, "0");
      slots.push(`${h}:${m}`);
    }
    cur += step;
  }
  return slots;
}

/**
 * Is the clinic open on the given ISO date?
 * Uses daysOpen (array of JS day numbers, 0=Sun..6=Sat).
 * Missing daysOpen treats the day as closed.
 */
export function isDayOpen(schedule, dateISO) {
  if (!schedule || !Array.isArray(schedule.daysOpen)) return false;
  const d = isoToDate(dateISO);
  return schedule.daysOpen.includes(d.getDay());
}

/**
 * Is the given slot inside a configured break?
 * Returns false if no break is set.
 */
export function isBreak(schedule, slot) {
  if (!schedule) return false;
  const { breakStart, breakEnd } = schedule;
  if (!breakStart || !breakEnd) return false;
  return slot >= breakStart && slot < breakEnd;
}

/**
 * Slot index (0-based) of a given time within a grid.
 * Returns -1 if the time is not on the grid.
 */
export function slotIndex(slots, slot) {
  return slots.indexOf(slot);
}

/**
 * Add N slots to a slot string, using the schedule step.
 * e.g. addSlotMinutes("09:30", 15, 2) -> "10:00"
 */
export function addSlotMinutes(slot, slotMinutes, n) {
  const [h, m] = slot.split(":").map(Number);
  const total = h * 60 + m + slotMinutes * n;
  const hh = String(Math.floor(total / 60)).padStart(2, "0");
  const mm = String(total % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}
