-- Supply list for the Family Lake House app.
-- Run this once in Supabase → SQL Editor → New query → paste → Run.
-- It creates the `supplies` table that the "Supplies" tab reads and writes.

create table if not exists public.supplies (
  id          uuid primary key default gen_random_uuid(),
  item        text not null,
  note        text default '',
  done        boolean default false,
  flagged_by  text default '',
  done_by     text default '',
  created_at  timestamptz default now(),
  updated_at  timestamptz default now()
);

-- Same access model as the rest of the app: the anon key is the gate, so the
-- anon role may read and write. Tighten later with Supabase Auth if you want
-- per-person logins.
alter table public.supplies enable row level security;

create policy "supplies anon read"   on public.supplies for select using (true);
create policy "supplies anon insert" on public.supplies for insert with check (true);
create policy "supplies anon update" on public.supplies for update using (true) with check (true);
create policy "supplies anon delete" on public.supplies for delete using (true);

-- Let the app's realtime subscription receive live changes across devices.
alter publication supabase_realtime add table public.supplies;
