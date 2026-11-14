-- Fried King dashboard phase 2: stock, loyalty, and broadcast drafts.
-- Run after friedking_dashboard_phase1.sql.
-- Safe to re-run.

create table if not exists public.stock_items (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  name text not null,
  unit text not null default 'unit',
  quantity numeric(12, 3) not null default 0 check (quantity >= 0),
  reorder_level numeric(12, 3) not null default 0 check (reorder_level >= 0),
  cost_paise bigint not null default 0 check (cost_paise >= 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists stock_items_branch_active
  on public.stock_items(branch_id, is_active, name);

create table if not exists public.loyalty_accounts (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null unique references public.customers(id) on delete cascade,
  points_balance integer not null default 0 check (points_balance >= 0),
  lifetime_points integer not null default 0 check (lifetime_points >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.loyalty_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.loyalty_accounts(id) on delete cascade,
  points integer not null check (points <> 0),
  reason text not null,
  order_id uuid references public.orders(id) on delete set null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists loyalty_transactions_account_created
  on public.loyalty_transactions(account_id, created_at desc);

create table if not exists public.broadcast_campaigns (
  id uuid primary key default gen_random_uuid(),
  branch_id uuid not null references public.branches(id) on delete cascade,
  title text not null,
  message text not null,
  audience text not null default 'all' check (audience in ('all', 'repeat_customers', 'inactive_customers')),
  status text not null default 'draft' check (status in ('draft', 'scheduled', 'sent', 'cancelled')),
  scheduled_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists broadcast_campaigns_branch_created
  on public.broadcast_campaigns(branch_id, created_at desc);

alter table public.stock_items enable row level security;
alter table public.loyalty_accounts enable row level security;
alter table public.loyalty_transactions enable row level security;
alter table public.broadcast_campaigns enable row level security;

drop policy if exists staff_manage_stock_items on public.stock_items;
create policy staff_manage_stock_items on public.stock_items
  for all to authenticated
  using (public.staff_can_access_branch(branch_id))
  with check (public.staff_can_access_branch(branch_id));

drop policy if exists staff_read_loyalty_accounts on public.loyalty_accounts;
create policy staff_read_loyalty_accounts on public.loyalty_accounts
  for select to authenticated
  using (exists (
    select 1 from public.customers c
    where c.id = loyalty_accounts.customer_id
      and public.staff_can_access_branch(c.branch_id)
  ));

drop policy if exists staff_manage_loyalty_accounts on public.loyalty_accounts;
create policy staff_manage_loyalty_accounts on public.loyalty_accounts
  for all to authenticated
  using (exists (
    select 1 from public.customers c
    where c.id = loyalty_accounts.customer_id
      and public.staff_can_access_branch(c.branch_id)
  ))
  with check (exists (
    select 1 from public.customers c
    where c.id = loyalty_accounts.customer_id
      and public.staff_can_access_branch(c.branch_id)
  ));

drop policy if exists staff_manage_loyalty_transactions on public.loyalty_transactions;
create policy staff_manage_loyalty_transactions on public.loyalty_transactions
  for all to authenticated
  using (exists (
    select 1 from public.loyalty_accounts a
    join public.customers c on c.id = a.customer_id
    where a.id = loyalty_transactions.account_id
      and public.staff_can_access_branch(c.branch_id)
  ))
  with check (exists (
    select 1 from public.loyalty_accounts a
    join public.customers c on c.id = a.customer_id
    where a.id = loyalty_transactions.account_id
      and public.staff_can_access_branch(c.branch_id)
  ));

drop policy if exists staff_manage_broadcast_campaigns on public.broadcast_campaigns;
create policy staff_manage_broadcast_campaigns on public.broadcast_campaigns
  for all to authenticated
  using (public.staff_can_access_branch(branch_id))
  with check (public.staff_can_access_branch(branch_id));
