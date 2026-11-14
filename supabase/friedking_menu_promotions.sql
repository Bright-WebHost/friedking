-- Customer offer banners managed from Dashboard > Settings.
-- Run after the main schema and dashboard staff migration.

create table if not exists public.menu_promotions (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  title text not null,
  description text,
  image_url text,
  is_active boolean not null default true,
  starts_at date,
  ends_at date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at is null or starts_at is null or ends_at >= starts_at)
);

create index if not exists menu_promotions_branch_active
  on public.menu_promotions(branch_id, is_active, created_at desc);

alter table public.menu_promotions enable row level security;

drop policy if exists staff_read_menu_promotions on public.menu_promotions;
create policy staff_read_menu_promotions on public.menu_promotions
  for select to authenticated
  using (public.staff_can_access_branch(branch_id));

drop policy if exists staff_manage_menu_promotions on public.menu_promotions;
create policy staff_manage_menu_promotions on public.menu_promotions
  for all to authenticated
  using (public.staff_can_access_branch(branch_id))
  with check (public.staff_can_access_branch(branch_id));
