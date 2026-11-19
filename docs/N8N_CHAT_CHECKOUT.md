# Prompt for Antigravity: fix the WhatsApp chat checkout (n8n "Fried King | Main")

Before giving this to Antigravity, run `supabase/friedking_whatsapp_checkout.sql` in the Supabase SQL Editor
(after `friedking_whatsapp_loyalty.sql`) and check that every row in the last result says `true`.

---

You are fixing the live n8n workflow "Fried King | Main" (id `bs21eCX2lGfXAeme`) on https://staff.brightmedia.tech.
It is the WhatsApp ordering bot for Fried King and real customers use it. Your previous change (reward points)
made the chat order flow worse. This task replaces that flow with a simpler one where the database does the logic.

## Access and safety
- n8n REST API, header `X-N8N-API-KEY`, key = `RASOI_N8N_API_KEY` in `C:\brightmedia\rasoi\.env.local`. Never print it.
- Backup first: GET the workflow and save it to `C:\brightmedia\friedking\n8n-backups\main-before-checkout-<date>.json`.
- Supabase RPCs are called like the existing ones (credential "Fried King | Supabase (service role)").
- Read `C:\brightmedia\friedking\supabase\friedking_whatsapp_checkout.sql` and `friedking_whatsapp_loyalty.sql` first.
- Show me a plan (nodes added / changed / removed, new connections), WAIT for my "yes", then show the diff, save with
  PUT (only `name`, `nodes`, `connections` and `settings`), and confirm the workflow is still active. If something breaks, restore the backup.

## What went wrong in the last test (real chat, order FK-1133)
1. "Add 3 kings veg sandwich" and "Can u remove mint mojito" only got the points question back. The customer never saw the updated cart.
2. Tapping "Use points" sent a summary with order "fk-1133" in lower case, NO items, "Total Rs 0", a wrong
   "add Rs 200 more for delivery" line, and it went to a malformed phone number ("+91…+91"), so WhatsApp did not deliver it.
3. Typing "Confirm" placed the order but the bot sent nothing back.
4. "I want to order 2 cheese balls and 1 mint mojito" after FK-1133 was placed CHANGED the placed order straight away
   ("Updated! ... The kitchen has the new list") with a wrong "*FRIED KING - ORDER CONFIRMED*" header, without asking the customer.
5. Bot loop: rider "rasoi" (+919180348124) is another WhatsApp bot. It answered our rider messages with blank messages,
   our AI answered every blank, and the two bots talked to each other ~170 times in 3 hours. (AI is switched off for that
   chat for now in chat_sessions; do not switch it back on.)

## The flow the owner wants
1. Customer adds or removes items (new draft, or a change to their draft) -> ALWAYS show the current cart:
   the existing "*Please confirm your order*" summary with [Confirm | Modify | Cancel]. Never the points question here.
2. Customer taps Confirm (button `btn_confirm:FK-x`, or types confirm / yes / place order / ok while a draft is open)
   -> call `customer_checkout(p_phone, p_order, 'confirm')`.
3. If the result is `ask_points` -> send the points question:
     🎁 You have {offer.balance} reward points.
     Use {offer.usable_points} points to save ₹{offer.usable_value} on order {order.order_number}?
   buttons `Use points` (id `fk_pts_yes:FK-x`) and `Not now` (id `fk_pts_no:FK-x`).
4. `Use points` -> `customer_checkout(..., 'use_points')`. Result `final` -> send the FINAL summary: the same cart summary
   text, plus the line `🎁 Reward points ({points_used}): −₹{points_value}` just above the total, total = `order.total`,
   last line "Tap *Place order* to send it to the kitchen.", buttons `Place order` (id `btn_place:FK-x`),
   `Modify` (`btn_modify:FK-x`), `Cancel` (`btn_cancel:FK-x`).
   `Not now` -> `customer_checkout(..., 'skip_points')` -> the order is placed.
5. `Place order` -> `customer_checkout(..., 'place')` -> the order is placed.
6. Whenever the result is `confirmed` (from any step), send the placed message (this replaces the silence after Confirm
   and the "Points Involved?" branch you added):
     ✅ Order {order.order_number} placed! Total ₹{order.total}.
     🎁 {points_used} reward points used (−₹{points_value}).              <- only if points_used > 0
     Your reward points could not be used this time, so the order is at the full price.   <- only if points_failed
     We will message you as soon as the restaurant accepts it.
7. Other results from `customer_checkout`: `already` (order already placed), `expired`, `cancelled`, `in_progress`, `error`
   -> reuse the texts the bot already has for these from the old Confirm path ("Build Confirm Failed" etc.).
8. Modify after choosing points works as today (the draft keeps the points, re-capped). The next Confirm places the
   order directly (customer_checkout handles that).

## Rules for building it
- ONE new RPC node "Checkout" that calls `customer_checkout` with `{ p_phone, p_order, p_action }`, used by btn_confirm,
  typed confirm, fk_pts_yes, fk_pts_no and btn_place. Remove the Check Customer Points / Has Usable Points? / Apply Points
  nodes and the old direct `customer_confirm` call from the button path (keep nodes only if something else uses them).
- `p_phone` and the WhatsApp recipient are ALWAYS the customer's number from "Extract Input" (digits with country code,
  e.g. 919035960307). Never take the recipient from an RPC result. Never build it by string concatenation that can double the "+91".
- The order number shown to the customer and put in button ids is ALWAYS `order.order_number` from the RPC result
  ("FK-1133", upper case).
- The cart summary is built from the `order` object the RPC returns (`order.items_json`, `order.total`, `order.order_type`),
  the same way for every path, so there is one summary builder and it never shows an empty cart.
- Keep the delivery-minimum warning, but only when `order.order_type` is delivery and the real food total is below the minimum.
- Changes to a PLACED order (status new / not yet accepted) must use `customer_amend_stage` -> show the staged list with
  Confirm / Keep buttons -> `customer_amend_confirm` or `customer_amend_discard` (already installed, see
  friedking_whatsapp_amend_confirm.sql). Find the path that called `customer_amend` directly for FK-1133 and route it
  through the stage step. Never say "The kitchen has the new list" before the customer confirmed. Remove the
  "*FRIED KING - ORDER CONFIRMED*" header from that reply.

## Loop guard (do this first, it is the most urgent)
- In `Route` (or right after `Extract Input`): if the inbound message has no text AND is not a button / interactive reply /
  voice note / image / location, stop: no reply, no AI call.
- Keep the rider "Payment collected" / `fk_paid:` handling exactly where it is (before any guard).
- Before any greeting or AI reply, call `bot_guard(p_phone)`. If `reply` is false, send nothing.
  (It returns false for rider numbers and for a number that already got 8+ bot replies in 3 minutes.)

## Test on the test number (not a real customer) and report
1. "I want 2 cheese balls" -> cart shown -> "add 1 mint mojito" -> updated cart shown -> "remove cheese balls" -> updated cart.
2. Confirm with a customer who has NO points -> placed message straight away.
3. Confirm with points -> points question -> Use points -> final summary with points line and correct items/total ->
   Place order -> placed message -> Dashboard > Loyalty shows the points taken.
4. Same, but Not now -> placed at full price.
5. Use points, then Modify and add an item -> cart shows the points line -> Confirm -> placed directly.
6. After an order is placed, "add 1 mint mojito" -> staged change with Confirm / Keep, nothing changes until Confirm.
7. Send an empty message / sticker -> no reply.
8. Check the last executions for errors.

Report: backup path, plan, nodes added/changed/removed, test results, and anything you had to guess.
