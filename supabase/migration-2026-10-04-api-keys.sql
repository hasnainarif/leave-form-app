-- Crown Leave Form App — Gemini API key vault (per user)
-- Project: My Apps (yazbfehioywlcqnbbakc)
-- Run once in the Supabase dashboard SQL editor.
--
-- Stores the user's Gemini API keys server-side so the app can load them
-- automatically after login (no manual paste needed). Keys are per-user:
-- RLS ensures a logged-in user only ever sees their OWN keys.
-- Rows with user_id NULL are "orphans" for first-login adoption
-- (same pattern as leave_signatures / leave_holidays).

create table if not exists public.leave_api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users(id) on delete cascade,
  key_value text not null,
  label text,
  created_at timestamptz not null default now()
);

create index if not exists leave_api_keys_user_id_idx
  on public.leave_api_keys(user_id);

alter table public.leave_api_keys enable row level security;

-- Drop any existing policies on this table (fresh table, but be safe).
do $$
declare p text;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'leave_api_keys'
  loop
    execute 'drop policy if exists ' || quote_ident(p) || ' on public.leave_api_keys';
  end loop;
end $$;

-- Per-user: full access to own keys, nothing else.
create policy "Users manage own api keys"
  on public.leave_api_keys for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- One-time adoption: claim keys saved before the account existed.
create policy "Adopt orphan api keys"
  on public.leave_api_keys for update to authenticated
  using (user_id is null)
  with check (auth.uid() = user_id);
