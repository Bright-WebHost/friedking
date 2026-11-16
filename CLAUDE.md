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
supabase/ SQL files, run in order in the Supabase SQL Editor: schema v2, Pandeshwar seed v4, orders migration v3,
                          then dashboard phase1, phase1_tables, phase2, menu_promotions, menu_storage, dashboard_oceana
docs/DASHBOARD_PLAN.md    Oceana -> Fried King feature checklist and decisions for the staff dashboard

app/dashboard/(auth)/login              Staff sign-in (Supabase Auth)
app/dashboard/(main)/DashboardShell.tsx Sidebar, header, sound/shift gate, branch switcher, global NewOrderAlert
app/dashboard/(main)/kit.tsx            Client kit: api(), IST ranges, Modal, Slide, Switch, printing, usePoll
app/dashboard/(main)/sections/*.tsx     One file per page: Orders, Tables, POS, Chat, Menu, Stock, Pnl, Riders, Analytics, Contacts, Loyalty, Blast, Settings
app/dashboard/dashboard.css             Oceana stylesheet port, scoped under .fkd
app/api/dashboard/[branch]/[domain]     Single dispatcher: GET = read, POST {action} = write
lib/dashboard/handlers/*.ts             Server logic per domain (service role, branch + role checked in resolveCtx/needSection)
lib/dashboard/access.ts                 Sections and which roles see them (owner / manager / staff)
```

Old dashboard files that are no longer used and can be deleted: `app/dashboard/(main)/Dashboard{Client,Contacts,POS,Phase2,Placeholder,Reports,Settings}.tsx` and `app/api/dashboard/{orders,menu,pos,tables,stock,loyalty,broadcasts,contacts,analytics,settings,promotions}/`. Keep `app/api/dashboard/me`.

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
- Brand tokens (`fk-*`) live in `app/globals.css`; the dashboard has its own scoped variables in `app/dashboard/dashboard.css`.
- The WhatsApp bot link format is `/?branch=pandeshwar&phone=91XXXXXXXXXX`. It skips the branch picker and pre-fills the phone.

## Status

**Customer ordering app** (`app/page.tsx` + `/api/order`): branch menu, cart, checkout (pickup or delivery), confirmation, `order_created` outbox row. Live on the real Supabase project.

**Staff dashboard** (`/dashboard/[branch]/[section]`): a feature-for-feature copy of the Oceana staff dashboard in Fried King colours, built 2026-11-14. Full checklist and decisions in `docs/DASHBOARD_PLAN.md`. Sections: POS, Orders (new-order popup with siren, kanban, slide-to-advance, edit, undo with passcode, print), Tables (separate page: tabs, rounds, close & pay, move, merge, QR), Live Chat, Menu, Stock (dishes, ingredients, recipes, ledger, stock take, reports), P&L, Riders, Analytics, Contacts, Loyalty, Blast, Settings (incl. staff logins). Needs `supabase/friedking_dashboard_oceana.sql` to be run.

Decisions (Maithri, 2026-11-14):
- WhatsApp sends never leave the dashboard directly. Order messages go to `order_events` (`order_status_changed`, `rider_assigned`, `invoice_requested`, `table_invoice_requested`, plus `order_created` from POS); chat replies go to `chat_messages` (outbound, `delivery_status = pending`); blasts go to `outbound_messages`. n8n sends them later.
- AI Assistant is the last item, after an AI provider is chosen. The page shows a placeholder.
- Statuses keep the existing enum: pending = new (awaiting accept), preparing, ready (= ready for pickup / out for delivery / served), delivered, cancelled (declines carry `cancel_reason`).
- Roles: owner (all sections, all branches), manager (no Contacts, Blast, Settings), staff (POS, Orders, Tables).
- Stock moves only through `fk_stock_move` / `fk_order_stock` (deduct on accept or POS create, restore on cancel). Points are earned via `fk_loyalty_earn` when an order is marked delivered.

**WhatsApp bot** (n8n `Fried King | Main` on staff.brightmedia.tech, YCloud number 9742175222, Pandeshwar only). Database side is `supabase/friedking_whatsapp_bot.sql`: `chat_context`, `customer_draft`, `customer_amend`, `customer_confirm`, `customer_cancel`, `receipt_order` (all take `p_branch`, default `pandeshwar`). Chat lives in `chat_messages` / `chat_sessions` (what Live Chat reads). A WhatsApp order starts as an `orders` row with status `draft` (hidden from the dashboard, which filters by real statuses); Confirm makes it `pending` and writes the normal `order_created` event (`source: whatsapp`); amending a pending order writes `order_amended`. Customer-facing order numbers are `FK-<order_number>`. Menu link comes from `branch_settings.menu_url` (default `https://friedking.vercel.app/`; the bot appends `?ph=<phone>`). The workflow carries the Pandeshwar branch id in its chat nodes; a second branch needs its own copy.

**Locked WhatsApp details on the website:** `chat_context` returns a menu link with a private token (`?t=`, table `wa_links`, valid 48 h). `/api/link` turns it into a masked number and name; the checkout shows "Linked to your WhatsApp" and does not let the number be edited, and `/api/order` uses the number stored for the token (the browser's number is ignored). Without a valid token the form is manual as before. Item notes travel per line (`items[].note` -> `order_items.notes`), not merged into the order note.

**OTP at checkout + customer profile (free, over WhatsApp):** every web order needs a fresh OTP, link-token orders and logged-in customers too. `components/VerifyCard.tsx` calls `POST /api/verify/start` (row in `wa_verifications`, code + `wa.me` link using `branch_settings.whatsapp_number`); the customer sends `VERIFY <code>`; n8n `Fried King | Main` (Route -> `Verify Code` -> `Build Verify Reply`) calls `wa_verify`, which stores a 6-digit OTP and the bot sends it back; the customer types it, `/api/verify/confirm` (5 tries) marks it verified, and `/api/order` takes the phone from that row (`verifySecret`, one use; for link-token orders it must equal the linked number). Fail-open: if the SQL is not run, checkout keeps the manual number field. Profile: logging in uses the same OTP (`/api/account/session` sets the signed `fk_cust` cookie, 30 days, key derived from the service key in `lib/customer/session.ts`); `/api/account/me|addresses|logout` serve past orders and saved addresses (`customer_addresses`); UI is `components/AccountPanel.tsx`. SQL: `friedking_phone_verify.sql` then `friedking_phone_otp.sql`.

**Live Chat replies:** staff replies are saved as outbound `chat_messages` with `delivery_status = pending`; n8n `Fried King | Chat Replies` (every 5 s, `claim_chat_replies` / `complete_chat_reply`) sends them within the 24-hour window, otherwise marks them failed.

**Messages a customer gets (same order as Rasoi):** ONE message per order: the receipt image with a short caption, sent when staff accept it. Ready / out for delivery / delivered are never sent. Cancelled orders get a short text. Dine-in: nothing until the table is closed, then one receipt for the whole table (`/api/receipt?session=<uuid>`). The bot itself sends no "order confirmed" text. Outside the 24-hour window the receipt goes as the approved templates `friedking_order_receipt` / `friedking_table_bill` (image header); riders always get the template `friedking_rider_msg` (6 body params + quick-reply button "Payment collected"); the tap runs `rider_confirm_payment`, matched on `orders.rider_wa_message_id`.

**Dashboard AI Assistant:** page `/dashboard/<branch>/ai` -> handler `ai.ts` builds a read-only data snapshot -> n8n workflow `Fried King | Dashboard AI` (webhook URL stored in `branch_settings.ai_webhook_url`) -> OpenAI `gpt-4.1-mini` via the n8n credential `Fried King | OpenAI` (same as the bot). Needs a real OpenAI key in that credential.

**Hosting:** `vercel.json` pins functions to `sin1` (Singapore, next to Supabase). Without it Vercel ran them in the US and every request took about 2 s. `/api/menu` and `/api/promotions` are cached at the CDN for 30-60 s.

**Bot opening hours** come from the branch (`branches.opens_at/closes_at`, edited in Dashboard > Settings > Hours), not hard-coded.

**Order notifier** (n8n `Fried King | Order Events`, polls every 10 s): `supabase/friedking_order_notifier.sql` gives `claim_order_events` / `complete_order_event`. It sends `order_status_changed` events to the customer on WhatsApp: accepted = receipt image drawn by the app itself (`GET /api/receipt?order=<order uuid>`, next/og, same approach as Rasoi; no HCTI) or itemised text if that fails, then ready / delivered / cancelled texts. Only inside the 24-hour reply window; events older than 30 minutes are dropped. n8n talks to Supabase through the credential `Fried King | Supabase (service role)` (type supabaseApi; a single-header credential does not work because Supabase needs both `apikey` and `Authorization`). (`Fried King | Main` still uses HCTI for its amended-order invoice picture.)

Not done yet:
- Bot: table QR scans ("Hi, I'm at Table 3") call `open_table_session`; a customer with an open table gets their WhatsApp orders attached to it as dine-in. The old `Dine-In & Dispatch`, `Table Close`, `Rider Dispatch`, `Send Invoice` and `PWA Order Receiver` workflows are still Oceana copies with a placeholder database and stay inactive. The old `Fried King | Status Notifier` is superseded by `Order Events` and stays inactive. Rider "Payment collected" button is a stub. The Route node's opening hours are hard-coded 7:00 to 23:30, not the branch hours.
- Customer checkout does not yet use the dashboard's minimum order, delivery fee, pincodes or order-type settings (client rules unknown).
- No phone verification at checkout (OTP functions exist, not called). No item variants UI.
- n8n workflows and the YCloud connection (pending on the client and another developer).
- Only Pandeshwar is seeded; Falnir and Kadri wait on menu data.

Open questions for the client (do not guess): whether menu prices already include GST (orders add 5% on top today), delivery rules per branch.

## Working style

Maithri is a web developer. Prefer small, reviewable changes and plain explanations. Ask before changing the schema or the `order_events` payload, and give the SQL as a separate file she can run in the Supabase SQL Editor.
