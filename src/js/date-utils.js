// ============================================================
// Date and time utilities
//
// All dates in the app are ISO strings: "YYYY-MM-DD"
// All times are 24-hour strings:       "HH:mm"
// These strings sort correctly and compare correctly as strings.
// ============================================================

export function todayISO() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function dateToISO(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function isoToDate(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function addDays(iso, n) {
  const d = isoToDate(iso);
  d.setDate(d.getDate() + n);
  return dateToISO(d);
}

export function addMonths(iso, n) {
  const [y, m, day] = iso.split("-").map(Number);
  const target = new Date(y, m - 1 + n, 1);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return dateToISO(target);
}

export function intervalToDate(fromISO, days) {
  const monthMap = { 30: 1, 60: 2, 90: 3, 180: 6, 365: 12 };
  if (monthMap[days] !== undefined) return addMonths(fromISO, monthMap[days]);
  return addDays(fromISO, days);
}

export function fmtDate(iso) {
  const d = isoToDate(iso);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}

export function fmtDateShort(iso) {
  const d = isoToDate(iso);
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  return `${d.getDate()} ${months[d.getMonth()]}`;
}

export function fmtDayShort(iso) {
  const d = isoToDate(iso);
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  return days[d.getDay()];
}

export function fmtSlot(slot) {
  const [hStr, mStr] = slot.split(":");
  let h = Number(hStr);
  const m = mStr;
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${ampm}`;
}

export function nowSlot() {
  const d = new Date();
  const m = d.getMinutes();
  const rounded = Math.floor(m / 15) * 15;
  const h = String(d.getHours()).padStart(2, "0");
  const mm = String(rounded).padStart(2, "0");
  return `${h}:${mm}`;
}

export function isToday(iso) {
  return iso === todayISO();
}

export function isPast(iso) {
  return iso < todayISO();
}

export function isFuture(iso) {
  return iso > todayISO();
}

export function fmtRelative(iso) {
  const t = todayISO();
  if (iso === t) return "Today";
  if (iso === addDays(t, 1)) return "Tomorrow";
  if (iso === addDays(t, -1)) return "Yesterday";
  const d = isoToDate(iso);
  const tD = isoToDate(t);
  const diffDays = Math.round((d - tD) / 86400000);
  if (diffDays >= -6 && diffDays <= 6) return fmtDayShort(iso);
  return fmtDateShort(iso);
}
