-- Fried King dashboard phase 1: branch tables and open table sessions.
-- Run after the main schema and dashboard staff migration.
-- Safe to re-run.

create table if not exists public.restaurant_tables (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  table_number int not null check (table_number > 0),
  seats int not null default 4 check (seats > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (branch_id, table_number)
);

create table if not exists public.table_sessions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  table_id uuid not null references public.restaurant_tables(id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_by uuid references auth.users(id),
  closed_by uuid references auth.users(id),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  check ((status = 'open' and closed_at is null) or (status = 'closed' and closed_at is not null))
);

create unique index if not exists restaurant_tables_active_number
  on public.restaurant_tables(branch_id, table_number)
  where is_active = true;

create unique index if not exists table_sessions_one_open_per_table
  on public.table_sessions(table_id)
  where status = 'open';

create index if not exists table_sessions_branch_status
  on public.table_sessions(branch_id, status, opened_at desc);

alter table public.restaurant_tables enable row level security;
alter table public.table_sessions enable row level security;

drop policy if exists "staff_read_branch_tables" on public.restaurant_tables;
create policy "staff_read_branch_tables"
  on public.restaurant_tables for select
  using (public.staff_can_access_branch(branch_id));

drop policy if exists "staff_manage_branch_tables" on public.restaurant_tables;
create policy "staff_manage_branch_tables"
  on public.restaurant_tables for all
  using (public.staff_can_access_branch(branch_id))
  with check (public.staff_can_access_branch(branch_id));

drop policy if exists "staff_read_branch_table_sessions" on public.table_sessions;
create policy "staff_read_branch_table_sessions"
  on public.table_sessions for select
  using (public.staff_can_access_branch(branch_id));

drop policy if exists "staff_manage_branch_table_sessions" on public.table_sessions;
create policy "staff_manage_branch_table_sessions"
  on public.table_sessions for all
  using (public.staff_can_access_branch(branch_id))
  with check (public.staff_can_access_branch(branch_id));

-- Seed the current Pandeshwar layout only if it has not been configured yet.
insert into public.restaurant_tables (branch_id, table_number, seats)
select 'a1b2c3d4-0001-0001-0001-000000000001'::uuid, numbers.table_number, numbers.seats
from (values
  (1, 4), (2, 4), (3, 4), (4, 4), (5, 6), (6, 6), (7, 5), (8, 2)
) as numbers(table_number, seats)
where not exists (
  select 1
  from public.restaurant_tables existing
  where existing.branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'::uuid
);
