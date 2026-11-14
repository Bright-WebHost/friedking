-- ============================================================
-- Fried King dashboard: everything the Oceana-style dashboard needs.
-- Run in the Supabase SQL Editor AFTER:
--   friedking_dashboard_phase1.sql, friedking_dashboard_phase1_tables.sql,
--   friedking_dashboard_phase2.sql, friedking_menu_promotions.sql, friedking_menu_storage.sql
-- Safe to re-run. Only adds tables/columns; nothing is dropped except two
-- check constraints that are recreated wider (order_type, broadcast audience/status).
--
-- All dashboard reads/writes go through Next.js API routes with the service role,
-- so new tables get RLS switched on with no policies (closed to the public).
-- ============================================================

-- ---------- orders: workflow, cash, riders, dine-in, edits, discounts ----------
alter table public.orders
  add column if not exists source                 text not null default 'web',
  add column if not exists accepted_at            timestamptz,
  add column if not exists accepted_by            text,
  add column if not exists prep_minutes           int,
  add column if not exists ready_at               timestamptz,
  add column if not exists delivered_at           timestamptz,
  add column if not exists cancelled_at           timestamptz,
  add column if not exists cancelled_by           text,
  add column if not exists cancel_reason          text,
  add column if not exists taken_by               text,
  add column if not exists rider_id               uuid,
  add column if not exists rider_assigned_at      timestamptz,
  add column if not exists cash_collected         boolean not null default false,
  add column if not exists cash_amount_paise      int,
  add column if not exists cash_collected_at      timestamptz,
  add column if not exists payment_taken_by       text,
  add column if not exists printed_at             timestamptz,
  add column if not exists amendment_count        int not null default 0,
  add column if not exists amended_at             timestamptz,
  add column if not exists table_session_id       uuid references public.table_sessions(id) on delete set null,
  add column if not exists table_number           int,
  add column if not exists discount_paise         int not null default 0,
  add column if not exists discount_reason        text,
  add column if not exists loyalty_points_redeemed int not null default 0,
  add column if not exists loyalty_discount_paise int not null default 0,
  add column if not exists delivery_pincode       text;

do $$
begin
  -- Dine-in orders (tables / POS rounds).
  alter table public.orders drop constraint if exists orders_order_type_check;
  alter table public.orders add constraint orders_order_type_check
    check (order_type in ('pickup', 'delivery', 'dine-in'));
  if not exists (select 1 from pg_constraint where conname = 'orders_source_check') then
    alter table public.orders add constraint orders_source_check
      check (source in ('web', 'pos', 'whatsapp'));
  end if;
end $$;

create index if not exists orders_branch_created on public.orders(branch_id, created_at desc);
create index if not exists orders_session on public.orders(table_session_id);

alter table public.order_items add column if not exists notes text;

-- ---------- audit log ----------
create table if not exists public.order_audit (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references public.branches(id) on delete cascade,
  order_id     uuid references public.orders(id) on delete set null,
  order_number bigint,
  action       text not null,
  from_value   text,
  to_value     text,
  detail       text,
  staff        text,
  created_at   timestamptz not null default now()
);
create index if not exists order_audit_branch_created on public.order_audit(branch_id, created_at desc);

-- ---------- staff: name/email/on-duty for the Settings page ----------
alter table public.staff
  add column if not exists name      text,
  add column if not exists email     text,
  add column if not exists is_active boolean not null default true;

-- ---------- customers: contacts page ----------
alter table public.customers
  add column if not exists opted_out boolean not null default false,
  add column if not exists source    text not null default 'order';

-- ---------- riders + cash handover ledger ----------
create table if not exists public.riders (
  id         uuid primary key default gen_random_uuid(),
  branch_id  uuid not null references public.branches(id) on delete cascade,
  name       text not null,
  phone      text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now(),
  unique (branch_id, phone)
);
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'orders_rider_id_fkey') then
    alter table public.orders add constraint orders_rider_id_fkey
      foreign key (rider_id) references public.riders(id) on delete set null;
  end if;
end $$;

create table if not exists public.rider_payments (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references public.branches(id) on delete cascade,
  rider_id     uuid not null references public.riders(id) on delete cascade,
  amount_paise int not null check (amount_paise > 0),
  note         text,
  received_by  text,
  created_at   timestamptz not null default now()
);

-- ---------- tables: sections, guest details, close / move / merge ----------
alter table public.restaurant_tables
  add column if not exists section    text,
  add column if not exists sort_order int not null default 0;

alter table public.table_sessions
  add column if not exists customer_name      text,
  add column if not exists phone              text,
  add column if not exists opened_by_name     text,
  add column if not exists closed_by_name     text,
  add column if not exists closed_total_paise int,
  add column if not exists payment_method     text,
  add column if not exists moved_from         int,
  add column if not exists merged_into        uuid references public.table_sessions(id) on delete set null;

-- ---------- menu: featured, dish stock, category images ----------
alter table public.menu_items
  add column if not exists featured            boolean not null default false,
  add column if not exists track_stock         boolean not null default false,
  add column if not exists stock_qty           int not null default 0,
  add column if not exists low_stock_threshold int,
  add column if not exists par_level           int,
  add column if not exists stock_updated_at    timestamptz,
  add column if not exists stock_updated_by    text;

alter table public.menu_categories add column if not exists image_url text;

-- ---------- ingredients (reuses phase 2 stock_items) ----------
-- quantity = stock, reorder_level = low-stock alert, cost_paise = cost per unit.
alter table public.stock_items
  add column if not exists category         text,
  add column if not exists par_level        numeric(12, 3),
  add column if not exists track_stock      boolean not null default true,
  add column if not exists nearest_expiry   date,
  add column if not exists stock_updated_by text;
-- "not set" must be distinguishable from 0 (no cost recorded yet, no alert level).
alter table public.stock_items alter column reorder_level drop not null;
alter table public.stock_items alter column reorder_level drop default;
alter table public.stock_items alter column cost_paise drop not null;
alter table public.stock_items alter column cost_paise drop default;

create table if not exists public.recipe_lines (
  id            uuid primary key default gen_random_uuid(),
  menu_item_id  uuid not null references public.menu_items(id) on delete cascade,
  stock_item_id uuid not null references public.stock_items(id) on delete restrict,
  qty_per_item  numeric(12, 3) not null check (qty_per_item > 0),
  unique (menu_item_id, stock_item_id)
);

create table if not exists public.stock_movements (
  id                  uuid primary key default gen_random_uuid(),
  branch_id           uuid not null references public.branches(id) on delete cascade,
  entity_type         text not null check (entity_type in ('menu_item', 'ingredient')),
  entity_id           uuid not null,
  entity_name         text not null,
  reason              text not null check (reason in ('sale', 'restock', 'manual_adjust', 'cancel_restore', 'waste', 'top_up_par', 'stock_take')),
  qty_change          numeric(12, 3) not null,
  balance_after       numeric(12, 3) not null,
  unit                text,
  supplier_name       text,
  cost_per_unit_paise int,
  total_cost_paise    int,
  expiry_date         date,
  note                text,
  order_id            uuid references public.orders(id) on delete set null,
  staff               text,
  created_at          timestamptz not null default now()
);
create index if not exists stock_movements_entity on public.stock_movements(entity_type, entity_id, created_at desc);
create index if not exists stock_movements_branch_created on public.stock_movements(branch_id, created_at desc);

-- ---------- P&L expenses ----------
create table if not exists public.expenses (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references public.branches(id) on delete cascade,
  expense_date date not null,
  category     text not null,
  amount_paise int not null check (amount_paise > 0),
  note         text,
  recorded_by  text,
  created_at   timestamptz not null default now()
);
create index if not exists expenses_branch_date on public.expenses(branch_id, expense_date desc);

-- ---------- per-branch settings (key/value, like Oceana's settings table) ----------
create table if not exists public.branch_settings (
  branch_id  uuid not null references public.branches(id) on delete cascade,
  key        text not null,
  value      text,
  updated_at timestamptz not null default now(),
  primary key (branch_id, key)
);

create table if not exists public.delivery_pincodes (
  branch_id uuid not null references public.branches(id) on delete cascade,
  pincode   text not null check (pincode ~ '^[0-9]{6}$'),
  area      text,
  is_active boolean not null default true,
  primary key (branch_id, pincode)
);

-- ---------- Live Chat (filled by n8n once YCloud is connected) ----------
create table if not exists public.chat_sessions (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references public.branches(id) on delete cascade,
  phone           text not null,
  customer_name   text,
  last_message    text,
  last_message_at timestamptz,
  unread_count    int not null default 0,
  ai_enabled      boolean not null default true,
  ai_disabled_by  text,
  created_at      timestamptz not null default now(),
  unique (branch_id, phone)
);

create table if not exists public.chat_messages (
  id              uuid primary key default gen_random_uuid(),
  branch_id       uuid not null references public.branches(id) on delete cascade,
  phone           text not null,
  direction       text not null check (direction in ('inbound', 'outbound')),
  content         text not null,
  sender          text,
  -- outbound rows start 'pending'; n8n sends them and marks done/failed
  delivery_status outbox_status,
  created_at      timestamptz not null default now()
);
create index if not exists chat_messages_thread on public.chat_messages(branch_id, phone, created_at);

-- ---------- outbound WhatsApp queue for non-order messages (blasts) ----------
create table if not exists public.outbound_messages (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references public.branches(id) on delete cascade,
  kind          text not null default 'blast',
  campaign_id   uuid references public.broadcast_campaigns(id) on delete set null,
  to_phone      text not null,
  template_name text,
  language      text not null default 'en',
  header_image  text,
  payload       jsonb not null default '{}',
  status        outbox_status not null default 'pending',
  error_message text,
  processed_at  timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists outbound_messages_status on public.outbound_messages(status, created_at);
create index if not exists outbound_messages_branch_month on public.outbound_messages(branch_id, kind, created_at);

alter table public.broadcast_campaigns
  add column if not exists template_name   text,
  add column if not exists header_image    text,
  add column if not exists recipient_count int not null default 0,
  add column if not exists created_by_name text;
alter table public.broadcast_campaigns drop constraint if exists broadcast_campaigns_audience_check;
alter table public.broadcast_campaigns add constraint broadcast_campaigns_audience_check
  check (audience in ('all', 'active_30', 'repeat', 'selection', 'repeat_customers', 'inactive_customers'));
alter table public.broadcast_campaigns drop constraint if exists broadcast_campaigns_status_check;
alter table public.broadcast_campaigns add constraint broadcast_campaigns_status_check
  check (status in ('draft', 'scheduled', 'queued', 'sent', 'cancelled'));

-- ---------- loyalty program ----------
create table if not exists public.loyalty_programs (
  id                         uuid primary key default gen_random_uuid(),
  branch_id                  uuid not null references public.branches(id) on delete cascade,
  name                       text not null default 'Fried King Rewards',
  currency_name              text not null default 'points',
  type                       text not null default 'points' check (type in ('points', 'visit', 'cashback')),
  earn_rate_per_rupee        numeric(10, 4) not null default 0.1,
  earn_rate_per_visit        int not null default 1,
  redemption_paise_per_point int not null default 50,
  min_spend_to_earn_paise    int not null default 0,
  max_redeem_pct_per_order   int not null default 20,
  max_redeem_paise_per_day   int,
  points_expiry_days         int,
  tiers                      jsonb not null default '[]',
  is_active                  boolean not null default true,
  created_at                 timestamptz not null default now(),
  updated_at                 timestamptz not null default now()
);
create unique index if not exists loyalty_programs_one_active on public.loyalty_programs(branch_id) where is_active;

insert into public.loyalty_programs (branch_id)
select b.id from public.branches b
where not exists (select 1 from public.loyalty_programs p where p.branch_id = b.id);

alter table public.loyalty_accounts add column if not exists tier text;
alter table public.loyalty_transactions
  add column if not exists type          text not null default 'earn',
  add column if not exists balance_after int,
  add column if not exists staff_name    text;
create unique index if not exists loyalty_one_earn_per_order
  on public.loyalty_transactions(order_id) where type = 'earn' and order_id is not null;

-- ---------- RLS: closed to the public (service role bypasses) ----------
alter table public.order_audit        enable row level security;
alter table public.riders             enable row level security;
alter table public.rider_payments     enable row level security;
alter table public.recipe_lines       enable row level security;
alter table public.stock_movements    enable row level security;
alter table public.expenses           enable row level security;
alter table public.branch_settings    enable row level security;
alter table public.delivery_pincodes  enable row level security;
alter table public.chat_sessions      enable row level security;
alter table public.chat_messages      enable row level security;
alter table public.outbound_messages  enable row level security;
alter table public.loyalty_programs   enable row level security;

-- ============================================================
-- Functions (service role only)
-- ============================================================

-- One stock change: updates the dish or ingredient and writes the ledger row, atomically.
-- p_set_to sets an absolute value (stock take / top up); otherwise p_delta is added.
create or replace function public.fk_stock_move(
  p_branch_id   uuid,
  p_entity_type text,
  p_entity_id   uuid,
  p_delta       numeric,
  p_reason      text,
  p_staff       text,
  p_set_to      numeric default null,
  p_extra       jsonb default '{}'
) returns numeric
language plpgsql
security definer
set search_path = public
as $$
declare
  v_old numeric; v_new numeric; v_name text; v_unit text;
begin
  if p_entity_type = 'menu_item' then
    select stock_qty, name into v_old, v_name from menu_items
      where id = p_entity_id and branch_id = p_branch_id for update;
    if not found then raise exception 'menu item not found'; end if;
    v_new := greatest(0, coalesce(p_set_to, v_old + p_delta));
    update menu_items set stock_qty = round(v_new)::int, stock_updated_at = now(), stock_updated_by = p_staff
      where id = p_entity_id;
    v_new := round(v_new); v_unit := 'pcs';
  elsif p_entity_type = 'ingredient' then
    select quantity, name, unit into v_old, v_name, v_unit from stock_items
      where id = p_entity_id and branch_id = p_branch_id for update;
    if not found then raise exception 'ingredient not found'; end if;
    v_new := greatest(0, coalesce(p_set_to, v_old + p_delta));
    update stock_items set quantity = v_new, updated_at = now(), stock_updated_by = p_staff
      where id = p_entity_id;
  else
    raise exception 'bad entity type';
  end if;

  insert into stock_movements (branch_id, entity_type, entity_id, entity_name, reason, qty_change, balance_after, unit,
    supplier_name, cost_per_unit_paise, total_cost_paise, expiry_date, note, order_id, staff)
  values (p_branch_id, p_entity_type, p_entity_id, v_name, p_reason, v_new - v_old, v_new, v_unit,
    nullif(p_extra->>'supplier_name', ''), (p_extra->>'cost_per_unit_paise')::int, (p_extra->>'total_cost_paise')::int,
    (p_extra->>'expiry_date')::date, nullif(p_extra->>'note', ''), (p_extra->>'order_id')::uuid, p_staff);
  return v_new;
end $$;

-- Deduct (p_sign = -1, reason 'sale') or restore (p_sign = 1, reason 'cancel_restore')
-- stock for every line of an order: tracked dishes by count, recipe dishes by ingredient.
create or replace function public.fk_order_stock(p_order_id uuid, p_sign int, p_staff text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_branch uuid; r record; reason text := case when p_sign < 0 then 'sale' else 'cancel_restore' end;
  extra jsonb := jsonb_build_object('order_id', p_order_id);
begin
  select branch_id into v_branch from orders where id = p_order_id;
  for r in
    select oi.menu_item_id, sum(oi.quantity) as qty, mi.track_stock
    from order_items oi join menu_items mi on mi.id = oi.menu_item_id
    where oi.order_id = p_order_id group by oi.menu_item_id, mi.track_stock
  loop
    if r.track_stock then
      perform fk_stock_move(v_branch, 'menu_item', r.menu_item_id, p_sign * r.qty, reason, p_staff, null, extra);
    end if;
    perform fk_stock_move(v_branch, 'ingredient', rl.stock_item_id, p_sign * r.qty * rl.qty_per_item, reason, p_staff, null, extra)
      from recipe_lines rl join stock_items si on si.id = rl.stock_item_id
      where rl.menu_item_id = r.menu_item_id and si.track_stock;
  end loop;
end $$;

-- Award points for a delivered order under the branch's active program. Idempotent per order.
create or replace function public.fk_loyalty_earn(p_order_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  o record; p record; v_points int; v_acct uuid; v_balance int; v_lifetime int; v_tier text;
begin
  select id, branch_id, customer_id, total_paise into o from orders where id = p_order_id;
  if not found then return 0; end if;
  select * into p from loyalty_programs where branch_id = o.branch_id and is_active limit 1;
  if not found or o.total_paise < p.min_spend_to_earn_paise then return 0; end if;
  if exists (select 1 from loyalty_transactions where order_id = p_order_id and type = 'earn') then return 0; end if;

  v_points := case when p.type = 'visit' then p.earn_rate_per_visit
                   else floor(o.total_paise / 100.0 * p.earn_rate_per_rupee)::int end;
  if v_points <= 0 then return 0; end if;

  insert into loyalty_accounts (customer_id) values (o.customer_id)
    on conflict (customer_id) do nothing;
  update loyalty_accounts set points_balance = points_balance + v_points,
      lifetime_points = lifetime_points + v_points, updated_at = now()
    where customer_id = o.customer_id
    returning id, points_balance, lifetime_points into v_acct, v_balance, v_lifetime;

  select t->>'name' into v_tier from jsonb_array_elements(p.tiers) t
    where coalesce((t->>'min_lifetime_points')::int, 0) <= v_lifetime
    order by (t->>'min_lifetime_points')::int desc limit 1;
  update loyalty_accounts set tier = v_tier where id = v_acct;

  insert into loyalty_transactions (account_id, points, reason, order_id, type, balance_after)
    values (v_acct, v_points, 'Order #' || (select order_number from orders where id = p_order_id), p_order_id, 'earn', v_balance);
  return v_points;
end $$;

-- Redeem points (counter or POS). Returns json {ok, reason?, redeemed, value_paise, balance}.
create or replace function public.fk_loyalty_redeem(
  p_customer_id uuid, p_points int, p_order_id uuid, p_note text, p_staff text
) returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  a record; p record; v_value int; v_today int; v_branch uuid;
begin
  if p_points is null or p_points <= 0 then return json_build_object('ok', false, 'reason', 'invalid_points'); end if;
  select branch_id into v_branch from customers where id = p_customer_id;
  select * into p from loyalty_programs where branch_id = v_branch and is_active limit 1;
  if not found then return json_build_object('ok', false, 'reason', 'no_program'); end if;
  select * into a from loyalty_accounts where customer_id = p_customer_id for update;
  if not found or a.points_balance < p_points then return json_build_object('ok', false, 'reason', 'insufficient_points'); end if;

  v_value := p_points * p.redemption_paise_per_point;
  if p.max_redeem_paise_per_day is not null then
    select coalesce(sum(-t.points), 0) * p.redemption_paise_per_point into v_today
      from loyalty_transactions t
      where t.account_id = a.id and t.type = 'redeem' and t.created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
    if v_today + v_value > p.max_redeem_paise_per_day then
      return json_build_object('ok', false, 'reason', 'daily_limit');
    end if;
  end if;

  update loyalty_accounts set points_balance = points_balance - p_points, updated_at = now() where id = a.id;
  insert into loyalty_transactions (account_id, points, reason, order_id, type, balance_after, staff_name)
    values (a.id, -p_points, coalesce(nullif(p_note, ''), 'Redeemed'), p_order_id, 'redeem', a.points_balance - p_points, p_staff);
  return json_build_object('ok', true, 'redeemed', p_points, 'value_paise', v_value, 'balance', a.points_balance - p_points);
end $$;

revoke all on function public.fk_stock_move(uuid, text, uuid, numeric, text, text, numeric, jsonb) from public, anon, authenticated;
revoke all on function public.fk_order_stock(uuid, int, text) from public, anon, authenticated;
revoke all on function public.fk_loyalty_earn(uuid) from public, anon, authenticated;
revoke all on function public.fk_loyalty_redeem(uuid, int, uuid, text, text) from public, anon, authenticated;

-- ============================================================
-- Check: every row below should say true
-- ============================================================
select 'orders.source' as item, exists(select 1 from information_schema.columns where table_name='orders' and column_name='source') as ok
union all select 'riders', to_regclass('public.riders') is not null
union all select 'stock_movements', to_regclass('public.stock_movements') is not null
union all select 'branch_settings', to_regclass('public.branch_settings') is not null
union all select 'chat_messages', to_regclass('public.chat_messages') is not null
union all select 'outbound_messages', to_regclass('public.outbound_messages') is not null
union all select 'loyalty_programs', to_regclass('public.loyalty_programs') is not null
union all select 'fk_order_stock()', to_regprocedure('public.fk_order_stock(uuid,int,text)') is not null;
