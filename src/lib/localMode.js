/**
 * localMode.js — PC (Electron) build support.
 *
 * When the app runs inside the Electron wrapper, window.electronAPI exists
 * (injected by preload.js before any page script runs). In that case the app
 * runs in LOCAL MODE:
 *   - No Supabase account / login. The user is the local superadmin.
 *   - Signatures, dictionary entries and settings persist in localStorage
 *     on the PC itself (signature images as data URLs, not blob URLs).
 *   - A master ONLINE/OFFLINE switch decides whether the app may touch the
 *     network at all (Gemini API). Offline = zero external requests.
 *
 * The web build (GitHub Pages) never has window.electronAPI, so it is
 * completely unaffected by all of this.
 */

export function isLocalMode() {
  try {
    return !!(window.electronAPI && window.electronAPI.isElectron);
  } catch (e) {
    return false;
  }
}

/** The local superadmin identity used instead of a Supabase login. */
export const LOCAL_USER = { id: 'local-superadmin', email: 'Superadmin (PC)' };

const LS_SIGS = 'crown-leave-local-signatures';
const LS_DICT = 'crown-leave-local-dictionary';
const LS_ONLINE = 'crown-leave-online-mode'; // '0' = offline, anything else = online
const LS_HOLIDAYS = 'crown-leave-local-holidays';

function readJson(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const v = JSON.parse(raw);
    return v === undefined ? fallback : v;
  } catch (e) {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    // storage full or unavailable — app keeps running in memory
  }
}

export const loadLocalSignatures = () => readJson(LS_SIGS, []);
export const saveLocalSignatures = (sigs) => writeJson(LS_SIGS, sigs || []);
export const loadLocalDictionary = () => readJson(LS_DICT, []);
export const saveLocalDictionary = (rows) => writeJson(LS_DICT, rows || []);
export const loadLocalHolidays = () => readJson(LS_HOLIDAYS, []);
export const saveLocalHolidays = (h) => writeJson(LS_HOLIDAYS, h || []);

/** Online mode persists; default is ON (online). */
export function loadOnlineMode() {
  try {
    return localStorage.getItem(LS_ONLINE) !== '0';
  } catch (e) {
    return true;
  }
}

export function saveOnlineMode(online) {
  try {
    localStorage.setItem(LS_ONLINE, online ? '1' : '0');
  } catch (e) {
    // ignore
  }
  // Tell the Electron shell so it can hard-block the network when offline.
  try {
    if (window.electronAPI && typeof window.electronAPI.setOfflineMode === 'function') {
      window.electronAPI.setOfflineMode(!online);
    }
  } catch (e) {
    // ignore
  }
}

/** Convert an uploaded File to a data URL (survives restarts, unlike blob: URLs). */
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    try {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error('read-failed'));
      reader.readAsDataURL(file);
    } catch (e) {
      reject(e);
    }
  });
}
