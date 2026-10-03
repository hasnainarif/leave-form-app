/**
 * dates.js
 * Leave-date helpers: parsing, Sunday checks, display formatting and
 * "next working day" (to-date) calculation that skips Sundays and holidays.
 */

import { normalizeDate } from './excel.js';

const pad2 = (n) => String(n).padStart(2, '0');

function isoOf(d) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/**
 * Parse any supported date value (same inputs as normalizeDate) into a
 * Date at local midnight, or null when unparseable.
 */
export function parseLeaveDate(value) {
  const iso = normalizeDate(value);
  if (!iso) return null;
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}

/** True when the date is a Sunday (factory weekly off). */
export function isSunday(d) {
  return d.getDay() === 0;
}

/** Format as 'D/M/YY' with no leading zeros and a 2-digit year, e.g. 18/8/26. */
export function fmt(d) {
  return `${d.getDate()}/${d.getMonth() + 1}/${String(d.getFullYear()).slice(2)}`;
}

/**
 * The first working day after d: start at d + 1 day, then keep adding a day
 * while the date is a Sunday or appears in holidays (array of 'YYYY-MM-DD').
 */
export function nextWorkingDay(d, holidays = []) {
  const set = new Set(holidays || []);
  const cur = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1);
  while (isSunday(cur) || set.has(isoOf(cur))) {
    cur.setDate(cur.getDate() + 1);
  }
  return cur;
}
