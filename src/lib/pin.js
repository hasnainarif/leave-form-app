/**
 * pin.js — App-level PIN lock.
 *
 * The PIN itself is NEVER stored. Only its SHA-256 hash is kept in
 * localStorage under APP_PIN_LS. Unlocking lasts for the browser session
 * only (in-memory); a fresh page load locks again.
 *
 * This is an app-level privacy lock (keeps casual visitors out), not
 * bank-grade security: anyone with full access to the browser profile
 * could clear localStorage. For this app's threat model (a public link
 * that should not be usable by strangers) it is the right tool.
 */

export const APP_PIN_LS = 'crown-leave-app-pin';

export async function sha256Hex(s) {
  const data = new TextEncoder().encode(String(s || ''));
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hasPin() {
  try {
    return !!localStorage.getItem(APP_PIN_LS);
  } catch (e) {
    return false;
  }
}

export async function verifyPin(pin) {
  try {
    const stored = localStorage.getItem(APP_PIN_LS);
    if (!stored) return false;
    const h = await sha256Hex(pin);
    return h === stored;
  } catch (e) {
    return false;
  }
}

export async function setPin(pin) {
  const h = await sha256Hex(pin);
  try {
    localStorage.setItem(APP_PIN_LS, h);
  } catch (e) {
    throw new Error('PIN save nahi ho saka.');
  }
}

export function clearPin() {
  try {
    localStorage.removeItem(APP_PIN_LS);
  } catch (e) {
    // ignore
  }
}
