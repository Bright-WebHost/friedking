# Moving Kadri to the second Supabase project (friedking-2)

Why: the main project holds Pandeshwar, Falnir and Kadri; friedking-2 holds only Bangalore. Kadri is the only branch not
yet live on WhatsApp (1 test contact, 1 test order), so now is the cheap moment. After the move: main = Pandeshwar + Falnir,
friedking-2 = Bangalore + Kadri.

The app already supports it: `NEXT_PUBLIC_FRIEDKING_KADRI_ON_SECONDARY=true` sends every Kadri request (menu, orders, login,
dashboard, OTP) to the second project. Nothing in the code needs to change. Quotas on the free plan are per ORGANIZATION, so this
splits database load and size, not the log / request quotas.

Do the steps in this order. Kadri keeps working from the main project until step 6.

## 1. Copy Kadri into friedking-2 (SQL, you run it)
1. Supabase > friedking-2 > SQL Editor: run `supabase/friedking_kadri_to_second_project.sql` once.
   It keeps Kadri's branch id and copies the branch, menu, ingredients and recipes, tables, rewards programme and settings.
   It stops with an error and changes nothing if Kadri already exists there.
2. The last query should show kadri: 16 categories, 89 items, 9 tables, 2 ingredients, 26 settings.
3. Run the private file with Kadri's OTP webhook URL (kept OUT of the repo, it contains a secret path), then run the same
   check: `select key from branch_settings where branch_id = '65af2063-7d87-49b6-ac95-67572b964384' and key = 'otp_webhook_url'`.
4. Run on friedking-2 if not yet done: `friedking_promo_stats.sql`, `friedking_day_close.sql` (the customer stats file is done).
   Also Bangalore-style setup that Kadri needs and the main project already had (OTP / verify / bot SQL) is present because
   Bangalore already runs there.

## 2. Create Kadri's logins in friedking-2
Logins live inside each Supabase project, so Kadri's owner must be created again.
1. friedking-2 > Authentication > Users > Add user (email + password, tick auto-confirm).
2. SQL Editor (replace the email):
```sql
insert into public.staff (user_id, branch_id, role, name)
select id, '65af2063-7d87-49b6-ac95-67572b964384', 'owner', 'Kadri Admin' from auth.users where email = 'owner@example.com';
```
3. Later logins (manager, staff) are made from Kadri's Dashboard > Settings > staff logins.

## 3. n8n (staff.brightmedia.tech)
The `Fried King Kadri | ...` workflows (Main, Order Events, Send OTP, Chat Replies, Shift Report, Blast Sender) point at the main
project. In each: change the Supabase credential from `Fried King | Supabase (service role)` to
`Fried King Bangalore - Supabase` (friedking-2) and the project host in every database URL. Keep Kadri's own sender number,
`p_branch` = `kadri`, webhook paths and YCloud credential.

## 4. Vercel
Add `NEXT_PUBLIC_FRIEDKING_KADRI_ON_SECONDARY=true` (Production), then redeploy. Optional: `KADRI_CUSTOMER_SESSION_SECRET`
(without it a key derived from the second project's service key is used, like Bangalore) and `KADRI_RIDER_CALLBACK_SECRET`
if Kadri riders use the payment button.

## 5. Test (Kadri now reads friedking-2)
- `friedking.vercel.app/kadri` shows the menu; place a test order and check it in friedking-2 `orders` / `order_events`.
- `/dashboard/login?branch=kadri` signs in with the new owner and shows the order.
- Send a verification (OTP or "Verify on WhatsApp") once the YCloud webhook is connected.

## 6. Clean up the main project (after a few days of use)
Kadri's rows in the main project become unused. Delete them with the cleanup approach used for test data, never before the
test in step 5 has passed. Menu images keep their links to the main project's storage, so do not delete that bucket.
