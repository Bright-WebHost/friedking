# Fried King project context

Reviewed on 17 November 2026 against local commit `a463345` on `main`.

This reference combines the current source, SQL migrations, Claude's project notes, and the open Copilot conversation. Live Supabase migration state, n8n workflow configuration, YCloud template approvals, and production behavior require a separate runtime check.

## Project and stack

- Fried King is a Mangaluru restaurant ordering system maintained by Bright Media Tech.
- The customer website currently opens Pandeshwar directly through `ONLY_BRANCH` in `app/page.tsx`. The seed contains 14 categories and 85 items. Falnir and Kadri appear in the project plans.
- Customer ordering, staff operations, and internal platform administration share one Next.js application.
- Installed versions at review time are Next.js 16.4.6, React 19.3.1, and TypeScript 5.9.3.
- The stack includes App Router, strict TypeScript, Tailwind CSS v4, Supabase Auth/Postgres/Storage, Framer Motion, and Lucide.
- Vercel functions are configured for Singapore through `vercel.json` and `sin1`.
- Required environment variable names are `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `SUPABASE_SERVICE_ROLE_KEY`.

```text
Customer website ── Next.js APIs ── Supabase
Staff dashboard ── branch-scoped Next.js APIs ── Supabase
WhatsApp ── YCloud ── n8n ── Supabase RPCs / Next.js receipts
```

## Existing reference files

| File | Material covered |
| --- | --- |
| `AGENTS.md` | Requirement to consult the installed Next.js guides before writing code |
| `CLAUDE.md` | Architecture, business rules, implementation history, and integration notes |
| `.github/copilot-instructions.md` | Copilot working instructions and earlier messaging rules |
| `docs/HANDOFF.md` | 16 November handover, workflow inventory, SQL dependencies, and deployment tasks |
| `docs/DASHBOARD_PLAN.md` | Original Oceana parity checklist and staff role mapping |
| `docs/WHATSAPP_TEMPLATES.md` | OTP, receipt, table bill, rider, and promotion template specifications |

The existing files contain several generations of implementation status. Recent source and the later Copilot requests supply the context for the differences recorded below.

The local Next.js route-handler and proxy guides were consulted during this review. Future code changes should consult the relevant files under `node_modules/next/dist/docs/`. Current conventions include asynchronous `cookies()`, promised route `params`, and `proxy.ts`.

## Customer application

`app/page.tsx` is the main client component. Its screens are branch selection, menu, checkout, confirmation, and the table tab.

| Area | Main files and behavior |
| --- | --- |
| Menu | `app/page.tsx`, `/api/menu`, `/api/branches`. Categories, search, diet filters, recommended items, item details, and per-item notes |
| Offers | `OfferBanner` in `app/page.tsx`, `/api/promotions`, `lib/image.ts`. Carousel with Supabase image transformations and an image-failure fallback |
| Cart | `fk-cart-<branch>` in localStorage. Restores item IDs and quantities against the loaded menu. Notes stay in current component state |
| Order type | Delivery/takeaway welcome sheet. `?table=<number>` and table-linked WhatsApp tokens enter dine-in |
| Address | `components/AddressSheet.tsx`, `lib/address.ts`. Address labels, text, optional pincode, and compatibility with older saved strings |
| Delivery rules | `lib/delivery.ts`, `/api/rules`. Branch order types, minimum subtotal, fee, free-delivery threshold, active pincodes, and WhatsApp number |
| Free delivery | `components/FreeDelivery.tsx`. Progress UI and celebration when the food subtotal reaches the threshold |
| Verification | `components/VerifyCard.tsx`, `/api/verify/start`, `/api/verify/confirm`, `lib/verify/index.ts` |
| Customer account | `components/AccountPanel.tsx`, `/api/account/*`, `lib/customer/session.ts`. OTP login, signed 30-day HTTP-only cookie, recent orders, and up to 10 addresses |
| Table tab | `components/TableTab.tsx`, `/api/table`, `lib/tables.ts`. Open rounds, statuses, running total, and adding another round. Polls every 10 seconds while visible |
| Submit order | `POST /api/order`, request/response types in `lib/types.ts` |

### Identity and checkout

- A valid `?t=<token>` is exchanged through `/api/link`. The UI displays the customer's masked WhatsApp number and name.
- `wa_links` tokens last 48 hours. The order API resolves the stored phone for a valid token.
- The page removes the token and phone parameters from the address bar after reading the link.
- Older `?ph=` and `?phone=` parameters prefill the phone field.
- Valid WhatsApp-linked orders bypass OTP. Ordinary external orders use OTP when the OTP migration is available.
- Dine-in checkout bypasses OTP and uses the table contact. A new table tab collects a WhatsApp number for billing.
- OTP sending has a 30-second cooldown, five requests per phone per hour, and 15 requests per IP per hour. Confirmation checks a 30-minute lifetime and five wrong attempts.
- `verificationEnabled()` probes for the OTP column. An unavailable OTP schema activates the manual-phone checkout path.
- The customer web API currently accepts cash as its payment method.

### Order creation

`POST /api/order` validates the request, merges duplicate item IDs, caps each item at 50, loads active branch menu prices, calculates totals, applies delivery rules, resolves a table session when needed, upserts the customer, creates the order and item snapshots, and queues `order_created`.

The checkout carries an idempotency key and a repeated existing key returns the stored order. Web orders start as `pending`. The table flow allows up to 40 orders in an existing tab. Item notes are stored in `order_items.notes` separately from order-level instructions.

The route uses separate Supabase REST writes. It deletes an order after an item-insert failure. An outbox-insert failure is logged after the order is placed.

## Staff dashboard

The active entry point is `/dashboard/<branch>/<section>`.

```text
Server dashboard layout
  -> getStaffContext()
  -> DashboardShell
  -> sections/Section.tsx
  -> sections/<Feature>.tsx
  -> kit.tsx makeApi()
  -> /api/dashboard/<branch>/<domain>
  -> resolveCtx() and handler section checks
  -> lib/dashboard/handlers/<domain>.ts
```

| Area | Implementation |
| --- | --- |
| Shell | `DashboardShell.tsx`, `kit.tsx`, `dashboard.css`. Branch metadata, navigation, mobile layout, sound, wake lock, refresh, modal state, and formatting |
| Tables & Orders | `sections/Orders.tsx`, `Tables.tsx`, `orderParts.tsx`, `handlers/orders.ts`, `handlers/tables.ts`. Kanban, table rail, rounds, accept/decline, edits, payment, move, merge, close, history, and printing |
| New-order alert | `NewOrderAlert.tsx`. Pending queue polling every four seconds, siren, prep-time selection, accept/decline, and optional automatic printing |
| POS | `sections/POS.tsx`, `handlers/pos.ts`. Popular dishes, cart, customer lookup, loyalty redemption, percentage discount, and direct creation in `preparing` |
| Menu | `sections/Menu.tsx`, `handlers/menu.ts`. Availability, featured dishes, prices, photos, categories, dish stock, and ingredient recipes |
| Stock | `sections/Stock.tsx`, `stockParts.tsx`, `handlers/stock.ts`. Restock, waste, stock take, ingredient CSV import/export, ledger, expiry, and recipe margins |
| P&L | `sections/Pnl.tsx`, `handlers/expenses.ts`. Orders, current recipe costs, expenses, comparisons, charts, and CSV export |
| Riders | `sections/Riders.tsx`, `handlers/riders.ts`. Assignments, payment collection, cash handovers, and balances |
| Analytics | `sections/Analytics.tsx`. Calculations from the orders and contacts APIs, date ranges, sales, items, customers, riders, and shift reports |
| Live Chat | `sections/Chat.tsx`, `handlers/chat.ts`. Thread list, unread state, queued staff replies, and per-chat AI control |
| Contacts | `sections/Contacts.tsx`, `handlers/contacts.ts`. Imports, search, segmentation, and promotion audience selection |
| Loyalty | `sections/Loyalty.tsx`, `handlers/loyalty.ts`. Program settings, tiers, balances, performance, and redemption |
| Promotion | `sections/Blast.tsx`, `handlers/blast.ts`. Audiences, approved templates, image headers, campaign queue, and monthly usage |
| Settings | `sections/Settings.tsx`, `handlers/settings.ts`, `lib/dashboard/settings.ts`. Branch profile, hours, delivery, branding, banners, printing, passcodes, staff, and promotion cap |
| AI Assistant | `sections/AI.tsx`, `handlers/ai.ts`, `handlers/aiActions.ts`. Live data snapshot, editable prompt starters, proposed actions, staff confirmation, execution, and destination links |

### Access and navigation

- Supabase Auth identifies staff through `lib/auth/staff.ts`. Branch access uses the staff row's `branch_id`, with `null` granting cross-branch access.
- `lib/dashboard/access.ts` defines section visibility for `owner`, `manager`, and `staff`.
- Staff can access POS and Tables & Orders. Managers additionally have Chat, Menu, Stock, P&L, Riders, Analytics, AI, and Loyalty. Owners also have Contacts, Promotion, and Settings.
- `/dashboard/<branch>/tables` renders the combined Orders section. The section resolver also maps `tables` to `orders`.
- `getStaffContext()` caches verified identities for 45 seconds per access token. `resolveCtx()` caches branch rows for 60 seconds. The shell restores recent metadata from sessionStorage.
- The API dispatcher accepts GET reads and POST actions using JSON or multipart uploads. Shared context checks authenticate and scope requests before handler execution.
- Older `DashboardClient`, `DashboardContacts`, `DashboardPOS`, `DashboardPhase2`, `DashboardPlaceholder`, `DashboardReports`, and `DashboardSettings` components remain in the tree. Their older static APIs also remain addressable. Current section routing uses the branch-scoped dispatcher.

### Orders, stock, and loyalty

- Normal order progression is `pending -> preparing -> ready -> delivered`. Cancellation uses `cancelled`. Legacy `confirmed` is supported in several paths.
- WhatsApp drafts use `draft`, and staff order reads explicitly filter the visible statuses.
- `moveOrder()` centralizes status timestamps, optimistic concurrency checking, stock transitions, loyalty earning, outbox events, and audit records.
- Cancelling through the normal status action requires `undo_passcode`. Declining a new order has its own path. Backward moves require manager/owner access and the passcode.
- POS percentage discounts require manager/owner access and server validation of `discount_passcode`. Both passcode defaults are `0000`, with separate Settings fields.
- Stock writes use `fk_stock_move` and `fk_order_stock`. Acceptance/POS creation deducts tracked dish or recipe ingredient stock, and cancellation restores it.
- Loyalty earning uses `fk_loyalty_earn` on delivery/table settlement. Redemption uses `fk_loyalty_redeem`.
- Dashboard polling uses `usePoll()`, which pauses while hidden or while the shared busy counter is active. Order changes also dispatch `fk-orders-changed`.

## Money, tokens, receipts, and printing

- Stored monetary values are integer paise. Customer API types use camelCase and database/dashboard rows generally use snake_case.
- `calcTotals()` in `lib/utils.ts` adds 5% GST to the food subtotal. The bot's `fk_wa_write_items()` performs the corresponding SQL calculation.
- Website delivery fees are added after GST. Free delivery compares the food subtotal with the configured threshold.
- The discount calculation currently applies a percentage to the GST-inclusive POS total. Loyalty redemption then reduces the payable total.
- `orders.order_number` is the persistent Bill No. Its identity starts at 1001.
- `friedking_order_tokens.sql` assigns Token No. per branch per IST calendar day using a trigger and advisory transaction lock. It also backfills historical orders.
- `GET /api/receipt?order=<uuid>` renders a WhatsApp PNG receipt through `next/og`, local Poppins fonts, and brand assets.
- `GET /api/receipt?session=<uuid>` combines eligible table rounds and merges item quantities/amounts by dish name.
- Thermal printing lives in `app/dashboard/(main)/kit.tsx`. `printReceipt()` produces bill and KOT in one print job with page-break CSS. KOT includes menu descriptions and special notes.
- Printed values use `plainRs()` and whole-rupee rounding. Customer `formatPrice()`, dashboard `rs()`, and the PNG receipt formatter still support fractional rupees.
- `gst_percent` supplies printed labels, while order calculations currently use the shared fixed 5% rate.

## WhatsApp and n8n integration

The repository contains the application and SQL side. n8n workflow JSON is maintained externally according to the existing notes and Copilot conversation.

| Integration | Repository contract |
| --- | --- |
| Main bot | `friedking_whatsapp_bot.sql`. Chat triggers/context, private links, draft/confirm/amend/cancel, table QR sessions, receipt lookup, and rider payment acknowledgement |
| Amendment confirmation | `friedking_whatsapp_amend_confirm.sql`. Staged item changes, customer confirmation/discard, and expiry |
| Order Events | `friedking_order_notifier.sql`. `claim_order_events()` and `complete_order_event()` |
| Staff replies | Outbound `chat_messages` with pending delivery status. `claim_chat_replies()` and `complete_chat_reply()` support the external sender |
| Promotions | `broadcast_campaigns` plus one `outbound_messages` row per recipient |
| OTP | `/api/verify/start` calls the configured `otp_webhook_url` with the code and template settings |
| Dashboard AI | `ai_webhook_url` receives a server-built system prompt, history, and question. Proposed writes are resolved and executed by the app after staff confirmation |

Outbox event names include `order_created`, `order_status_changed`, `order_amended`, `rider_assigned`, `customer_rider_assigned`, `invoice_requested`, and `table_invoice_requested`.

The SQL notifier claims status, table-bill, rider, customer-rider, and specially marked table-round events. It expires pending events after 30 minutes, reclaims stalled claims after five minutes, and limits claims to three attempts. Explicitly failed events require separate recovery.

The messaging window is represented by inbound chat activity in the previous 24 hours. Approved templates and their provider status are external dependencies. The rider template's quick-reply button is `Payment collected`. The rider-payment update described in `docs/RIDER_PAYMENT.md` adds an order UUID payload and retains message-ID matching for older dispatches.

### Later Copilot requirements and changes

The open session contains the original Claude handover, rider-template troubleshooting, and the later ordering/billing requests. The recent local commits are `f73173d`, `a1cb6b3`, `08c6cb8`, and `a463345`.

- New-order prices use exclusive GST, daily Token No., and persistent Bill No.
- Bills and KOT carry the requested invoice details, descriptions, and notes. The latest print change adds explicit separate-page rules.
- Staff discount presets are 5%, 10%, 20%, and Custom. The latest change removes the reason input and asks for a passcode in a modal when placing the order.
- The greeting was shortened in the externally maintained Main workflow according to Copilot's report. The later request reduced emoji usage.
- WhatsApp-linked checkout retains its linked-number state and bypasses OTP. External checkout retains verification. Table checkout bypasses OTP.
- First table order should receive its receipt after staff acceptance. Subsequent rounds should receive item/quantity details, the round total, and the complete running table total as text. Closing the table should send the complete bill image with a thank-you message.
- Website and POS event creation now check whether the table already has orders before tagging `table_round_added`.
- Visible dashboard labels are Tables & Orders and Promotion. The internal `orders` and `blast` identifiers continue to identify their routes and handlers.
- Platform administration now displays monthly promotion usage and remaining capacity.
- AI quick prompts populate an editable input, and completed actions expose destination links.
- Earlier rider failures in the chat show `WHATSAPP_TEMPLATE_UNAVAILABLE` with template status `PENDING`. The conversation records a template-based dispatch path at that point.

## Internal platform administration

`app/platform-admin/page.tsx` uses Supabase Auth and `/api/platform-admin`. The API checks an active `platform_admins` allowlist row. It exposes active branches, promotion limits, monthly usage/remaining capacity, and recent audit entries. Limit changes write `platform_admin_audit`.

Promotion usage counts branch blast queue rows for the current IST month, excluding failed rows. Limit editing is restricted to platform administration. The default monthly limit is 1000.

## Database migration map

SQL is applied through the Supabase SQL Editor in the project's current workflow. The files express the following dependencies.

1. Root `friedking_schema_migration_v2.sql`, then root `friedking_pandeshwar_menu_seed_v4.sql`.
2. `supabase/friedking_schema_migration_v3_orders.sql`.
3. `friedking_dashboard_phase1.sql`, `friedking_dashboard_phase1_tables.sql`, and `friedking_dashboard_phase2.sql` under `supabase/`.
4. `friedking_menu_promotions.sql`, `friedking_menu_storage.sql`, then `friedking_dashboard_oceana.sql`.
5. `friedking_whatsapp_bot.sql`, then `friedking_order_notifier.sql` and `friedking_whatsapp_amend_confirm.sql`.
6. `friedking_phone_verify.sql`, then `friedking_phone_otp.sql`.
7. Additional feature/data migrations include `friedking_order_tokens.sql`, `friedking_delivery_fee.sql`, `friedking_platform_admin.sql`, `friedking_pandeshwar_branch_rename.sql`, and `friedking_pandeshwar_item_images.sql`.

Core entities are branches, menu categories/items/variants, customers, orders, order items, and order events. Dashboard extensions add staff, tables/sessions, ingredients/recipes/stock movements, expenses, riders/cash handovers, settings/pincodes, chat, loyalty, campaigns, and outbound messages. Customer verification, addresses, WhatsApp links/amendments, tokens, and platform administration have their own incremental migrations.

RLS is enabled throughout the schema. The browser uses the public Supabase client for authentication. Server API logic uses `lib/supabase/admin.ts` after its relevant validation/access checks.

## Differences requiring attention during future changes

- `CLAUDE.md` contains early statements about a missing dashboard and paused integrations alongside later implementation notes. Current source includes the dashboard and integration contracts.
- `HANDOFF.md` and `DASHBOARD_PLAN.md` describe several completed features as remaining work, including website dine-in, OTP, delivery rules, and AI actions.
- The earlier single-receipt messaging note in `.github/copilot-instructions.md` predates the later multi-stage notification requests visible in Copilot.
- The dashboard plan describes a separate Tables page. Current routing combines it with Orders.
- A five-second menu-cache note appears in `CLAUDE.md`. Current successful `/api/menu` and `/api/promotions` responses set a 60-second shared cache and 300-second stale-while-revalidate period.
- The later whole-number request covers food totals broadly. Current whole-rupee rounding is implemented in thermal printing, and other display formatters still retain decimal support.
- The AI prompt starters include creating an order. The current action allowlist supports existing-order operations, stock, availability/prices, selected settings, and expenses. New-order creation would need an additional action implementation.
- `customer_draft()` in the checked-in bot SQL still supplies a placeholder delivery address. Current website checkout collects a structured address.
- Table-round tagging is present in website/POS creation. The checked-in bot `customer_confirm()` emits its own `order_created` shape. Subsequent-round receipt suppression also depends on external n8n logic.
- Existing notes and Copilot contain different dates for workflow activation, OpenAI credential setup, and template approval. Their present live state requires verification.
- The image migration maps all 85 seeded items, and several items share source photography. `scripts/generate_missing_menu_images.py` derives variants from existing photos. There are 79 files in `public/menu` at review time.

## Local verification and working context

- `npm run typecheck -- --incremental false` passed on 17 November 2026.
- The open Copilot session reports successful builds and workflow syntax checks for its recent changes. Those reports supply historical context for this review.
- Package scripts are `dev`, `build`, `start`, and `typecheck`. The package currently provides no lint or test script.
- The working tree initially contained a modified `.gitignore` and untracked `AGENTS.md`.
- A development server may already be running on port 3000 or 3001, as recorded in the existing notes and editor session.
- Existing project guidance requests small, reviewable changes and discussion of schema or event-payload changes, with SQL supplied as a separate file for manual application.

## Follow-up fixes on 17 November 2026

- Table acceptance now sets the existing `customerNotification.receipt` flag according to the first eligible round in the session. Later rounds and repeated acceptance transitions set it to `false`.
- The live `Fried King | Order Events` workflow's Build Message node now honors `receipt: false`. Its active state was verified after the update. Intermediate round text and the complete table bill retain their existing paths.
- `lib/dashboard/tableSessions.ts` provides shared settlement for the order Done action and table Close & pay. It completes eligible rounds, records payment when selected, closes the session, and queues the complete table bill. Retrying a closed session returns its existing result.
- Dine-in rounds appear in Ready / Out. Mark served moves a round to ready, and marking it done settles the table. The close confirmation shows the total for all rounds.
- Occupied table cards show the guest, round count, elapsed time, item preview, and running total. Close & pay refreshes the Orders board immediately.
- Offer banners use the original uploaded image. The project's Supabase image-transformation endpoint returned `403 FeatureNotEnabled` while the original returned HTTP 200.
- POS clears a successful sale and navigates to Orders before its optional bill lookup/printing. It reserves the print window during the click, waits for receipt images, and closes the window after printing. Bill lookup failures leave the completed sale available through the order's Print action.
- Verification included the production build, isolated server regression checks, and Chromium checks with mocked order APIs on desktop and mobile. The banner check loaded the actual public image. Real WhatsApp delivery and physical printer output require a live acceptance check after the application is deployed.

## Rider and receipt release on 17 November 2026

- Commit `455cd0c` deployed the table/POS/banner fixes and the later rider, receipt, confirmation, and Settings changes. Both matching n8n workflows were published and verified active.
- `lib/rider/payment.ts` and `/api/rider/payment` confirm an assigned rider's payment through the dashboard Done action. The n8n quick-reply payload carries the order UUID; legacy dispatches retain WAMID matching. See `docs/RIDER_PAYMENT.md` for release details and verification.
- Rider dispatch text labels the customer phone, address, order total and cash to collect. The customer assignment notification uses the scooter emoji.
- Checkout confirmation now says `Order placed`. WhatsApp receipt PNGs have larger branding/text and a small `Developed by Loopdot` footer.
- Restaurant Settings no longer displays or permits edits to the promotion limit; platform administration retains that control.
