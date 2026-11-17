# Fried King: handover (written 2026-11-16)

Read this first, then `CLAUDE.md` (project rules) and `docs/DASHBOARD_PLAN.md` (feature checklist). Maithri (web developer, Bright Media Tech) owns the project. Prefer small, reviewable changes and plain explanations. Ask before changing the database schema or the `order_events` payload, and give SQL as a separate file in `supabase/` that she can run in the Supabase SQL Editor.

## 1. What this is

Online ordering for Fried King (fried chicken, Mangaluru). **Only the Pandeshwar branch is live.** Falnir and Kadri come later.

```
Customer website (Next.js on Vercel)  ->  Supabase (Postgres, Singapore)  <-  Staff dashboard (same Next.js app)
WhatsApp customer -> YCloud -> n8n (staff.brightmedia.tech) -> Supabase / Next.js APIs
```

- Repo: `https://github.com/Bright-WebHost/friedking` (branch `main`, Vercel deploys from it). Live site: `https://friedking.vercel.app`.
- Next.js 16 (read `node_modules/next/dist/docs/` before using an API; `middleware` is `proxy`, route `params` are Promises), React 19, Tailwind v4, Supabase.
- WhatsApp business number connected in YCloud: **+91 97421 75222** (Pandeshwar). The client's *official* number cannot be used (they use it for business); see "Open decisions".

## 2. What is DONE

**Customer website** (`app/page.tsx`, `/api/menu`, `/api/order`, `/api/promotions`, `/api/link`)
- Menu (categories, search, veg filter, photos, offer banner), cart saved per browser, checkout (pickup or delivery, cash), order confirmation. Fried King red/white/checkered design copied from Rasoi's layout.
- Per-item special notes are sent per line (`items[].note` -> `order_items.notes`).
- WhatsApp-linked checkout: the bot's menu link carries a private token (`?t=`, table `wa_links`, valid 48 h). The page shows "Linked to your WhatsApp" with name and masked number; the number cannot be edited; `/api/order` uses the number stored for the token, never the browser's.
- Menu and offers are cached 30-60 s at the CDN and fetched in parallel.

**Staff dashboard** (`/dashboard/<branch>/<section>`): a feature-for-feature copy of the Oceana staff dashboard in Fried King colours. Sections: POS, Orders (new-order popup with siren, kanban, slide to advance, edit, undo with passcode, print), Tables (own page: tabs, rounds, close & pay, move, merge, QR), Live Chat, Menu, Stock (dishes, ingredients, recipes, ledger, stock take, reports), P&L, Riders, Analytics, Contacts, Loyalty, Blast, Settings (incl. staff logins), AI Assistant. Roles: owner (everything, all branches), manager (not Contacts, Blast, Settings), staff (POS, Orders, Tables). Special notes are highlighted yellow everywhere.
- Code layout: `app/dashboard/(main)/` (shell, `kit.tsx`, `sections/*.tsx`), `app/api/dashboard/[branch]/[domain]/route.ts` (single dispatcher: GET = read, POST `{action}` = write), `lib/dashboard/handlers/*.ts` (server logic with the service role; branch and role are checked in `resolveCtx` / `needSection`). Old unused dashboard files can be deleted (listed in `CLAUDE.md`).

**WhatsApp bot** (n8n `Fried King | Main`): greeting, AI order-taking, Confirm / Modify / Cancel buttons, voice notes (Whisper), table QR scans ("Hi, I'm at Table 3" -> `open_table_session`; the customer's WhatsApp orders then attach to that table as dine-in), staff takeover switch (AI off per chat), real branch opening hours.
- A WhatsApp order is an `orders` row with status `draft` (hidden from the dashboard). Confirm makes it `pending` and writes the normal `order_created` event (`source: whatsapp`). Customer-facing order numbers are `FK-<order_number>`.

**One message per order (same as Rasoi)**, sent by n8n `Fried King | Order Events` (polls every 10 s):
- Staff accept the order -> **one receipt image with a short caption**. Nothing for ready / out for delivery / delivered. Cancelled -> short text.
- Dine-in: nothing until the table is closed, then one receipt for the whole table (`/api/receipt?session=<uuid>`).
- Rider assigned -> template message with a "Payment collected" button; the rider's tap marks cash collected (`rider_confirm_payment`).
- The receipt picture is drawn by the app itself (`app/api/receipt/route.tsx`, next/og + Poppins from `public/fonts`), keyed by the private order uuid. No third-party image service.
- Free-form messages only work within 24 h of the customer's last message; otherwise the approved templates below are used.

**Dashboard AI Assistant**: handler `lib/dashboard/handlers/ai.ts` builds a read-only data snapshot (sales, best sellers, stock, tables, rider cash) -> n8n `Fried King | Dashboard AI` (URL stored in `branch_settings.ai_webhook_url`) -> OpenAI `gpt-4.1-mini` via the n8n credential `Fried King | OpenAI`. Text only (no voice, no write actions).

**Speed**: `vercel.json` pins functions to `sin1` (Singapore). Before that, Vercel ran in the US and each request took about 2 s.

## 3. ACTION NEEDED from Maithri (nothing below works until she does it)

1. **Re-run in the Supabase SQL Editor, in this order** (both idempotent): `supabase/friedking_whatsapp_bot.sql`, then `supabase/friedking_order_notifier.sql`. They add: real branch hours in `chat_context`, rider payment, table bill and rider events in the notifier, `wa_links`, Live Chat reply functions. Until then the bot and receipts keep working in their older form (the n8n workflows were made tolerant of the old SQL).
2. **Put a real OpenAI key in n8n** credential `Fried King | OpenAI`. It currently holds a placeholder (`sk-PASTE...KEY`), so the dashboard AI Assistant and the bot's free-text order-taking cannot answer.
3. **Create 3 templates in YCloud** (English, category Utility):
   - `friedking_order_receipt`, header = Image. Body: `Hi {{1}}, thank you for ordering from Fried King! Your order {{2}} (total {{3}}) is confirmed. Your receipt is attached.`
   - `friedking_table_bill`, header = Image. Body: `Hi {{1}}, thank you for dining with us at Fried King! Your bill for table {{2}} ({{3}}) is attached.`
   - `friedking_rider_msg`, no header. Body (6 variables): `New delivery {{1}}. Customer: {{2}} ({{3}}). Address: {{4}}. Items: {{5}}. Collect: ₹{{6}} in cash. Tap the button once the payment is collected.` plus a **Quick reply** button with the text exactly `Payment collected`.
   - Marketing blasts also need `friedking_promo_en` (Marketing, header Image).
4. **After step 1, activate the n8n workflow `Fried King | Chat Replies`** (id `Ap3fEKiYzKioNjdf`; inactive on purpose). It sends replies that staff type in Live Chat. Without it, replies are saved but never delivered.
5. **Set the real opening hours** in Dashboard -> Settings -> Hours (currently the placeholder 12:00 to 22:00) and the WhatsApp number in Settings.
6. Delete the old unused dashboard files listed in `CLAUDE.md` (an automatic delete was blocked).

## 4. REMAINING WORK (in priority order)

1. **WhatsApp delivery orders have no real address.** The bot saves the placeholder "Address to be confirmed with the customer on WhatsApp". Make the bot ask for the address (and pincode) before confirming a delivery order.
2. **Test table QR scans with a real phone** (built and unit-tested against a local database only). Table numbers in the QR must match the dashboard's Tables page (1-8 exist). QR needs the WhatsApp number in Settings.
3. **Test everything end to end with real WhatsApp**: Hi -> order -> Confirm -> staff accept -> receipt; table order -> close table -> bill; assign rider -> button tap. Only unit-level and database-level tests were done; no real sends were made.
4. **Cancelled / declined messages outside the 24 h window** are not sent (no template). Add a `friedking_order_cancelled` template if wanted.
5. **Website**: dine-in ordering from the web page itself (today table orders go through WhatsApp), phone verification at checkout (OTP functions exist but are not called), minimum order, delivery fee and delivery pincodes (stored in Settings but not used by checkout), item variants UI (table exists).
6. **Menu photos**: 45 of 85 Pandeshwar items have a photo in `public/menu/`; originals live in `assets/items-original/` (not deployed).
7. **Other branches**: Falnir and Kadri need menu seeds, tables, a WhatsApp number each and their own copy of the n8n workflows (`Main`, `Order Events`, `Chat Replies` hard-code branch `pandeshwar`, its branch id and the sender number `+919742175222`).
8. **Dashboard AI**: voice notes and "apply changes" actions (restock, prices) from Oceana are not built; the assistant is read-only.
9. **Old n8n workflows** (Dine-In & Dispatch, Table Close, Rider Dispatch, Send Invoice, Status Notifier, PWA Order Receiver, Payment Verify, Razorpay Webhook, Rating Request, Abandoned Cart, Analytics & Insights, AI Toggle, AI Auto-Resume, Agent Reply Sender, Blast Sender, Customer Account, AI Assistant) are **Oceana copies with a placeholder database address and Oceana table names. They are inactive: do not switch them on as they are.** Their jobs are covered by the new workflows, except Blast Sender (needs porting to `outbound_messages`, see `blast.ts`) and Rating Request.
10. Cleanup: `Fried King | Receipt Image` (HCTI) is active but no longer used by anything except nothing; `Main` still uses HCTI for the amended-order invoice picture and the HCTI credential (`Fried King | HCTI API`) is invalid ("Unauthorized"). Either port that picture to `/api/receipt` or remove it.

## 5. n8n inventory (instance `https://staff.brightmedia.tech`)

| Workflow | Id | State | Purpose |
|---|---|---|---|
| Fried King \| Main | `bs21eCX2lGfXAeme` | active | WhatsApp bot (webhook from YCloud) |
| Fried King \| Order Events | `ppgSbbKzkPUQBdgF` | active | outbox -> receipt / cancel text / table bill / rider template |
| Fried King \| Chat Replies | `Ap3fEKiYzKioNjdf` | **inactive (activate after SQL)** | Live Chat replies -> WhatsApp |
| Fried King \| Dashboard AI | `MqDDRzNiG8odojw5` | active | OpenAI proxy for the dashboard assistant |
| Fried King \| Receipt Image | `osnto59gMLzSoeUA` | active, unused | old HCTI receipt; can be turned off |

Credentials (ids, no secrets here): `Fried King | Supabase (service role)` `rB93QINuNPfEbMaT` (type supabaseApi, use this for every Supabase call); `Fried King | YCloud API Key` `2sHKICxwNID36i9F`; `Fried King | OpenAI` `n2e59mhPDPr2lGEv` (placeholder key!); `Fried King | HCTI API` `DSVxiXuQPAIU5gRM` (invalid). The old `Fried King | Supabase Service Key` (`K3qQDKPl2aa72ykk`, single header) does **not** work: Supabase needs both `apikey` and `Authorization` headers for this project's legacy JWT key. Do not use it.

Editing workflows through the n8n public API (what was done so far): `GET /api/v1/workflows/{id}`, modify, `PUT` with only `name, nodes, connections, settings` (settings limited to `executionOrder, saveDataErrorExecution, saveDataSuccessExecution, saveManualExecutions, saveExecutionProgress, executionTimeout, errorWorkflow, timezone, callerPolicy`). **A PUT can switch an active workflow off**: always check `active` afterwards and call `POST /api/v1/workflows/{id}/activate`. The API key used was `RASOI_N8N_API_KEY` from `C:\brightmedia\rasoi\.env.local` (same n8n server). Create a Fried King key of its own and add it to this project's `.env.local`. Always keep a backup of the workflow JSON before a PUT.

## 6. Database

Run in the Supabase SQL Editor, in this order: `friedking_schema_migration_v2.sql`, `friedking_pandeshwar_menu_seed_v4.sql` (repo root), `supabase/friedking_schema_migration_v3_orders.sql`, `friedking_dashboard_phase1.sql`, `..._phase1_tables.sql`, `..._phase2.sql`, `friedking_menu_promotions.sql`, `friedking_menu_storage.sql`, `friedking_dashboard_oceana.sql`, `friedking_whatsapp_bot.sql`, `friedking_order_notifier.sql` (plus the item-image and branch-rename files). Project ref `alhnmwwbdydcgcgnwhqw`, Pandeshwar branch id `a1b2c3d4-0001-0001-0001-000000000001`.

Key functions (all `security definer`, service role only): `fk_stock_move`, `fk_order_stock` (stock leaves on accept / POS create, returns on cancel), `fk_loyalty_earn` (on delivered), `fk_loyalty_redeem`, bot: `chat_context`, `customer_draft`, `customer_amend`, `customer_confirm`, `customer_cancel`, `open_table_session`, `rider_confirm_payment`, `receipt_order`, notifier: `claim_order_events`, `complete_order_event`, chat: `claim_chat_replies`, `complete_chat_reply`.
Outbox events written: `order_created` (website, POS, bot), `order_status_changed`, `order_amended`, `rider_assigned`, `invoice_requested`, `table_invoice_requested`. `order_created` and `order_status_changed` keep their original fields; extra fields are additive. Tell Maithri before changing any payload.

## 7. Rules and gotchas learned the hard way

- Money is integer paise everywhere; menu prices include 5% GST, which is extracted from the inclusive total. Server is the source of truth for prices.
- Phones are `+91XXXXXXXXXX` in the database; WhatsApp ids are digits.
- `orders.status` enum: `draft` (WhatsApp, unconfirmed), `pending` (= new, awaiting accept), `confirmed` (unused), `preparing`, `ready`, `delivered`, `cancelled`. Dashboard queries filter by the real statuses so they work even before `draft` exists. Drafts must never reach the dashboard.
- Changing a Postgres function's signature: `drop function if exists` the old one first, otherwise PostgREST sees two overloads and fails. `alter type ... add value` and using the new value in the same transaction fails; use plpgsql so function bodies are not checked at creation.
- Vercel must stay in `sin1`; do not remove `vercel.json`.
- Browsers and the dashboard hide nothing sensitive, but the service role key is server-only (`lib/supabase/admin.ts`, API routes).
- WhatsApp: free-form only inside 24 h, everything else needs an approved template. One message per order is a client decision (cost).
- This Windows machine: a dev server may already be running on port 3000 or 3001; Git warns about LF/CRLF (harmless). In n8n Code nodes, newlines inside JS strings must be real backslash-n characters; when scripting edits, build them without relying on shell escaping.
- Test locally without touching production: a throwaway Postgres (PGlite) ran all SQL files successfully; copy that approach for new SQL.

## 8. Open decisions (do not guess, ask Maithri)

- The client's official WhatsApp number is in use for their business, so it cannot be connected to the bot. Options discussed: (1) keep a separate dedicated number for the bot (recommended), (2) link "Order online" to that number from the official one, (3) move the official number (not recommended). Nothing decided yet.
- Delivery rules (fee, minimum, pincodes) per branch.
- Real opening hours per branch.
