// ============================================================
// Date and time utilities
//
// All dates in the app are ISO strings: "YYYY-MM-DD"
// All times are 24-hour strings:       "HH:mm"
// These strings sort correctly and compare correctly as strings.
//
// Display helpers (fmtDate, fmtSlot) convert to human-readable
// form. Storage helpers (todayISO, addDays) work on strings.
// ============================================================

/** Today's date as "YYYY-MM-DD", in the browser's local timezone. */
export function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** "YYYY-MM-DD" for the given Date object, in local time. */
export function dateToISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Parse "YYYY-MM-DD" to a Date at local midnight. */
export function isoToDate(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** Add n days to an ISO date. n can be negative. */
export function addDays(iso, n) {
  const d = isoToDate(iso);
  d.setDate(d.getDate() + n);
  return dateToISO(d);
}

/**
 * Add n months to an ISO date, clamping to the end of the month.
 * e.g. Jan 31 + 1 month = Feb 28 (or 29 in a leap year).
 */
export function addMonths(iso, n) {
  const [y, m, day] = iso.split('-').map(Number);
  const target = new Date(y, m - 1 + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return dateToISO(target);
}

/**
 * Follow-up interval in days -> target ISO date.
 *   30  days -> addMonths(iso, 1)
 *   60  days -> addMonths(iso, 2)
 *   90  days -> addMonths(iso, 3)
 *   180 days -> addMonths(iso, 6)
 *   365 days -> addMonths(iso, 12)
 *   anything else -> addDays(iso, n)
 *
 * The interval-to-month mapping is intentional: "1 month" means the
 * same day-of-month next month, not exactly 30 days.
 */
export function intervalToDate(fromISO, days) {
  const monthMap = { 30: 1, 60: 2, 90: 3, 180: 6, 365: 12 };
  if (monthMap[days] !== undefined) return addMonths(fromISO, monthMap[days]);
  return addDays(fromISO, days);
}

/** "13 Oct 2026" */
export function fmtDate(iso) {
  const d = isoToDate(iso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

/** "13 Oct" */
export function fmtDateShort(iso) {
  const d = isoToDate(iso);
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

/** "Tue" — day-of-week abbreviation for an ISO date. */
export function fmtDayShort(iso) {
  const d = isoToDate(iso);
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  return days[d.getDay()];
}

/**
 * "13:00" -> "1:00 PM"
 * "09:30" -> "9:30 AM"
 * "00:00" -> "12:00 AM"
 * "12:00" -> "12:00 PM"
 */
export function fmtSlot(slot) {
  const [hStr, mStr] = slot.split(':');
  let h = Number(hStr);
  const m = mStr;
  const ampm = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

/**
 * The nearest 15-minute slot to now, rounded down.
 * e.g. 11:07 -> "11:00"; 11:52 -> "11:45"
 */
export function nowSlot() {
  const d = new Date();
  const m = d.getMinutes();
  const rounded = Math.floor(m / 15) * 15;
  const h = String(d.getHours()).padStart(2, '0');
  const mm = String(rounded).padStart(2, '0');
  return `${h}:${mm}`;
}

/** True if the given ISO date is today. */
export function isToday(iso) {
  return iso === todayISO();
}

/** True if the given ISO date is in the past (before today). */
export function isPast(iso) {
  return iso < todayISO();
}

/** True if the given ISO date is in the future (after today). */
export function isFuture(iso) {
  return iso > todayISO();
}

/**
 * Human-friendly relative label for a date.
 *   today       -> "Today"
 *   tomorrow    -> "Tomorrow"
 *   yesterday   -> "Yesterday"
 *   within 7d   -> "Tue" (day name)
 *   else        -> "13 Oct"
 */
export function fmtRelative(iso) {
  const t = todayISO();
  if (iso === t) return 'Today';
  if (iso === addDays(t, 1)) return 'Tomorrow';
  if (iso === addDays(t, -1)) return 'Yesterday';
  const d = isoToDate(iso);
  const tD = isoToDate(t);
  const diffDays = Math.round((d - tD) / 86400000);
  if (diffDays >= -6 && diffDays <= 6) return fmtDayShort(iso);
  return fmtDateShort(iso);
}