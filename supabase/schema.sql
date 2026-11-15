-- KanjiPain account sync. Run this once in the Supabase SQL editor of a new project.
-- It is safe to run again.

-- Who may sync. Add people here from the dashboard (Table editor, or
--   insert into public.sync_allowlist (email) values ('friend@example.com');
-- ). Nobody can read or change this table from the app.
create table if not exists public.sync_allowlist (
  email text primary key
);
alter table public.sync_allowlist enable row level security;

create or replace function public.sync_allowed()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.sync_allowlist
    where lower(email) = lower(auth.jwt() ->> 'email')
  );
$$;
revoke all on function public.sync_allowed() from public;
-- `anon` may ask too (the answer is always "no"): the keep-alive workflow uses it as a
-- harmless request that reaches the database.
grant execute on function public.sync_allowed() to anon, authenticated;

-- One row per account: which history ("generation") is the current one. Restoring a backup
-- starts a new generation; records of older ones are ignored and removed.
create table if not exists public.sync_accounts (
  user_id uuid primary key references auth.users (id) on delete cascade,
  generation text not null check (length(generation) between 1 and 100),
  updated_at timestamptz not null default now()
);
alter table public.sync_accounts enable row level security;

drop policy if exists "own account" on public.sync_accounts;
create policy "own account" on public.sync_accounts
  for all to authenticated
  using (user_id = auth.uid() and public.sync_allowed())
  with check (user_id = auth.uid() and public.sync_allowed());

-- Every synced record: a review, a card, a finished session, a deck with its characters...
-- The app validates `data`; the server only stores it and numbers the changes.
create sequence if not exists public.sync_seq;

create table if not exists public.sync_records (
  user_id uuid not null references auth.users (id) on delete cascade,
  generation text not null check (length(generation) between 1 and 100),
  collection text not null
    check (collection in ('sessions', 'events', 'issues', 'cards', 'decks', 'settings')),
  id text not null check (length(id) between 1 and 200),
  data jsonb not null check (pg_column_size(data) <= 4000000),
  deleted boolean not null default false,
  device_id text not null check (length(device_id) between 1 and 100),
  seq bigint not null,
  updated_at timestamptz not null default now(),
  primary key (user_id, generation, collection, id)
);
create index if not exists sync_records_changes
  on public.sync_records (user_id, generation, seq);
alter table public.sync_records enable row level security;

drop policy if exists "own records" on public.sync_records;
create policy "own records" on public.sync_records
  for all to authenticated
  using (user_id = auth.uid() and public.sync_allowed())
  with check (user_id = auth.uid() and public.sync_allowed());

-- Number every change. One account's writers take turns, so a device that has read up to
-- some number can never be overtaken by an earlier number that commits later.
create or replace function public.sync_number_change()
returns trigger
language plpgsql
as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(new.user_id::text, 0));
  new.seq := nextval('public.sync_seq');
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists sync_number_change on public.sync_records;
create trigger sync_number_change
  before insert or update on public.sync_records
  for each row execute function public.sync_number_change();

grant select, insert, update, delete on public.sync_accounts to authenticated;
grant select, insert, update, delete on public.sync_records to authenticated;
grant usage on sequence public.sync_seq to authenticated;
