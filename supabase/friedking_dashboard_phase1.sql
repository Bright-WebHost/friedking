-- Fried King dashboard phase 1: staff access and dashboard RLS.
-- Run after the existing schema, seed, and orders migrations.
-- Create a Supabase Auth user first, then insert that user's UUID below.

create table if not exists public.staff (
  user_id uuid primary key references auth.users(id) on delete cascade,
  branch_id uuid references public.branches(id) on delete set null,
  role text not null default 'staff' check (role in ('owner', 'manager', 'staff')),
  created_at timestamptz not null default now()
);

alter table public.staff enable row level security;

create or replace function public.staff_can_access_branch(target_branch_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.staff
    where user_id = auth.uid()
      and (branch_id is null or branch_id = target_branch_id)
  );
$$;

revoke all on function public.staff_can_access_branch(uuid) from public;
grant execute on function public.staff_can_access_branch(uuid) to authenticated;

drop policy if exists staff_self_select on public.staff;
create policy staff_self_select on public.staff
  for select to authenticated
  using (user_id = auth.uid());

drop policy if exists staff_branches_select on public.branches;
create policy staff_branches_select on public.branches
  for select to authenticated
  using (public.staff_can_access_branch(id));

drop policy if exists staff_orders_select on public.orders;
create policy staff_orders_select on public.orders
  for select to authenticated
  using (public.staff_can_access_branch(branch_id));

drop policy if exists staff_orders_update on public.orders;
create policy staff_orders_update on public.orders
  for update to authenticated
  using (public.staff_can_access_branch(branch_id))
  with check (public.staff_can_access_branch(branch_id));

drop policy if exists staff_order_items_select on public.order_items;
create policy staff_order_items_select on public.order_items
  for select to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and public.staff_can_access_branch(o.branch_id)
    )
  );

drop policy if exists staff_customers_select on public.customers;
create policy staff_customers_select on public.customers
  for select to authenticated
  using (public.staff_can_access_branch(branch_id));

drop policy if exists staff_order_events_select on public.order_events;
create policy staff_order_events_select on public.order_events
  for select to authenticated
  using (public.staff_can_access_branch(branch_id));

drop policy if exists staff_menu_items_select on public.menu_items;
create policy staff_menu_items_select on public.menu_items
  for select to authenticated
  using (public.staff_can_access_branch(branch_id));

drop policy if exists staff_menu_items_update on public.menu_items;
create policy staff_menu_items_update on public.menu_items
  for update to authenticated
  using (public.staff_can_access_branch(branch_id))
  with check (public.staff_can_access_branch(branch_id));

-- Example after creating an Auth user:
-- insert into public.staff (user_id, branch_id, role)
-- values ('AUTH_USER_UUID', 'a1b2c3d4-0001-0001-0001-000000000001', 'manager');
--
-- Owner access across all branches uses branch_id = null:
-- insert into public.staff (user_id, branch_id, role)
-- values ('AUTH_USER_UUID', null, 'owner');
