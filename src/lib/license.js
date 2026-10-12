/**
 * license.js — Buyer license management for the PC app.
 *
 * - First run: buyer enters the license key (e.g. CROWN-X7K2P9Q4).
 * - Every startup the app validates with the license server when online.
 * - Offline: the last verdict is trusted for `graceDays` (server-sent,
 *   default 1 day). After that the app locks until it can reach the server.
 * - Suspended/revoked keys lock the app immediately on the next check.
 * - Branding (company name, logo, pattern) comes with the verdict and is
 *   cached, so the buyer's factory identity shows even offline.
 *
 * Master builds (VITE_BUYER_BUILD != 'true') skip all of this.
 */

export const BUYER_MODE = import.meta.env.VITE_BUYER_BUILD === 'true';
export const LICENSE_SERVER = 'https://leave-form-license-server.vercel.app';
export const APP_VERSION = '1.1.0';

const LS_KEY = 'crown-leave-license-key';
const LS_CACHE = 'crown-leave-license-cache';
const LS_MACHINE = 'crown-leave-machine-id';
const LS_BRANDING = 'crown-leave-branding';

const KEY_RE = /^[A-Z0-9]{3,12}-[A-HJ-NP-Z2-9]{8}$/;

function readJson(k, fallback) {
  try {
    const raw = localStorage.getItem(k);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function writeJson(k, v) {
  try {
    localStorage.setItem(k, JSON.stringify(v));
  } catch { /* ignore */ }
}

export function getLicenseKey() {
  return (localStorage.getItem(LS_KEY) || '').trim().toUpperCase();
}
export function setLicenseKey(key) {
  localStorage.setItem(LS_KEY, String(key || '').trim().toUpperCase());
}
export function clearLicense() {
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(LS_CACHE);
}

export function isWellFormedKey(key) {
  return KEY_RE.test(String(key || '').trim().toUpperCase());
}

export function getMachineId() {
  let id = localStorage.getItem(LS_MACHINE);
  if (!id) {
    id = 'pc-' + Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
    try { localStorage.setItem(LS_MACHINE, id); } catch { /* ignore */ }
  }
  return id;
}

export function getCachedVerdict() {
  return readJson(LS_CACHE, null);
}
/** Normalize server branding to the shape the form renderer expects. */
function normalizeBranding(b) {
  if (!b) return null;
  const pattern = b.pattern || {};
  return {
    companyName: b.companyName || '',
    companyUrdu: pattern.company_ur || b.companyName || '',
    titleUrdu: pattern.title_ur || 'درخواست برائے چھٹی',
    logoUrl: b.logoUrl || null,
  };
}

export function getBranding() {
  return normalizeBranding(readJson(LS_BRANDING, null));
}

/**
 * Validate the license with the server.
 * Returns { status: 'valid'|'invalid', reason?, branding?, graceDays? }.
 * Throws on network failure (caller falls back to cache).
 */
export async function validateOnline(key) {
  const res = await fetch(`${LICENSE_SERVER}/api/leave-form/validate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, machineId: getMachineId() }),
  });
  if (!res.ok) throw new Error('server ' + res.status);
  const data = await res.json();
  // NOTE: data.signature is an HMAC signed by the server. The buyer app
  // intentionally does NOT verify it locally: verifying would require
  // shipping the HMAC secret inside the buyer app, where anyone could
  // extract it and forge "valid" verdicts offline. Trust here comes from
  // HTTPS to license.wabot.pk plus the server-side key-hash lookup.
  // (If we ever move to asymmetric signing, the app could verify with a
  // public key — tracked as a future hardening, not a v1 requirement.)
  const now = new Date().toISOString();
  if (data.valid) {
    const cache = {
      key, valid: true, keyId: data.keyId, checkedAt: data.checkedAt || now,
      graceDays: data.graceDays ?? 1, savedAt: now,
    };
    writeJson(LS_CACHE, cache);
    const branding = normalizeBranding(data.branding);
    if (branding) writeJson(LS_BRANDING, data.branding);
    return { status: 'valid', branding, graceDays: data.graceDays ?? 1 };
  }
  const cache = { key, valid: false, reason: data.reason || 'invalid', checkedAt: data.checkedAt || now, savedAt: now };
  writeJson(LS_CACHE, cache);
  return { status: 'invalid', reason: data.reason || 'invalid' };
}

/**
 * Decide whether the app may run right now.
 * Returns { ok: boolean, reason?: string, branding }.
 * reason: 'no-key' | 'suspended' | 'revoked' | 'invalid' | 'grace-expired' | 'offline'
 */
export async function checkLicense() {
  if (!BUYER_MODE) return { ok: true, branding: null };
  const key = getLicenseKey();
  if (!key || !isWellFormedKey(key)) return { ok: false, reason: 'no-key', branding: null };

  // Try a fresh online check first.
  try {
    const online = await validateOnline(key);
    if (online.status === 'valid') return { ok: true, branding: online.branding };
    return { ok: false, reason: online.reason, branding: getBranding() };
  } catch {
    // Offline — fall back to the cached verdict within its grace window.
  }

  const cache = getCachedVerdict();
  const branding = getBranding();
  if (!cache || cache.key !== key || !cache.valid) {
    return { ok: false, reason: 'offline', branding };
  }
  const graceMs = (cache.graceDays ?? 1) * 24 * 3600 * 1000;
  const ageMs = Date.now() - new Date(cache.checkedAt).getTime();
  if (ageMs > graceMs) {
    return { ok: false, reason: 'grace-expired', branding };
  }
  return { ok: true, branding, offline: true };
}

/**
 * Smart Urdu Fix through the license server (keys never touch the app).
 * items: [{ t, kind }]. Returns string[] aligned with items.
 */
export async function smartFixViaProxy(items) {
  const key = getLicenseKey();
  const res = await fetch(`${LICENSE_SERVER}/api/leave-form/gemini`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ key, items }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok) {
    throw new Error(data.error || ('proxy ' + res.status));
  }
  return data.fixed;
}

/** Check for a published update. Returns null when up to date. */
export async function checkForUpdate() {
  if (!BUYER_MODE) return null;
  const key = getLicenseKey();
  if (!key) return null;
  try {
    const res = await fetch(`${LICENSE_SERVER}/api/leave-form/version?key=${encodeURIComponent(key)}`);
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.ok || !data.version) return null;
    if (data.version !== APP_VERSION) {
      return { version: data.version, downloadUrl: data.downloadUrl, notes: data.releaseNotes };
    }
  } catch { /* offline — ignore */ }
  return null;
}
