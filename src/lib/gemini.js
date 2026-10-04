/**
 * gemini.js
 * Direct browser calls to the Gemini API for two jobs:
 *  1. smartUrduFix: clean up + transliterate batches of roman-English
 *     names/designations/departments into proper Urdu script.
 *  2. fetchKarachiHolidays: official public holidays for a month.
 *
 * The API key is NEVER hardcoded here; it is always passed in by the caller.
 */

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent';

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * Low-level JSON-mode call. Throws on any failure (network, non-2xx,
 * empty response, invalid JSON) so the caller can fall back to the
 * local transliteration engine.
 */
async function geminiJson(prompt, apiKey, maxOutputTokens) {
  if (!apiKey) throw new Error('Gemini API key is required');
  const res = await fetch(GEMINI_URL, {
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
  if (!res.ok) {
    throw new Error(`Gemini request failed with status ${res.status}`);
  }
  let json;
  try {
    json = await res.json();
  } catch {
    throw new Error('Gemini returned a non-JSON response');
  }
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned no text');
  return JSON.parse(text);
}

/**
 * Normalize a single key string or an array of keys into a clean array.
 */
function asKeys(k) {
  if (Array.isArray(k)) return k.map((x) => String(x || '').trim()).filter(Boolean);
  const s = String(k || '').trim();
  return s ? [s] : [];
}

/**
 * Try fn(key) with each key in rotation; returns the first success.
 * Throws the last error if every key fails.
 */
async function tryKeys(keys, fn) {
  let lastErr = null;
  for (const key of keys) {
    try {
      return await fn(key);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr || new Error('All Gemini keys failed');
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
    throw new Error('Gemini returned an unexpected response shape');
  }
  return arr.map(String);
}

/**
 * Fix one batch, rotating through keys. On persistent failure the batch is
 * split in half and each half is retried (up to 2 splits) — small batches
 * survive truncated or malformed responses that kill big ones.
 */
async function fixBatch(pairs, keys, depth = 0) {
  try {
    // 3 full rounds across all keys before giving up on this batch size.
    let lastErr = null;
    for (let round = 0; round < 3; round++) {
      try {
        return await tryKeys(keys, (key) => callUrduFixOnce(pairs, key));
      } catch (e) {
        lastErr = e;
      }
    }
    throw lastErr;
  } catch (e) {
    if (depth < 2 && pairs.length > 1) {
      const mid = Math.ceil(pairs.length / 2);
      const a = await fixBatch(pairs.slice(0, mid), keys, depth + 1);
      const b = await fixBatch(pairs.slice(mid), keys, depth + 1);
      return [...a, ...b];
    }
    throw e;
  }
}

/**
 * Fix typos/stray characters and transliterate a batch of roman-English
 * strings into Urdu script.
 * texts: string[] of original ENGLISH values; kinds: string[] with one label
 *   per value ('name', 'father', 'designation', 'department', 'reason');
 *   apiKeys: one key string or an array of key strings (tried in rotation).
 * Returns string[] of Urdu strings in the same order. Throws only when every
 * key fails repeatedly, after automatic retries and batch splitting.
 */
export async function smartUrduFix(texts, kinds, apiKeys) {
  const keys = asKeys(apiKeys);
  if (!keys.length) throw new Error('Gemini API key is required');
  const items = texts.map(String);
  const labels = Array.isArray(kinds) ? kinds.map(String) : [];
  const pairs = items.map((t, i) => ({ t, kind: labels[i] || 'name' }));
  const out = [];
  for (const batch of chunk(pairs, 20)) {
    out.push(...(await fixBatch(batch, keys)));
  }
  return out;
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
  const arr = await tryKeys(keys, (key) => geminiJson(prompt, key, 200));
  if (!Array.isArray(arr)) throw new Error('Gemini returned an unexpected response shape');
  return arr.map(String).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
}
