-- ============================================================
-- Fried King — Complete Schema Migration  v2
-- Fixed: removed now() from partial index (not IMMUTABLE)
-- Run this FIRST on a fresh Supabase project
-- Then run friedking_pandeshwar_menu_seed_v4.sql
-- ============================================================

-- ============================================================
-- EXTENSIONS
-- ============================================================

create extension if not exists "pgcrypto";
create extension if not exists "moddatetime";

-- ============================================================
-- 1. BRANCHES
-- ============================================================

create table branches (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text unique not null,
  address         text,
  phone           text,
  whatsapp_number text,
  city            text default 'Mangaluru',
  is_active       boolean default true,
  opens_at        time default '12:00',
  closes_at       time default '22:00',
  created_at      timestamptz default now()
);

-- ============================================================
-- 2. MENU CATEGORIES
-- ============================================================

create table menu_categories (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branches(id) on delete cascade,
  name        text not null,
  sort_order  int default 0,
  is_active   boolean default true,
  created_at  timestamptz default now()
);

create index idx_menu_categories_branch on menu_categories(branch_id);

-- ============================================================
-- 3. MENU ITEMS
-- ============================================================

create table menu_items (
  id            uuid primary key default gen_random_uuid(),
  branch_id     uuid not null references branches(id) on delete cascade,
  category_id   uuid not null references menu_categories(id) on delete cascade,
  name          text not null,
  description   text,
  price_paise   int not null check (price_paise >= 0),
  is_veg        boolean not null default false,
  is_active     boolean default true,
  sort_order    int default 0,
  image_url     text,
  created_at    timestamptz default now()
);

create index idx_menu_items_branch   on menu_items(branch_id);
create index idx_menu_items_category on menu_items(category_id);
create index idx_menu_items_active   on menu_items(branch_id, is_active);

-- ============================================================
-- 4. MENU ITEM VARIANTS
-- ============================================================

create table menu_item_variants (
  id          uuid primary key default gen_random_uuid(),
  item_id     uuid not null references menu_items(id) on delete cascade,
  name        text not null,
  price_paise int not null check (price_paise >= 0),
  is_active   boolean default true
);

create index idx_variants_item on menu_item_variants(item_id);

-- ============================================================
-- 5. CUSTOMERS
-- ============================================================

create table customers (
  id          uuid primary key default gen_random_uuid(),
  branch_id   uuid not null references branches(id) on delete cascade,
  phone       text not null,
  name        text,
  created_at  timestamptz default now(),
  updated_at  timestamptz default now(),
  unique(branch_id, phone)
);

create index idx_customers_branch_phone on customers(branch_id, phone);

create trigger customers_updated_at
  before update on customers
  for each row execute procedure moddatetime(updated_at);

-- ============================================================
-- 6. ORDERS
-- ============================================================

create type order_status as enum (
  'pending',
  'confirmed',
  'preparing',
  'ready',
  'delivered',
  'cancelled'
);

create table orders (
  id                   uuid primary key default gen_random_uuid(),
  branch_id            uuid not null references branches(id),
  customer_id          uuid not null references customers(id),
  status               order_status not null default 'pending',
  subtotal_paise       int not null default 0,
  gst_paise            int not null default 0,
  total_paise          int not null default 0,
  special_instructions text,
  idempotency_key      text unique,
  created_at           timestamptz default now(),
  updated_at           timestamptz default now()
);

create index idx_orders_branch   on orders(branch_id);
create index idx_orders_customer on orders(customer_id);
create index idx_orders_status   on orders(branch_id, status);
create index idx_orders_created  on orders(branch_id, created_at desc);

create trigger orders_updated_at
  before update on orders
  for each row execute procedure moddatetime(updated_at);

-- ============================================================
-- 7. ORDER ITEMS
-- ============================================================

create table order_items (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references orders(id) on delete cascade,
  menu_item_id     uuid references menu_items(id) on delete set null,
  variant_id       uuid references menu_item_variants(id) on delete set null,
  name_snapshot    text not null,
  unit_price_paise int not null,
  quantity         int not null check (quantity > 0),
  line_total_paise int not null
);

create index idx_order_items_order on order_items(order_id);

-- ============================================================
-- 8. ORDER EVENTS  (outbox for n8n)
-- ============================================================

create type outbox_status as enum ('pending', 'claimed', 'done', 'failed');

create table order_events (
  id            uuid primary key default gen_random_uuid(),
  order_id      uuid not null references orders(id) on delete cascade,
  branch_id     uuid not null references branches(id),
  event_type    text not null,
  payload       jsonb not null default '{}',
  status        outbox_status not null default 'pending',
  claimed_by    text,
  claimed_at    timestamptz,
  processed_at  timestamptz,
  error_message text,
  retry_count   int default 0,
  created_at    timestamptz default now()
);

create index idx_order_events_pending on order_events(status, created_at) where status = 'pending';
create index idx_order_events_order   on order_events(order_id);

-- ============================================================
-- 9. OTP VERIFICATIONS
-- ============================================================

create table otp_verifications (
  id           uuid primary key default gen_random_uuid(),
  branch_id    uuid not null references branches(id),
  phone        text not null,
  otp_hash     text not null,
  expires_at   timestamptz not null,
  attempts     int not null default 0,
  locked_until timestamptz,
  consumed_at  timestamptz,
  created_at   timestamptz default now()
);

-- ✅ Fixed: removed now() from index predicate (not IMMUTABLE in PostgreSQL)
-- Expiry is enforced inside consume_otp function instead
create unique index idx_otp_one_active
  on otp_verifications(branch_id, phone)
  where consumed_at is null;

create index idx_otp_phone_branch on otp_verifications(branch_id, phone);

-- ============================================================
-- 10. ROW LEVEL SECURITY
-- ============================================================

alter table branches           enable row level security;
alter table menu_categories    enable row level security;
alter table menu_items         enable row level security;
alter table menu_item_variants enable row level security;
alter table customers          enable row level security;
alter table orders             enable row level security;
alter table order_items        enable row level security;
alter table order_events       enable row level security;
alter table otp_verifications  enable row level security;

-- Public read for active menu items (WhatsApp bot browsing)
create policy "branches_public_read"
  on branches for select using (is_active = true);

create policy "menu_categories_public_read"
  on menu_categories for select using (is_active = true);

create policy "menu_items_public_read"
  on menu_items for select using (is_active = true);

-- ============================================================
-- 11. RPC: request_otp
-- ============================================================

create or replace function request_otp(
  p_branch_id uuid,
  p_phone     text,
  p_otp       text
)
returns json
language plpgsql
security definer
as $$
begin
  -- Invalidate any existing active OTP for this phone+branch
  update otp_verifications
  set consumed_at = now()
  where branch_id  = p_branch_id
    and phone      = p_phone
    and consumed_at is null;

  -- Insert new OTP (hashed with bcrypt)
  insert into otp_verifications (branch_id, phone, otp_hash, expires_at)
  values (
    p_branch_id,
    p_phone,
    crypt(p_otp, gen_salt('bf')),
    now() + interval '5 minutes'
  );

  return json_build_object('success', true);
end;
$$;

-- ============================================================
-- 12. RPC: consume_otp
-- ============================================================

create or replace function consume_otp(
  p_branch_id uuid,
  p_phone     text,
  p_otp       text
)
returns json
language plpgsql
security definer
as $$
declare
  v_record otp_verifications%rowtype;
begin
  select * into v_record
  from otp_verifications
  where branch_id    = p_branch_id
    and phone        = p_phone
    and consumed_at  is null
    and expires_at   > now()
  order by created_at desc
  limit 1
  for update;

  if not found then
    return json_build_object('success', false, 'error', 'no_active_otp');
  end if;

  if v_record.locked_until is not null and v_record.locked_until > now() then
    return json_build_object('success', false, 'error', 'locked',
      'locked_until', v_record.locked_until);
  end if;

  if v_record.otp_hash != crypt(p_otp, v_record.otp_hash) then
    update otp_verifications
    set
      attempts     = attempts + 1,
      locked_until = case when attempts + 1 >= 3
                     then now() + interval '15 minutes'
                     else null end
    where id = v_record.id;

    return json_build_object('success', false, 'error', 'invalid_otp',
      'attempts_remaining', greatest(0, 3 - (v_record.attempts + 1)));
  end if;

  update otp_verifications
  set consumed_at = now()
  where id = v_record.id;

  return json_build_object('success', true, 'phone', p_phone);
end;
$$;

-- ============================================================
-- VERIFY — should show 9 tables
-- ============================================================

select table_name
from information_schema.tables
where table_schema = 'public'
  and table_type = 'BASE TABLE'
order by table_name;

-- Expected:
-- branches, customers, menu_categories, menu_item_variants,
-- menu_items, order_events, order_items, orders, otp_verifications
