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
        temperature: 0.1,
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
 * Fix typos/stray characters and transliterate a batch of roman-English
 * strings into Urdu script.
 * texts: string[]; kinds: label used in the prompt, e.g. 'names',
 *   'designations' or 'departments'; apiKey: Gemini API key.
 * Returns string[] of Urdu strings in the same order. Throws on any failure.
 */
export async function smartUrduFix(texts, kinds, apiKey) {
  const batches = chunk(texts.map(String), 50);
  const out = [];
  for (const batch of batches) {
    const prompt =
      `Fix typos/stray characters in these Pakistani factory employee ${kinds} ` +
      `written in English, then transliterate each to Urdu script. Return ONLY a ` +
      `JSON array of Urdu strings, same order, no explanations. ` +
      `Input: ${JSON.stringify(batch)}`;
    const arr = await geminiJson(prompt, apiKey, 800);
    if (!Array.isArray(arr) || arr.length !== batch.length) {
      throw new Error('Gemini returned an unexpected response shape');
    }
    out.push(...arr.map(String));
  }
  return out;
}

/**
 * List official government public holidays in Karachi, Sindh, Pakistan for
 * a given month ('YYYY-MM'). Returns string[] of 'YYYY-MM-DD'.
 * Throws on any failure so the caller can fall back to Sunday-only logic.
 */
export async function fetchKarachiHolidays(month, apiKey) {
  const [y, m] = String(month).split('-').map(Number);
  if (!y || !m) throw new Error('month must be in YYYY-MM format');
  const monthName = new Date(y, m - 1, 1).toLocaleString('en', { month: 'long' });
  const prompt =
    `List official government public holidays in Karachi, Sindh, Pakistan ` +
    `for ${monthName} ${y} as JSON array of YYYY-MM-DD strings only, no explanations.`;
  const arr = await geminiJson(prompt, apiKey, 200);
  if (!Array.isArray(arr)) throw new Error('Gemini returned an unexpected response shape');
  return arr.map(String).filter((s) => /^\d{4}-\d{2}-\d{2}$/.test(s));
}
