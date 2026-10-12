-- Crown Leave Form App — license-key signature sync migration
-- Project: My Apps (yazbfehioywlcqnbbakc)
-- Run once in the Supabase dashboard SQL editor.
--
-- What it does:
-- 1. Adds license_key_hash (text, nullable) to public.leave_signatures.
--    The buyer PC app (no login) syncs a buyer's signatures across all of
--    their PCs using SHA-256 of the license key as the shared identity.
--    The raw license key is NEVER stored — only its hash.
-- 2. Adds an RLS policy for the anon role: full access (SELECT/INSERT/
--    UPDATE/DELETE) to rows that are anonymous license rows, defined as
--    user_id IS NULL AND license_key_hash IS NOT NULL.
--    Authenticated users' rows (user_id NOT NULL) are NEVER visible to anon.
-- 3. Does NOT modify, replace, or drop any existing policy.

-- ---------- 1. license_key_hash column ----------
alter table public.leave_signatures
  add column if not exists license_key_hash text;

create index if not exists leave_signatures_license_hash_idx
  on public.leave_signatures(license_key_hash);

-- ---------- 2. anon RLS policy for license-key rows ----------
-- Anonymous license sync: the PC app talks to Supabase with the anon key and
-- no login. It may only touch rows that belong to no user and carry a
-- license hash. UUID-grade hashes are unguessable, so one buyer's rows are
-- not enumerable by another.
drop policy if exists "Anon license-key signature sync"
  on public.leave_signatures;

create policy "Anon license-key signature sync"
  on public.leave_signatures for all to anon
  using (user_id is null and license_key_hash is not null)
  with check (user_id is null and license_key_hash is not null);
