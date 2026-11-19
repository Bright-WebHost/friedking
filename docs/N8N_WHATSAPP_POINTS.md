# Prompt for Antigravity: reward points in the WhatsApp chat order (n8n "Fried King | Main")

Before giving this to Antigravity, run `supabase/friedking_whatsapp_loyalty.sql` in the Supabase SQL Editor
and check that every row in the last result says `true`.

---

You are updating the live n8n workflow "Fried King | Main" (id `bs21eCX2lGfXAeme`) on https://staff.brightmedia.tech
for Fried King, a fried chicken restaurant. This is the WhatsApp ordering bot used by real customers. Be careful.

## Access
- n8n REST API, header `X-N8N-API-KEY`, key = `RASOI_N8N_API_KEY` in `C:\brightmedia\rasoi\.env.local`. Never print it.
- Supabase is called from n8n through the existing credential "Fried King | Supabase (service role)" (type supabaseApi),
  the same way the workflow already calls `customer_draft`, `customer_confirm` and `customer_cancel`
  (POST `https://alhnmwwbdydcgcgnwhqw.supabase.co/rest/v1/rpc/<function>` with a JSON body). Copy how an existing
  RPC node is built (credential, headers, body style) and do not invent a new pattern.
- Read the database side first: `C:\brightmedia\friedking\supabase\friedking_whatsapp_loyalty.sql`.

## Safety rules
1. GET the workflow and save a backup to `C:\brightmedia\friedking\n8n-backups\main-before-points-<date>.json` (that folder is gitignored).
2. Study the existing flow first: the `Route` code node, the node(s) that call `customer_draft` / `customer_amend`, the
   order-summary message with its Confirm / Change / Cancel buttons, and the node that calls `customer_confirm`.
   Write me a short plan (which nodes you add or change, and the new connections) and WAIT for my "yes".
3. Keep every existing behaviour the same for customers with no points. Do not change other routes, credentials, the
   webhook, or the opening-hours logic.
4. Save with PUT `/api/v1/workflows/bs21eCX2lGfXAeme`, sending only `name`, `nodes`, `connections` and `settings`. Keep the workflow active.
5. If anything breaks after saving, restore the backup with PUT and tell me.

## New database functions (already installed)
All take the customer's WhatsApp number as `p_phone` (any format, e.g. "919742175222"), the order number as `p_order`
("FK-1234" or "1234") and `p_branch` (default 'pandeshwar').

1. `customer_points(p_phone, p_order, p_branch)` returns
   `{ result: 'ok'|'not_allowed'|'error', offer: { available, balance, usable_points, usable_value, currency, program, max_pct }, points_used, points_value, order }`
   - `usable_value` is in rupees (whole number). `usable_points` = 0 means they have points but this order is too small to use any.
   - `not_allowed` = dine-in order (table bills do not use points).
2. `customer_use_points(p_phone, p_order, p_use boolean, p_branch)` returns
   `{ result: 'applied'|'removed'|'none'|'locked'|'expired'|'error', points_used, points_value, order }`
   Only works on a draft (before Confirm). Nothing is spent yet; `order.total` is already the reduced total.
3. `customer_confirm(...)` (same call as today) now also returns `points_used`, `points_value`, `points_failed`.
   If `points_failed` is true, the points could not be used (spent meanwhile) and the order was placed at full price.
4. `customer_cancel(...)` (same call as today) now also returns `points_refunded`.

## What the bot must do

### A. After a draft is created or its items are changed (customer_draft result 'created', or customer_amend result 'updated_draft')
Call `customer_points`. Then:
- If `offer.available` is true AND `offer.usable_points > 0` AND `points_used` is 0, send ONE interactive button message
  BEFORE the usual order summary:

  Body:
  🎁 You have {offer.balance} reward points.
  Use {offer.usable_points} points to save ₹{offer.usable_value} on order {order.order_number}?

  Buttons (reply ids must be exactly these):
  - title `Use points`  id `fk_pts_yes:{order.order_number}`
  - title `Not now`     id `fk_pts_no:{order.order_number}`

  Do NOT send the order summary yet. It is sent after the customer answers (step B).
- If `points_used` > 0 (they already chose points and then changed items), skip the question and send the summary
  with the points line (step C).
- Otherwise (no points, too small an order, dine-in, or any error) send the usual summary exactly as today.

### B. Customer taps one of the buttons
In the `Route` node, recognise interactive/button replies whose id matches `^fk_pts_(yes|no):(FK-)?\d+$`
(case-insensitive) and route them to a new branch. Put this check next to the existing button checks, before the AI handling.
Also treat a typed "use points" / "use my points" as yes for the customer's current draft if that is easy with the existing context.
- yes: call `customer_use_points(phone, order, true)`
- no:  call `customer_use_points(phone, order, false)`
- Then send the usual order summary with its Confirm / Change / Cancel buttons, built from the returned `order`
  (its `total` is already after points), plus the points line from step C.
- If the result is `locked` or `expired`, reply with the bot's existing "this order can no longer be changed" /
  "this order expired, please order again" text, whichever the bot already uses.

### C. Points line in the order summary
When `points_used` > 0, the summary shows the items as today and then, just above the total:
  🎁 Reward points ({points_used}): −₹{points_value}
and the total line uses `order.total` (already reduced). Do not change the rest of the summary text.

### D. After Confirm
Keep the existing confirmation message. Additionally:
- If `points_used` > 0, add the line: `🎁 {points_used} reward points used (−₹{points_value})`
- If `points_failed` is true, add: `Your reward points could not be used this time, so the order is at the full price of ₹{order.total}.`

### E. After the customer cancels
If `points_refunded` > 0, add to the existing cancellation reply: `🎁 {points_refunded} reward points are back in your account.`

## Test before you report done (on the bot's own test number, not a real customer)
1. A number with no points: order -> summary appears exactly as before -> Confirm works.
2. Give a test customer points (Dashboard > Loyalty > adjust, or ask me), order enough food -> points question appears -> tap
   `Use points` -> summary shows the points line and the reduced total -> Confirm -> confirmation shows points used ->
   Dashboard > Loyalty shows the points deducted.
3. Repeat, tap `Not now` -> full price.
4. Use points, confirm, then cancel on WhatsApp -> points come back (Dashboard > Loyalty).
5. Check the last executions of the workflow for errors.

## Report back
Backup path, the plan you followed, the list of nodes added/changed, test results, and anything you had to guess.
