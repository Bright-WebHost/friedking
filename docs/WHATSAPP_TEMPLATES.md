# WhatsApp templates for Fried King

Create these in YCloud (WhatsApp > Message templates > New) or Meta WhatsApp Manager. The names must match exactly,
because the n8n workflows and the website use these names. Language for all: **English** (`en`).

Templates are only needed when the customer has NOT messaged us in the last 24 hours. Inside the 24-hour window we send normal free messages.

> Blocker seen on 2026-11-16: YCloud showed "This WhatsApp business account does not have permission to create message template",
> and Meta showed the WhatsApp account as **Unverified** (quality rating and messaging limits "Unavailable").
> Fix that first (phone number verification, then Meta business verification). Then create the templates below.

Already approved: `friedking_order_updates` (utility, named variables; replaces the old `friedking_order_update` which was marketing category). Not used yet.

---

## 1. `friedking_otp` (most important: website OTP)

| Field | Value |
|---|---|
| Category | **Authentication** |
| Code delivery | **Copy code** (NOT Autofill, which is for Android apps) |
| Add security recommendation | On |
| Add expiration time for the code | Optional. If on, choose 30 minutes (the OTP on the website lasts 30 minutes) |
| Message validity period | On, 10 minutes |

The text is fixed by WhatsApp ("{{1}} is your verification code. For your security, do not share this code.").
The website and n8n send the 6-digit code as both the body variable and the button value. Nothing else to configure.

Used by: n8n `Fried King | Send OTP`. Name is stored in `branch_settings.otp_template` (default `friedking_otp`).

---

## 2. `friedking_order_receipt` (receipt after staff accept an order)

| Field | Value |
|---|---|
| Category | **Utility** |
| Header | **Image** (upload any sample receipt picture as the example) |
| Body | `Hi {{1}}, your Fried King order {{2}} has been accepted. Your receipt is attached. Total: {{3}}. Thank you for ordering with us!` |
| Footer | (none) |
| Buttons | (none) |

Sample values for review: `{{1}}` = Maithri, `{{2}}` = FK-1021, `{{3}}` = Rs 487.20

Variables are sent in this order: first name, order number (FK-...), total with currency.
The header image is the receipt drawn by the app (`/api/receipt?order=<id>`).

---

## 3. `friedking_table_bill` (bill when a dine-in table is closed)

| Field | Value |
|---|---|
| Category | **Utility** |
| Header | **Image** |
| Body | `Hi {{1}}, thank you for dining with us at Fried King! Your bill for table {{2}} (total {{3}}) is attached.` |
| Buttons | (none) |

Sample values: `{{1}}` = Maithri, `{{2}}` = 4, `{{3}}` = Rs 1,240.00

---

## 4. `friedking_rider_msg` (delivery details to the rider, with a "Payment collected" button)

| Field | Value |
|---|---|
| Category | **Utility** |
| Header | (none) |
| Body | `New delivery {{1}}. Customer: {{2}}, phone {{3}}. Address: {{4}}. Items: {{5}}. Collect cash: Rs {{6}}. Tap the button below after you collect the payment.` |
| Button | **Quick reply**, text exactly `Payment collected` |

Sample values: `{{1}}` = FK-1021, `{{2}}` = Maithri, `{{3}}` = 9035960307, `{{4}}` = Pandeshwar, Mangaluru - 575001,
`{{5}}` = Lunch Meal x1, King's Double Decker Burger x4, `{{6}}` = 1553

Riders always get this template (they rarely message the number first). The button tap is read by n8n as the text
`Payment collected` and runs `rider_confirm_payment`. Do not change the button text.

---

## 5. Optional later: `friedking_promo_en` (Blast / offers)

Category **Marketing**, body e.g. `Hi {{1}}, {{2}} Order now: https://friedking.vercel.app/`. Marketing messages cost more
and customers must have agreed to receive them. Create it only when the Blast page is ready to use.

---

## After approval

1. In YCloud, check each template shows **Approved**.
2. Tell Claude. Test: OTP from a number that has not messaged in 24 hours; accept an order; close a table; assign a rider.
3. If a template is named differently, change the name in `branch_settings` (`otp_template`) or in the n8n workflow
   `Fried King | Order Events` (Build Message node).
