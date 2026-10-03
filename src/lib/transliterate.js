/**
 * transliterate.js
 * English (roman) -> Urdu script transliteration for factory employee data.
 *
 * Dictionary lookups are exact (case-insensitive, after stray characters are
 * stripped). Anything not in a dictionary falls back to a deterministic
 * generic English->Urdu phonetic map. Empty input always returns ''.
 * There is no hardcoded default department: empty department input -> ''.
 */

import { normalizeDate } from './excel.js';

/** Department dictionary (exact entries requested). */
export const DEPT_DICT = {
  FINISHING: 'فنشنگ',
  DYEING: 'ڈائنگ',
  CUTTING: 'کٹنگ',
  SECURITY: 'سیکیورٹی',
  ADMINISTRATION: 'ایڈمنسٹریشن',
  COMPLIANCE: 'کمپلائنس',
  ELASTIC: 'ایلاسٹک',
  STITCHING: 'اسٹچنگ',
  'OFF LINER': 'آف لائنر',
  OFFLINER: 'آف لائنر',
  'OFF-LINER': 'آف لائنر',
  OFFLINE: 'آف لائنر',
};

/** Designation dictionary, covering the roles in the sick-leave register sample. */
export const DESIG_DICT = {
  'OFF LINER': 'آف لائنر',
  OFFLINER: 'آف لائنر',
  'OFF-LINER': 'آف لائنر',
  'M-OPT': 'مشین آپریٹر',
  'M OPT': 'مشین آپریٹر',
  MOPT: 'مشین آپریٹر',
  'MACHINE OPERATOR': 'مشین آپریٹر',
  'FLAT LOCK OPERATOR': 'فلیٹ لاک آپریٹر',
  'OVER LOCK OPERATOR': 'اوور لاک آپریٹر',
  'LINE QC': 'لائن کیو سی',
  QC: 'کیو سی',
  'HTL MACHINE': 'ایچ ٹی ایل مشین',
  SUPERVISOR: 'سپروائزر',
  'SINGER NIDDLE OPERATOR': 'سنگر نیڈل آپریٹر',
  'SINGER NEEDLE OPERATOR': 'سنگر نیڈل آپریٹر',
  HELPER: 'ہیلپر',
  CHECKER: 'چیکر',
  PACKER: 'پیکر',
  CUTTER: 'کٹر',
  'IRON MAN': 'استری والا',
  PRESSMAN: 'پریس مین',
  'LINE INCHARGE': 'لائن انچارج',
  MANAGER: 'مینیجر',
};

/** Common reason phrases. */
export const REASON_DICT = {
  'DUE TO SICK': 'بیماری کی وجہ سے',
  'DUE TO ILLNESS': 'بیماری کی وجہ سے',
  'SICK LEAVE': 'بیماری کی وجہ سے',
  SICK: 'بیماری کی وجہ سے',
  'DUE TO FEVER': 'بخار کی وجہ سے',
  FEVER: 'بخار کی وجہ سے',
  CASUAL: 'اتفاقی کام کی وجہ سے',
  ANNUAL: 'سالانہ چھٹی',
};

const cleanKey = (text) =>
  String(text)
    .replace(/[\\/:;]+/g, ' ') // strip stray characters first
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

/* Generic English -> Urdu phonetic map (deterministic best-effort fallback). */
const DIGRAPHS = [
  ['kh', 'کھ'],
  ['gh', 'غ'],
  ['ch', 'چ'],
  ['sh', 'ش'],
  ['th', 'تھ'],
  ['ph', 'ف'],
  ['bh', 'بھ'],
  ['dh', 'دھ'],
  ['zh', 'ژ'],
  ['ng', 'نگ'],
  ['oo', 'و'],
  ['ee', 'ی'],
  ['ou', 'اؤ'],
  ['ai', 'ای'],
  ['au', 'اؤ'],
];

const LETTERS = {
  a: 'ا', b: 'ب', c: 'ک', d: 'د', e: 'ی', f: 'ف', g: 'گ', h: 'ہ',
  i: 'ی', j: 'ج', k: 'ک', l: 'ل', m: 'م', n: 'ن', o: 'و', p: 'پ',
  q: 'ق', r: 'ر', s: 'س', t: 'ت', u: 'و', v: 'و', w: 'و', x: 'کس',
  y: 'ی', z: 'ز',
};

function phonetic(text) {
  const s = String(text).toLowerCase();
  let out = '';
  let i = 0;
  while (i < s.length) {
    let matched = false;
    if (i + 1 < s.length) {
      const pair = s.slice(i, i + 2);
      const dig = DIGRAPHS.find(([d]) => d === pair);
      if (dig) {
        out += dig[1];
        i += 2;
        matched = true;
      }
    }
    if (!matched) {
      const ch = s[i];
      out += LETTERS[ch] !== undefined ? LETTERS[ch] : ch; // digits/spaces pass through
      i += 1;
    }
  }
  return out;
}

/**
 * Transliterate a roman-English string into Urdu script.
 * kind: 'name' | 'father' | 'designation' | 'department' | 'reason'.
 * Empty input -> ''. Department input that is empty -> '' (no defaults).
 */
export function transliterate(text, kind) {
  if (text === null || text === undefined) return '';
  const cleaned = String(text)
    .replace(/[\\/:;]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return '';

  const key = cleanKey(cleaned);
  const dict =
    kind === 'department' ? DEPT_DICT
    : kind === 'designation' ? DESIG_DICT
    : kind === 'reason' ? REASON_DICT
    : null;

  if (dict && dict[key]) return dict[key];

  // Department values often carry a unit number, e.g. 'STITCHING 04'.
  if (kind === 'department') {
    const m = key.match(/^(.+?)[\s\-]*(\d+)$/);
    if (m && DEPT_DICT[m[1].trim()]) {
      return `${DEPT_DICT[m[1].trim()]} ${m[2]}`;
    }
  }

  return phonetic(cleaned);
}

/**
 * Transliterate one raw sheet row into form-ready data.
 * row: raw object keyed by header; mapping: { ecode, name, father,
 *   designation, department, date, reason } as returned by detectColumns
 *   (values are header strings or null).
 * opts: optional { month, year } for bare day-number dates.
 */
export function transliterateRow(row, mapping, opts = {}) {
  const get = (field) =>
    mapping && mapping[field] != null ? row[mapping[field]] : '';
  return {
    ecode: String(get('ecode') ?? '').trim(),
    name: transliterate(get('name'), 'name'),
    father: transliterate(get('father'), 'father'),
    designation: transliterate(get('designation'), 'designation'),
    department: transliterate(get('department'), 'department'),
    date: normalizeDate(get('date'), opts.month, opts.year) || '',
    reason: transliterate(get('reason'), 'reason'),
  };
}
