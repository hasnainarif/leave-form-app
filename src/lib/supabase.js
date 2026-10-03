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
 * Load all signatures, oldest first.
 * Returns mapped array, or null on any failure (caller falls back to session memory).
 */
export async function fetchSignatures() {
  const sb = getClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from(SIG_TABLE)
      .select('*')
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

/** Insert or update one signature. Returns the saved mapped row, or null on failure. */
export async function upsertSignature(sig) {
  const sb = getClient();
  if (!sb) return null;
  try {
    const payload = toRow(sig);
    const query = sig.id
      ? sb.from(SIG_TABLE).update(payload).eq('id', sig.id).select().single()
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

/** Delete a signature by id. Returns true on success, false otherwise. */
export async function deleteSignature(id) {
  const sb = getClient();
  if (!sb) return false;
  try {
    const { error } = await sb.from(SIG_TABLE).delete().eq('id', id);
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
 * Load saved holidays for a month ('YYYY-MM').
 * Returns { holidays: string[], source } or null when missing / on failure.
 */
export async function fetchHolidays(month) {
  const sb = getClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from(HOL_TABLE)
      .select('holidays, source')
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

/** Save (upsert) the holiday list for a month. Returns true on success, false otherwise. */
export async function saveHolidays(month, holidays, source) {
  const sb = getClient();
  if (!sb) return false;
  try {
    const { error } = await sb.from(HOL_TABLE).upsert(
      {
        month,
        holidays: Array.isArray(holidays) ? holidays : [],
        source: source || 'manual',
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'month' }
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
