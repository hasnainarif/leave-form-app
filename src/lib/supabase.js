// src/lib/supabase.js
// Shared Supabase client for Crown Leave Form App.
// Uses the shared 'My Apps' project (never create a new project; the user is at the limit).
// Anon key arrives via VITE_SUPABASE_ANON_KEY at build time and may be absent on first
// deploy. Every function here fails gracefully: null/false on failure after console.warn,
// never an uncaught throw to the UI layer (except uploadSignatureImage, which throws a
// friendly Error that the caller must catch and display).

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';

const SIG_TABLE = 'leave_signatures';
const HOL_TABLE = 'leave_holidays';
const SIG_BUCKET = 'leave-signatures';

/** True when both VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are non-empty. */
export function isConfigured() {
  return Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);
}

let _client = null;

/** The shared Supabase client, or null when not configured. Created once. */
export function getClient() {
  if (!isConfigured()) return null;
  if (!_client) _client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  return _client;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

/** Current logged-in user (from the persisted session), or null. */
export async function getUser() {
  const sb = getClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb.auth.getUser();
    if (error) return null;
    return data?.user || null;
  } catch (e) {
    return null;
  }
}

/** Sign up with email + password. Returns { user, session, needsConfirm } or throws. */
export async function signUp(email, password) {
  const sb = getClient();
  if (!sb) throw new Error('Supabase is not connected yet.');
  const { data, error } = await sb.auth.signUp({ email, password });
  if (error) throw new Error(friendlyAuthError(error));
  return {
    user: data.user,
    session: data.session,
    needsConfirm: !data.session,
  };
}

/** Sign in with email + password. Returns the user or throws. */
export async function signIn(email, password) {
  const sb = getClient();
  if (!sb) throw new Error('Supabase is not connected yet.');
  const { data, error } = await sb.auth.signInWithPassword({ email, password });
  if (error) throw new Error(friendlyAuthError(error));
  return data.user;
}

/** Sign out. Never throws. */
export async function signOut() {
  const sb = getClient();
  if (!sb) return;
  try {
    await sb.auth.signOut();
  } catch (e) {
    console.warn('[supabase] signOut failed:', e.message);
  }
}

/** Subscribe to auth changes. Returns an unsubscribe function. */
export function onAuthChange(cb) {
  const sb = getClient();
  if (!sb) return () => {};
  const { data } = sb.auth.onAuthStateChange((_event, session) => {
    cb(session?.user || null);
  });
  return () => {
    try {
      data.subscription.unsubscribe();
    } catch (e) {
      // ignore
    }
  };
}

function friendlyAuthError(error) {
  const msg = (error && error.message) || 'Login failed.';
  if (/invalid login credentials/i.test(msg)) return 'Email ya password ghalat hai.';
  if (/user already registered/i.test(msg)) return 'Ye email pehle se registered hai. Login karein.';
  if (/password should be at least/i.test(msg)) return 'Password kam az kam 6 harf ka ho.';
  if (/email.*invalid/i.test(msg)) return 'Email address durust nahi hai.';
  return msg;
}

/** user_id of the current session (read from local storage, no network), or null. */
async function currentUserId() {
  const sb = getClient();
  if (!sb) return null;
  try {
    const { data } = await sb.auth.getSession();
    return data?.session?.user?.id || null;
  } catch (e) {
    return null;
  }
}

const KEY_TABLE = 'leave_api_keys';

/**
 * Load the CURRENT USER's Gemini API keys from the vault.
 * Returns string[] or null when logged out / on failure.
 */
export async function fetchApiKeys() {
  const sb = getClient();
  if (!sb) return null;
  const uid = await currentUserId();
  if (!uid) return null;
  try {
    const { data, error } = await sb
      .from(KEY_TABLE)
      .select('key_value')
      .eq('user_id', uid)
      .order('created_at', { ascending: true });
    if (error) {
      console.warn('[supabase] fetchApiKeys failed:', error.message);
      return null;
    }
    return (data || []).map((r) => r.key_value).filter(Boolean);
  } catch (e) {
    console.warn('[supabase] fetchApiKeys exception:', e);
    return null;
  }
}

/** Save one key to the vault (skips duplicates). Returns true on success. */
export async function saveApiKey(key) {
  const sb = getClient();
  if (!sb) return false;
  const uid = await currentUserId();
  const k = String(key || '').trim();
  if (!uid || !k) return false;
  try {
    const { data } = await sb.from(KEY_TABLE).select('id').eq('user_id', uid).eq('key_value', k).maybeSingle();
    if (data) return true;
    const { error } = await sb.from(KEY_TABLE).insert({ user_id: uid, key_value: k });
    if (error) {
      console.warn('[supabase] saveApiKey failed:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[supabase] saveApiKey exception:', e);
    return false;
  }
}

/** Remove one key from the vault. Returns true on success. */
export async function deleteApiKey(key) {
  const sb = getClient();
  if (!sb) return false;
  const uid = await currentUserId();
  const k = String(key || '').trim();
  if (!uid || !k) return false;
  try {
    const { error } = await sb.from(KEY_TABLE).delete().eq('user_id', uid).eq('key_value', k);
    if (error) {
      console.warn('[supabase] deleteApiKey failed:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[supabase] deleteApiKey exception:', e);
    return false;
  }
}

/**
 * One-time adoption: claim rows saved before accounts existed
 * (user_id IS NULL) for the current user. Runs after login; harmless
 * when there is nothing to adopt or the migration is not applied yet.
 */
export async function adoptOrphanRows() {
  const sb = getClient();
  if (!sb) return;
  const uid = await currentUserId();
  if (!uid) return;
  try {
    await sb.from(SIG_TABLE).update({ user_id: uid }).is('user_id', null);
    await sb.from(HOL_TABLE).update({ user_id: uid }).is('user_id', null);
    await sb.from(KEY_TABLE).update({ user_id: uid }).is('user_id', null);
  } catch (e) {
    console.warn('[supabase] adoptOrphanRows failed:', e.message);
  }
}

function mapSignature(row) {
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

function toRow(sig) {
  return {
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
 * Load the CURRENT USER's signatures, oldest first.
 * Returns mapped array, or null when logged out / on any failure
 * (caller falls back to session memory).
 */
export async function fetchSignatures() {
  const sb = getClient();
  if (!sb) return null;
  const uid = await currentUserId();
  if (!uid) return null;
  try {
    const { data, error } = await sb
      .from(SIG_TABLE)
      .select('*')
      .eq('user_id', uid)
      .order('created_at', { ascending: true });
    if (error) {
      console.warn('[supabase] fetchSignatures failed:', error.message);
      return null;
    }
    return (data || []).map(mapSignature).filter(Boolean);
  } catch (e) {
    console.warn('[supabase] fetchSignatures exception:', e);
    return null;
  }
}

/** Insert or update one signature for the current user. Returns the saved mapped row, or null. */
export async function upsertSignature(sig) {
  const sb = getClient();
  if (!sb) return null;
  const uid = await currentUserId();
  if (!uid) return null;
  try {
    const payload = { ...toRow(sig), user_id: uid };
    const query = sig.id && !String(sig.id).startsWith('local-')
      ? sb.from(SIG_TABLE).update(payload).eq('id', sig.id).eq('user_id', uid).select().single()
      : sb.from(SIG_TABLE).insert(payload).select().single();
    const { data, error } = await query;
    if (error) {
      console.warn('[supabase] upsertSignature failed:', error.message);
      return null;
    }
    return mapSignature(data);
  } catch (e) {
    console.warn('[supabase] upsertSignature exception:', e);
    return null;
  }
}

/** Delete a signature by id (current user only). Returns true on success, false otherwise. */
export async function deleteSignature(id) {
  const sb = getClient();
  if (!sb) return false;
  const uid = await currentUserId();
  if (!uid || String(id).startsWith('local-')) return false;
  try {
    const { error } = await sb.from(SIG_TABLE).delete().eq('id', id).eq('user_id', uid);
    if (error) {
      console.warn('[supabase] deleteSignature failed:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[supabase] deleteSignature exception:', e);
    return false;
  }
}

/**
 * Upload a signature image to the public 'leave-signatures' bucket.
 * Returns the public URL. Throws a friendly Error on failure; the caller
 * must catch it and show e.message to the user.
 */
export async function uploadSignatureImage(file) {
  const sb = getClient();
  if (!sb) throw new Error('Supabase is not connected yet, so the image cannot be uploaded.');
  if (!file) throw new Error('No image file was selected.');
  const ext = (file.name && file.name.split('.').pop().toLowerCase()) || 'png';
  const filename = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error } = await sb.storage
    .from(SIG_BUCKET)
    .upload(filename, file, { upsert: true, contentType: file.type || 'image/png' });
  if (error) {
    console.warn('[supabase] uploadSignatureImage failed:', error.message);
    throw new Error('Image upload failed. Please check your connection and try again.');
  }
  const { data } = sb.storage.from(SIG_BUCKET).getPublicUrl(filename);
  if (!data || !data.publicUrl) {
    throw new Error('Upload finished but the public URL could not be created.');
  }
  return data.publicUrl;
}

/**
 * Load the CURRENT USER's saved holidays for a month ('YYYY-MM').
 * Returns { holidays: string[], source } or null when logged out / missing / on failure.
 */
export async function fetchHolidays(month) {
  const sb = getClient();
  if (!sb) return null;
  const uid = await currentUserId();
  if (!uid) return null;
  try {
    const { data, error } = await sb
      .from(HOL_TABLE)
      .select('holidays, source')
      .eq('user_id', uid)
      .eq('month', month)
      .maybeSingle();
    if (error) {
      console.warn('[supabase] fetchHolidays failed:', error.message);
      return null;
    }
    if (!data) return null;
    return {
      holidays: Array.isArray(data.holidays) ? data.holidays : [],
      source: data.source || 'manual',
    };
  } catch (e) {
    console.warn('[supabase] fetchHolidays exception:', e);
    return null;
  }
}

/** Save (upsert) the current user's holiday list for a month. Returns true on success, false otherwise. */
export async function saveHolidays(month, holidays, source) {
  const sb = getClient();
  if (!sb) return false;
  const uid = await currentUserId();
  if (!uid) return false;
  try {
    const { error } = await sb.from(HOL_TABLE).upsert(
      {
        user_id: uid,
        month,
        holidays: Array.isArray(holidays) ? holidays : [],
        source: source || 'manual',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,month' }
    );
    if (error) {
      console.warn('[supabase] saveHolidays failed:', error.message);
      return false;
    }
    return true;
  } catch (e) {
    console.warn('[supabase] saveHolidays exception:', e);
    return false;
  }
}
