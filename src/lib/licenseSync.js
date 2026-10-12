// src/lib/licenseSync.js
// Multi-device signature sync for the buyer PC app — no login required.
//
// How it works:
// - The buyer's license key is the shared sync identity. Every PC with the
//   same license key reads/writes the same signature set in Supabase.
// - Only the SHA-256 hash of the key is stored/sent — the raw key never
//   leaves the device.
// - Talks to Supabase with the anon key (RLS policy "Anon license-key
//   signature sync" restricts anon to rows with user_id IS NULL AND
//   license_key_hash IS NOT NULL, so logged-in users' rows are untouched).
//
// Requires VITE_SUPABASE_URL + VITE_SUPABASE_ANON_KEY at build time (injected
// by CI for the buyer build). Every function fails gracefully — null/false on
// any failure — and never throws to the UI layer.

import { createClient } from '@supabase/supabase-js';
import { getLicenseKey } from './license.js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const SIG_TABLE = 'leave_signatures';

/** True when the sync backend keys were baked in at build time. */
export function isLicenseSyncConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

let _client = null;

/** Dedicated Supabase client for license sync (separate from the auth flow). */
function getSyncClient() {
  if (!isLicenseSyncConfigured()) return null;
  if (!_client) _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _client;
}

/** SHA-256 hex digest via Web Crypto. Async. Returns null on failure. */
export async function sha256Hex(str) {
  try {
    const data = new TextEncoder().encode(String(str || ''));
    const buf = await crypto.subtle.digest('SHA-256', data);
    return [...new Uint8Array(buf)]
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch (e) {
    console.warn('[licenseSync] sha256 failed:', e);
    return null;
  }
}

/**
 * The sync identity: SHA-256 of the license key.
 * Same key on every PC -> same identity -> one shared signature set.
 * Returns null when there is no license key (sync stays off).
 */
export async function getSyncId() {
  const key = getLicenseKey();
  if (!key) return null;
  return sha256Hex(key);
}

// DB row -> app signature shape (mirrors supabase.js mapSignature).
function mapRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label || '',
    imageUrl: row.image_url || '',
    position: row.position || 'dept_head',
    positionMeta: row.position_meta || {},
    conditionField: row.condition_field || 'department',
    conditionOp: row.condition_op || 'contains',
    conditionValue: row.condition_value || '',
  };
}

// App signature -> DB row. user_id stays NULL (anonymous license row).
function toRow(sig, syncId) {
  return {
    license_key_hash: syncId,
    user_id: null,
    label: (sig.label || 'Signature').trim() || 'Signature',
    image_url: sig.imageUrl,
    position: sig.position || 'dept_head',
    position_meta: sig.positionMeta || {},
    condition_field: sig.conditionField || 'department',
    condition_op: sig.conditionOp || 'contains',
    condition_value: (sig.conditionValue || '').trim() || null,
  };
}

/**
 * Fetch this license's signatures from Supabase.
 * Returns an array (possibly empty) or null on any failure / not configured.
 */
export async function fetchLicenseSignatures() {
  const sb = getSyncClient();
  if (!sb) return null;
  const syncId = await getSyncId();
  if (!syncId) return null;
  try {
    const { data, error } = await sb
      .from(SIG_TABLE)
      .select('*')
      .eq('license_key_hash', syncId)
      .order('created_at', { ascending: true });
    if (error) {
      console.warn('[licenseSync] fetch failed:', error.message);
      return null;
    }
    return (data || []).map(mapRow).filter(Boolean);
  } catch (e) {
    console.warn('[licenseSync] fetch exception:', e);
    return null;
  }
}

/**
 * Push the full signature list to Supabase: delete the license's existing
 * remote rows, then insert the current list. Returns true on success,
 * false on any failure / not configured.
 */
export async function pushLicenseSignatures(signatures) {
  const sb = getSyncClient();
  if (!sb) return false;
  const syncId = await getSyncId();
  if (!syncId) return false;
  const list = Array.isArray(signatures) ? signatures : [];
  try {
    const { error: delErr } = await sb
      .from(SIG_TABLE)
      .delete()
      .eq('license_key_hash', syncId);
    if (delErr) {
      console.warn('[licenseSync] push delete failed:', delErr.message);
      return false;
    }
    if (list.length > 0) {
      const { error: insErr } = await sb
        .from(SIG_TABLE)
        .insert(list.map((s) => toRow(s, syncId)));
      if (insErr) {
        console.warn('[licenseSync] push insert failed:', insErr.message);
        return false;
      }
    }
    return true;
  } catch (e) {
    console.warn('[licenseSync] push exception:', e);
    return false;
  }
}
