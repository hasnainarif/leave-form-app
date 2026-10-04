-- Crown Leave Form App — per-user data migration
-- Project: My Apps (yazbfehioywlcqnbbakc)
-- Run once in the Supabase dashboard SQL editor.
--
-- What it does:
-- 1. Adds user_id to leave_signatures + leave_holidays (per-user ownership).
-- 2. Replaces any existing open/anon RLS policies with per-user policies:
--    logged-in users can only read/write their OWN rows.
-- 3. Adds a one-time "adopt orphan rows" policy so the first login can claim
--    the existing rows that were saved before accounts existed (user_id NULL).
--    The app runs: UPDATE ... SET user_id = auth.uid() WHERE user_id IS NULL
--    once right after the first login.
-- 4. Makes (user_id, month) unique on leave_holidays so each user has their
--    own holiday list per month.

-- ---------- 1. user_id columns ----------
alter table public.leave_signatures
  add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.leave_holidays
  add column if not exists user_id uuid references auth.users(id) on delete cascade;

create index if not exists leave_signatures_user_id_idx
  on public.leave_signatures(user_id);
create index if not exists leave_holidays_user_id_idx
  on public.leave_holidays(user_id);

-- ---------- 2. per-user month uniqueness for holidays ----------
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'leave_holidays_user_month_unique') then
    alter table public.leave_holidays
      add constraint leave_holidays_user_month_unique unique (user_id, month);
  end if;
end $$;

-- ---------- 3. replace RLS policies ----------
alter table public.leave_signatures enable row level security;
alter table public.leave_holidays enable row level security;

-- Drop whatever open/anon policies exist (names unknown, so drop dynamically).
do $$
declare p text;
begin
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'leave_signatures'
  loop
    execute 'drop policy if exists ' || quote_ident(p) || ' on public.leave_signatures';
  end loop;
  for p in select policyname from pg_policies where schemaname = 'public' and tablename = 'leave_holidays'
  loop
    execute 'drop policy if exists ' || quote_ident(p) || ' on public.leave_holidays';
  end loop;
end $$;

-- Per-user: full access to own rows, nothing else.
create policy "Users manage own signatures"
  on public.leave_signatures for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "Users manage own holidays"
  on public.leave_holidays for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- One-time adoption: a logged-in user can claim rows saved before accounts
-- existed (user_id IS NULL) by setting them to their own id.
create policy "Adopt orphan signatures"
  on public.leave_signatures for update to authenticated
  using (user_id is null)
  with check (auth.uid() = user_id);

create policy "Adopt orphan holidays"
  on public.leave_holidays for update to authenticated
  using (user_id is null)
  with check (auth.uid() = user_id);
