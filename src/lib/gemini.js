/**
 * gemini.js
 * Direct browser calls to the Gemini API for two jobs:
 *  1. smartUrduFix: clean up + transliterate batches of roman-English
 *     names/designations/departments into proper Urdu script.
 *  2. fetchKarachiHolidays: official public holidays for a month.
 *
 * The API key is NEVER hardcoded here; it is always passed in by the caller.
 *
 * smartUrduFix strategy (rewritten 2026-10-04):
 *  1. DEDUP — only UNIQUE (kind, text) pairs are sent to Gemini. If "Ali"
 *     appears 10 times it is asked ONCE and the answer is reused 10 times.
 *     Same for repeated departments/reasons ("STITCHING 04", "Due to sick").
 *     This is where most token waste was.
 *  2. PARALLEL — unique values are split into bunches (~20); every API key
 *     gets its own worker and all workers drain one shared queue at the
 *     same time (Promise.all). 10 keys = ~10x throughput.
 *  3. DEAD-KEY RETIREMENT — a key that fails 3 times in a row is retired for
 *     the rest of the run instead of being hammered; its bunch goes back to
 *     the queue for a working key.
 *  4. REAL ERRORS — the API's own error text (invalid key, quota, model not
 *     found) is captured per key and surfaced, instead of a vague message.
 */

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

const BUNCH_SIZE = 20;
const MAX_CONSEC_FAILS = 3;

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Low-level JSON-mode call. Throws on any failure with the API's own
 * message when available (invalid key, quota exceeded, model not found…).
 */
async function geminiJson(prompt, apiKey, maxOutputTokens) {
  if (!apiKey) throw new Error('Gemini API key is required');
  let res;
  try {
    res = await fetch(GEMINI_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          maxOutputTokens,
          temperature: 0,
          responseMimeType: 'application/json',
        },
      }),
    });
  } catch (e) {
    throw new Error('Internet ya network ka masla hai (' + (e.message || 'fetch failed') + ')');
  }
  if (!res.ok) {
    let detail = '';
    try {
      const body = await res.json();
      detail = body?.error?.message || '';
    } catch {
      // ignore
    }
    throw new Error(`Gemini API error ${res.status}${detail ? ': ' + detail : ''}`);
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error('Gemini ne ghalat jawab bheja (non-JSON)');
  }
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini ne khaali jawab bheja');
  try {
    return JSON.parse(text);
  } catch {
    throw new Error('Gemini ka jawab samajh nahi aaya (invalid JSON)');
  }
}

/**
 * Normalize a single key string or an array of keys into a clean array.
 * Also accepts a big pasted blob (one key per line / comma / space separated).
 */
function asKeys(k) {
  const push = (s, arr) => {
    String(s || '')
      .split(/[\s,;]+/)
      .map((x) => x.trim())
      .filter(Boolean)
      .forEach((x) => {
        if (!arr.includes(x)) arr.push(x);
      });
  };
  const out = [];
  if (Array.isArray(k)) k.forEach((x) => push(x, out));
  else push(k, out);
  return out;
}

const URDU_FIX_PROMPT_HEAD =
  `You are a careful Urdu data-entry assistant for a Pakistani textile factory. ` +
  `Below are values in English, each labelled with its field type. Fix any typos or ` +
  `stray characters, then write each in proper Urdu script.\n` +
  `Rules:\n` +
  `- [name] / [father]: transliterate the person's name with correct Urdu spelling ` +
  `(e.g. "MUHAMMAD ASLAM" -> "محمد اسلم", "RUQSANA BIBI" -> "رقصانہ بی بی").\n` +
  `- [designation]: translate common job titles (e.g. "OFFICER" -> "آفیسر").\n` +
  `- [department]: translate generic words but KEEP department codes in English ` +
  `(e.g. "STITCHING 04" stays "STITCHING 04").\n` +
  `- [reason]: translate to natural Urdu (e.g. "Due to sick" -> "بیماری کی وجہ سے").\n` +
  `- Return ONLY a JSON array of Urdu strings, in the same order, no commentary.\n` +
  `Values:\n`;

async function callUrduFixOnce(pairs, key) {
  const lines = pairs.map((it, i) => `${i + 1}. [${it.kind}] "${it.t}"`).join('\n');
  const arr = await geminiJson(URDU_FIX_PROMPT_HEAD + lines, key, 4000);
  if (!Array.isArray(arr) || arr.length !== pairs.length) {
    throw new Error('Gemini ne ghalat shape ka jawab bheja');
  }
  return arr.map(String);
}

/**
 * Transliterate roman-English strings into Urdu script.
 *
 * texts: string[] of original ENGLISH values (duplicates allowed — they are
 *   asked only ONCE and the answer is reused everywhere).
 * kinds: string[] with one label per value ('name', 'father', 'designation',
 *   'department', 'reason').
 * apiKeys: one key, an array of keys, or a pasted blob. Every key works IN
 *   PARALLEL on its own share of the data.
 * onProgress(done, total): called as unique values complete.
 *
 * Returns string[] aligned with `texts` (null for values that failed; the
 * caller falls back to local transliteration for those).
 * Throws ONLY when every value failed — the error carries `.keyErrors`
 * (e.g. ["Key 1: Gemini API error 429: quota exceeded", ...]) so the UI can
 * show the REAL reason instead of a vague message.
 */
export async function smartUrduFix(texts, kinds, apiKeys, onProgress) {
  const keys = asKeys(apiKeys);
  if (!keys.length) throw new Error('Gemini API key is required');

  // ---- 1. DEDUP: ask each unique (kind, text) only once ----
  const seen = new Map();
  const uniques = [];
  const indexMap = new Array(texts.length);
  texts.forEach((raw, i) => {
    const t = String(raw);
    const kind = (kinds && kinds[i]) || 'name';
    const ck = kind + '' + t;
    let ui = seen.get(ck);
    if (ui === undefined) {
      ui = uniques.length;
      seen.set(ck, ui);
      uniques.push({ t, kind, idx: ui });
    }
    indexMap[i] = ui;
  });

  const total = uniques.length;
  const out = new Array(total).fill(null);
  const keyErrors = new Map(); // keyIdx -> last error message
  const deadKeys = new Set();
  let done = 0;
  const report = () => {
    if (typeof onProgress === 'function') {
      try {
        onProgress(done, total);
      } catch {
        // ignore
      }
    }
  };

  // ---- 2. Shared queue of bunches; one worker per key, all in parallel ----
  const queue = chunk(uniques, BUNCH_SIZE).map((items) => ({ items, depth: 0 }));
  let inFlight = 0;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  async function worker(keyIdx) {
    const key = keys[keyIdx];
    let consecFails = 0;
    for (;;) {
      if (deadKeys.has(keyIdx)) return;
      const bunch = queue.shift();
      if (!bunch) {
        // Queue khali hai — lekin koi worker abhi process kar raha ho to wo
        // bunch wapas dal sakta hai (retire/bisect), is liye thoda intezar.
        if (inFlight === 0) return;
        await sleep(80);
        continue;
      }
      inFlight += 1;
      try {
        const arr = await callUrduFixOnce(bunch.items, key);
        bunch.items.forEach((item, j) => {
          out[item.idx] = arr[j];
        });
        done += bunch.items.length;
        consecFails = 0;
        keyErrors.delete(keyIdx);
        report();
      } catch (e) {
        consecFails += 1;
        keyErrors.set(keyIdx, e.message || String(e));
        if (keys.length > 1 && consecFails >= MAX_CONSEC_FAILS) {
          // Ye key is run ke liye dead — bunch wapas, worker band.
          deadKeys.add(keyIdx);
          queue.unshift(bunch);
          return;
        }
        if (bunch.depth < 2 && bunch.items.length > 1) {
          // Musalsal nakami: aadha kar ke dobara (shayad doosri key se) try.
          const mid = Math.ceil(bunch.items.length / 2);
          queue.push(
            { items: bunch.items.slice(0, mid), depth: bunch.depth + 1 },
            { items: bunch.items.slice(mid), depth: bunch.depth + 1 }
          );
        } else {
          bunch.depth += 1;
          if (bunch.depth <= 4) queue.push(bunch);
          // else: chor do, caller local Urdu use karega
        }
      } finally {
        inFlight -= 1;
      }
    }
  }

  await Promise.all(keys.map((_, i) => worker(i)));

  // ---- 3. Map back to the original order (duplicates share the answer) ----
  const result = new Array(texts.length);
  let failed = 0;
  for (let i = 0; i < texts.length; i++) {
    const v = out[indexMap[i]];
    result[i] = v;
    if (v == null || !String(v).trim()) failed += 1;
  }

  if (failed === texts.length && texts.length > 0) {
    const err = new Error('Gemini se koi jawab nahi mila');
    err.keyErrors = [...keyErrors.entries()].map(([i, msg]) => `Key ${i + 1}: ${msg}`);
    err.failedCount = failed;
    throw err;
  }
  const err = failed > 0 ? new Error(`${failed}/${texts.length} values reh gayin`) : null;
  if (err) {
    err.keyErrors = [...keyErrors.entries()].map(([i, msg]) => `Key ${i + 1}: ${msg}`);
    err.failedCount = failed;
    err.partial = result;
  }
  if (err && err.partial) {
    // Partial success: still throw so the caller shows the honest count,
    // but carry the good values along.
    throw err;
  }
  return result;
}

/**
 * List official government public holidays in Karachi, Sindh, Pakistan for
 * a given month ('YYYY-MM'). Returns string[] of 'YYYY-MM-DD'.
 * Throws on any failure so the caller can fall back to Sunday-only logic.
 */
export async function fetchKarachiHolidays(month, apiKeys) {
  const keys = asKeys(apiKeys);
  if (!keys.length) throw new Error('Gemini API key is required');
  const [y, m] = String(month).split('-').map(Number);
  if (!y || !m) throw new Error('month must be in YYYY-MM format');
  const monthName = new Date(y, m - 1, 1).toLocaleString('en', { month: 'long' });
  const prompt =
    `List official government public holidays in Karachi, Sindh, Pakistan ` +
    `for ${monthName} ${y} as JSON array of YYYY-MM-DD strings only, no explanations.`;
  let lastErr = null;
  for (const key of keys) {
    try {
      const arr = await geminiJson(prompt, key, 200);
      if (!Array.isArray(arr)) throw new Error('Gemini ne ghalat shape ka jawab bheja');
      return arr.map(String).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('All Gemini keys failed');
}
