import { PGlite } from '@electric-sql/pglite'
import fs from 'fs'
const R = '../../supabase/'
export async function loadReal() {
  const db = new PGlite()
  await db.exec(`create role service_role; create role anon; create role authenticated;
    create schema if not exists auth; create table auth.users(id uuid primary key default gen_random_uuid(), email text);
    create function auth.uid() returns uuid language sql as $$ select null::uuid $$;
    create function auth.role() returns text language sql as $$ select 'service_role'::text $$;
    create schema if not exists storage; create table storage.buckets(id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(), bucket_id text, name text);`)

  await db.exec(`
  create type public.order_status as enum ('pending','confirmed','preparing','ready','delivered','cancelled');
  create type public.outbox_status as enum ('pending','claimed','done','failed');
  create table public.branches(id uuid primary key default gen_random_uuid(), name text not null, slug text unique not null, address text, phone text, is_active boolean default true, opens_at time, closes_at time, created_at timestamptz default now());
  create table public.menu_categories(id uuid primary key default gen_random_uuid(), branch_id uuid references public.branches(id), name text not null, sort_order int default 0, is_active boolean default true);
  create table public.menu_items(id uuid primary key default gen_random_uuid(), branch_id uuid references public.branches(id), category_id uuid references public.menu_categories(id), name text not null, description text, price_paise int not null, is_veg boolean default false, is_active boolean default true, sort_order int default 0, image_url text);
  create table public.menu_item_variants(id uuid primary key default gen_random_uuid(), menu_item_id uuid references public.menu_items(id), name text, price_paise int);
  create table public.customers(id uuid primary key default gen_random_uuid(), branch_id uuid references public.branches(id), phone text not null, name text, created_at timestamptz default now(), unique(branch_id, phone));
  create table public.orders(id uuid primary key default gen_random_uuid(), branch_id uuid references public.branches(id), customer_id uuid references public.customers(id), status public.order_status not null default 'pending',
    subtotal_paise int not null default 0, gst_paise int not null default 0, total_paise int not null default 0, special_instructions text, idempotency_key text unique, created_at timestamptz default now(), updated_at timestamptz default now());
  create table public.order_items(id uuid primary key default gen_random_uuid(), order_id uuid references public.orders(id) on delete cascade, menu_item_id uuid, name_snapshot text, unit_price_paise int, quantity int, line_total_paise int);
  create table public.order_events(id uuid primary key default gen_random_uuid(), order_id uuid, branch_id uuid, event_type text, payload jsonb, status public.outbox_status default 'pending', error_message text, claimed_by text, claimed_at timestamptz, retry_count int default 0, created_at timestamptz default now());
  create table public.otp_verifications(id uuid primary key default gen_random_uuid());
  `)
  await db.exec(`insert into public.branches(id,name,slug,address,phone,opens_at,closes_at) values ('a1b2c3d4-0001-0001-0001-000000000001','Fried King Pandeshwar','pandeshwar','Pandeshwar, Mangaluru','9742175222','00:00','23:59')`)
  const files = ['friedking_schema_migration_v3_orders.sql', 'friedking_dashboard_phase1.sql', 'friedking_dashboard_phase1_tables.sql',
    'friedking_dashboard_phase2.sql', 'friedking_dashboard_oceana.sql', 'friedking_menu_promotions.sql', 'friedking_whatsapp_bot.sql', 'friedking_whatsapp_loyalty.sql', 'friedking_whatsapp_checkout.sql',
    'friedking_whatsapp_amend_confirm.sql', 'friedking_whatsapp_delivery_mode.sql', 'friedking_whatsapp_table_draft.sql']
  const report = []
  for (const f of files) {
    try { await db.exec(fs.readFileSync(R + f, 'utf8')); report.push('ok   ' + f) } catch (e) { report.push('FAIL ' + f + ' :: ' + String(e.message).slice(0, 160)) }
  }
  return { db, report }
}
if (process.argv[1].endsWith('realschema.mjs')) { const { report } = await loadReal(); console.log(report.join('\n')) }
