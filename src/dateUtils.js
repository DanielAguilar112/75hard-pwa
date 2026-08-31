// Local-timezone-safe date helpers. All dates are stored/compared as
// "YYYY-MM-DD" strings to avoid UTC drift issues.

const pad = (n) => String(n).padStart(2, "0");

export function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function parseDateStr(s) {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function formatDateStr(dateObj) {
  return `${dateObj.getFullYear()}-${pad(dateObj.getMonth() + 1)}-${pad(dateObj.getDate())}`;
}

export function daysBetween(aStr, bStr) {
  return Math.round((parseDateStr(bStr) - parseDateStr(aStr)) / 86400000);
}

// Day 1 falls on startStr itself.
export function dateForDay(startStr, n) {
  const d = parseDateStr(startStr);
  d.setDate(d.getDate() + (n - 1));
  return formatDateStr(d);
}

// Which day number "today" is, relative to startStr. Day 1 on the start date.
export function elapsedDay(startStr) {
  return daysBetween(startStr, todayStr()) + 1;
}

export function formatDisplayDate(dateStr) {
  const d = parseDateStr(dateStr);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}