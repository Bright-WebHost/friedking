# Fried King: WhatsApp-first ordering system

Online ordering for Fried King, a fried chicken brand in Mangaluru with 3 branches (Pandeshwar, Falnir, Kadri). Built by Maithri at Bright Media Tech. It follows the same architecture as the sibling projects Rasoi (`C:\brightmedia\rasoi`) and Pabbas, so look there for patterns before inventing new ones.

```
WhatsApp customer -> YCloud -> n8n -> this Next.js app -> Supabase (Postgres)
```

- YCloud (WhatsApp provider) setup is **paused**, waiting on the client. Do not build around it yet.
- n8n is not built yet. It will read the `order_events` outbox table and send WhatsApp messages.
- This repo is the Next.js app only. The customer web ordering flow exists; the staff dashboard does not.

## Read this first: Next.js 16

This is Next.js 16 (`^16.4.6`), which differs from older versions. Before using any Next.js API, read the matching guide in `node_modules/next/dist/docs/`. Known changes: `middleware` is now `proxy`, `next lint` is removed, Turbopack is the default, and `cookies()` is async. Do not downgrade Next.js: 16.3.4 has critical security advisories.

## Stack

Next.js 16 (App Router), React 19, TypeScript strict, Tailwind CSS v4 (theme in `app/globals.css`, no tailwind.config), Supabase (`@supabase/supabase-js`, `@supabase/ssr`), Framer Motion, Lucide icons. Path alias `@/*` maps to the repo root.

## Commands

```
npm install
npm run dev # http://localhost:3000/?branch=pandeshwar
npm run build
npm run typecheck
```

Env vars (`.env.local`, never commit): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`. The service role key is server-only: use it only in `app/api/**` through `lib/supabase/admin.ts`, never in a client component.

## Layout

```
app/page.tsx              Customer page (client component): branch picker -> menu -> cart -> checkout -> confirmed
app/api/branches/route.ts GET active branches
app/api/menu/route.ts     GET ?branch=<slug> -> { branch, categories, items }
app/api/order/route.ts    POST place an order
lib/types.ts              Shared types
lib/utils.ts              formatPrice, calcTotals (5% GST), normalizePhone, formatTime
lib/supabase/             admin.ts (service role), client.ts (browser), server.ts (SSR)
supabase/ SQL files, run in order in the Supabase SQL Editor: schema v2, Pandeshwar seed v4, orders migration v3
docs/DASHBOARD_PLAN.md    Plan for the staff dashboard (NOT built yet)
```

## Database (Supabase / Postgres)

The schema and seed are in `supabase/` (`friedking_schema_migration_v2.sql`, `friedking_falnir_menu_seed_v4.sql`, then `friedking_schema_migration_v3_orders.sql`); read them before touching any query. Tables: `branches`, `menu_categories`, `menu_items`, `menu_item_variants`, `customers`, `orders`, `order_items`, `order_events`, `otp_verifications`. RLS is on for every table; only active branches, categories and items are publicly readable. Everything else is accessed through the service role in API routes.

Column names that are easy to get wrong:

- `menu_items`: `name`, `price_paise`, `is_veg`, `is_active`, `sort_order`, `image_url`, `category_id`, `branch_id`
- `menu_categories`: `name`, `sort_order`, `is_active`
- `branches`: `name`, `slug`, `is_active`, `opens_at`, `closes_at`
- `orders`: `subtotal_paise`, `gst_paise`, `total_paise`, `status` (enum: pending, confirmed, preparing, ready, delivered, cancelled), `order_number` (starts at 1001), `order_type` (pickup or delivery), `payment_method` (cash or upi), `delivery_address`, `idempotency_key` (unique)
- `order_items`: `menu_item_id`, `name_snapshot`, `unit_price_paise`, `quantity`, `line_total_paise`
- `order_events`: outbox for n8n. `status` enum pending/claimed/done/failed, `event_type`, `payload` jsonb
- `customers` is unique on `(branch_id, phone)`

Seeded: Pandeshwar only (using branch id `a1b2c3d4-0001-0001-0001-000000000001`), 14 categories, 85 items. Falnir and Kadri are waiting on menu data from the client. UUIDs must be valid hex.

## Rules to keep

- **Money is integer paise** everywhere (Rs 79 = 7900). Convert only at display time with `formatPrice`. GST is 5% on the subtotal, rounded once, via `calcTotals`.
- **The server is the source of truth for prices.** `POST /api/order` accepts item ids and quantities only, then reads names and prices from the DB and recomputes totals. Never trust prices from the browser.
- **Idempotent orders.** The client sends an `idempotencyKey` per checkout; a repeat returns the first order. Keep this when changing the order route.
- **Phones are stored as E.164 `+91XXXXXXXXXX`.** Use `normalizePhone`.
- **Every order writes an `order_created` row to `order_events`.** n8n depends on it. Keep the payload shape stable and tell Maithri if you change it.
- Veg/non-veg marks follow FSSAI (green square for veg, red for non-veg). Every item has `is_veg`.
- Cart is saved in localStorage per branch; wrap storage access in try/catch.
- Brand colours are placeholders (red/gold on dark), defined as tokens in `app/globals.css`. Use the `fk-*` tokens, not hard-coded hex.
- The WhatsApp bot link format is `/?branch=pandeshwar&phone=91XXXXXXXXXX`. It skips the branch picker and pre-fills the phone.

## Status: what exists and what does not

**Only the customer-facing ordering app has been built.** That is everything under `app/page.tsx` and the three API routes. It covers: branch picker, menu with categories, search and veg filter, cart (saved per branch), checkout (pickup or delivery, cash or UPI), order confirmation, and writing the order plus an `order_created` outbox row. It was verified end to end against a mock database and Maithri has since run the schema, seed and orders migration on the real Supabase project and is testing it.

**Nothing else exists yet. Do not assume any of these are present or look for them in the code:**

- No staff dashboard, no staff login, no `staff` table, no roles, no owner/super dashboard. There is no `/login` and no `/dashboard` route.
- No order management: nothing changes an order's status after it is placed, so orders stay `pending`.
- No staff-side menu management (sold-out switch, editing, adding items). The menu can only be changed in Supabase.
- No tables or dine-in, no POS, no riders, no analytics, no P&L, no settings pages.
- No delivery fee, minimum order or delivery pincodes.
- No phone verification at checkout (the OTP SQL functions exist but are not called).
- No menu photos, no item variants UI.
- No n8n workflows and no YCloud connection. Both are pending on the client and another developer; the app only writes to `order_events` for them to read later.
- Only Pandeshwar is seeded. The other branches do not exist in the database yet.

## Next task: staff dashboard, phase 1

The dashboard is modelled on the Oceana staff dashboard (a sibling product by the same team), changed for three branches. The full plan, with routes, database changes, build phases and open questions, is in `docs/DASHBOARD_PLAN.md`. Read it before writing any dashboard code. Key decisions already made with Maithri:

- Staff login with Supabase Auth (email and password) plus a `staff` table (`user_id`, `branch_id` nullable, `role`). Owner = no branch = sees all branches.
- One app, one Supabase project. Per-branch URLs `/dashboard/[branch]/...`, and an owner overview at `/dashboard`.
- The **Tables page must be its own page**, not a tab inside Orders as Oceana does it.
- Phase 1 only: login, staff table and RLS, dashboard shell with branch switcher, live Orders board, Menu management with sold-out switch. Do not start phase 2 or later without being asked.
- Supply any schema change as a separate SQL file in `supabase/` for Maithri to run; do not edit the v2 schema file.

Open questions still waiting on the client (do not guess): whether menu prices already include GST (the customer app currently adds 5% on top), whether branches have dine-in tables, whether they use their own riders, delivery rules per branch.

Other later work, roughly in order: menu images in Supabase Storage, seed Kadri and Pandeshwar with real addresses and hours, phone verification at checkout, delivery fee and pincodes, item variants, then n8n and YCloud.

## Working style

Maithri is a web developer. Prefer small, reviewable changes and plain explanations. Ask before changing the schema or the `order_events` payload, and give the SQL as a separate file she can run in the Supabase SQL Editor.
