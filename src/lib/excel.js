/**
 * excel.js
 * Excel upload handling for the Crown Leave Form app.
 *
 * Uses the `xlsx` package (SheetJS), imported statically so Vite bundles it.
 * (A lazy `import('xlsx')` via a variable breaks Vite's static analysis and
 * leaves a bare-specifier dynamic import that fails at runtime in the browser.)
 */
import * as XLSX from 'xlsx';

/**
 * Read an uploaded file (.xlsx / .xls / .csv) and return its first sheet as
 * { headers: string[], rows: object[] }.
 * Rows are objects keyed by the (trimmed) header names; empty cells become ''.
 */
export async function parseFile(file) {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const json = XLSX.utils.sheet_to_json(ws, { defval: '', raw: true });
  if (!json.length) return { headers: [], rows: [] };
  const headers = Object.keys(json[0]).map((h) => String(h).trim());
  const rows = json.map((r) => {
    const o = {};
    for (const h of headers) o[h] = r[h] == null ? '' : r[h];
    return o;
  });
  return { headers, rows };
}

const normHeader = (h) => String(h).toLowerCase().replace(/[^a-z0-9]/g, '');

/* [targetKey, candidate substrings in priority order] */
const COL_SPECS = [
  ['ecode', ['ecode', 'empcode', 'employeecode', 'workercode', 'cardno', 'code', 'id']],
  ['name', ['employeename', 'empname', 'workername', 'name']],
  ['father', ['fathername', 'father', 'husband', 'guardian', 'sonof', 'fname']],
  ['designation', ['designation', 'des', 'post', 'occupation', 'title']],
  ['department', ['deptname', 'departmentname', 'department', 'dept', 'section']],
  ['date', ['leavedate', 'date', 'day', 'dt']],
  ['reason', ['reason', 'remarks', 'purpose', 'waja']],
];

/**
 * Auto-detect which header belongs to which logical column.
 * Case-insensitive substring matching. Returns
 * { ecode, name, father, designation, department, date, reason }
 * where each value is the matched header string, or null when not found.
 * Never invents a department: no match means null.
 */
export function detectColumns(headers) {
  const norms = (headers || []).map(normHeader);
  const claimed = new Set();
  const out = {};

  for (const [key, keys] of COL_SPECS) {
    let idx = -1;

    // Pass 1: exact match on the normalized header.
    for (const k of keys) {
      idx = norms.findIndex((n, i) => !claimed.has(i) && n === k);
      if (idx >= 0) break;
    }

    // Pass 2: substring match, in candidate priority order.
    if (idx < 0) {
      for (const k of keys) {
        idx = norms.findIndex((n, i) => {
          if (claimed.has(i) || !n.includes(k)) return false;
          // Keep "Name" away from father/husband/department-style headers.
          if (key === 'name' && /(father|husband|fname|dept|guardian)/.test(n)) return false;
          return true;
        });
        if (idx >= 0) break;
      }
    }

    out[key] = idx >= 0 ? headers[idx] : null;
    if (idx >= 0) claimed.add(idx);
  }

  return out;
}

/**
 * Normalize an Excel date cell into 'YYYY-MM-DD', or null when unparseable.
 *
 * Handles:
 *  - Excel serial numbers (e.g. 45888)
 *  - JS Date objects
 *  - Strings: '18/8/26', '18-08-2026', '2026-08-18'
 *  - Bare day numbers ('18', 19, '20' as string or number, any value 1..31):
 *    the sheet's month/year are applied. Optional (month, year) params
 *    default to the current month/year.
 */
export function normalizeDate(value, month, year) {
  const now = new Date();
  const m0 = month != null ? Number(month) : now.getMonth() + 1;
  const y0 = year != null ? Number(year) : now.getFullYear();

  if (value === null || value === undefined) return null;

  let day = null;
  let m = m0;
  let y = y0;

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    day = value.getDate();
    m = value.getMonth() + 1;
    y = value.getFullYear();
  } else if (typeof value === 'number' && Number.isFinite(value)) {
    const n = Math.round(value);
    if (n >= 1 && n <= 31) {
      day = n; // bare day number
    } else if (n > 31 && n < 2958466) {
      // Excel serial: days since 1899-12-30
      const d = new Date((n - 25569) * 86400000);
      day = d.getUTCDate();
      m = d.getUTCMonth() + 1;
      y = d.getUTCFullYear();
    } else {
      return null;
    }
  } else {
    const s = String(value).trim();
    if (!s) return null;
    let mm;
    if ((mm = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/))) {
      y = Number(mm[1]);
      m = Number(mm[2]);
      day = Number(mm[3]);
    } else if ((mm = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{2,4})$/))) {
      day = Number(mm[1]);
      m = Number(mm[2]);
      const yy = Number(mm[3]);
      y = yy < 100 ? 2000 + yy : yy; // day-first (DD/MM/YY), like the register
    } else if ((mm = s.match(/^(\d{1,2})$/))) {
      const n = Number(mm[1]);
      if (n >= 1 && n <= 31) day = n;
      else return null;
    } else {
      return null;
    }
  }

  if (m < 1 || m > 12 || day < 1 || day > 31) return null;
  const check = new Date(y, m - 1, day);
  if (check.getFullYear() !== y || check.getMonth() !== m - 1 || check.getDate() !== day) {
    return null; // impossible calendar date, e.g. 31/2
  }
  const pad = (n) => String(n).padStart(2, '0');
  return `${y}-${pad(m)}-${pad(day)}`;
}
