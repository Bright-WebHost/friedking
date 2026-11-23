# Adding a new branch (what was done for Falnir)

One codebase, one Supabase project, one Vercel site. A branch is a row plus its own WhatsApp number and n8n workflow copies.

## 1. Supabase
1. Edit the five values at the top of `supabase/friedking_new_branch_template.sql` and run it once in the SQL Editor.
   It copies menu, prices, delivery settings, tables, loyalty programme, ingredients and recipes.
2. Check the two count rows it prints match the source branch.

## 2. Website
Nothing to deploy. The branch picker lists every active branch and `friedking.vercel.app/<slug>` opens it.
Old links without a branch (`?t=`, `?ph=`, `?table=`) still open Pandeshwar.

## 3. Dashboard (as the all-branch owner, then hand over)
- Settings > staff logins: create the branch's owner / manager / staff. Logins made here belong to that branch only (owners too).
  All-branch (global) owners exist only in Supabase (`staff.branch_id` null); branch Settings cannot edit them.
- Set pincodes, GSTIN, address and phone, opening hours, offers, riders, stock take, shift report recipients and time.

## 4. n8n (staff.brightmedia.tech) - never commit exports or webhook URLs, they contain secret paths
Copy these workflows, named `Fried King <Branch> | ...`, inactive until YCloud is ready:
`Main`, `Order Events`, `Chat Replies`, `Shift Report`, `Send OTP`.
Change in each copy: sender number, `p_branch` slug, the Pandeshwar branch id (Main), a new webhook path (Main, Send OTP),
and `p_branch` on every database call in Main (see how `Fried King Falnir | Main` was done).
Then set the branch setting `otp_webhook_url` to the new Send OTP webhook URL (Supabase `branch_settings`).
`Dashboard AI` is shared. `Blast Sender` is NOT branch-aware (sends from Pandeshwar's number); do not blast from other branches.

## 5. YCloud and WhatsApp
Point the branch number's webhook at the Main copy's webhook, get templates approved on that number
(OTP, rider message, shift report), activate the copies, then test one order, one OTP and one chat reply.
Print table QR codes (Dashboard > Tables > QR) only after the number is live.
