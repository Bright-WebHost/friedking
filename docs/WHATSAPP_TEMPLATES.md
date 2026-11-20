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

## 2. `friedking_order_updates` (Active - receipt sent after order creation/acceptance)

| Field | Value |
|---|---|
| Category | **Utility** |
| Status | **Approved** |
| Header | **Image** (PNG receipt dynamically drawn by `/api/receipt?order=<id>`) |
| Body | `Hi {{customer_name}}, your Fried King order #{{order_number}} is {{status}}.\n\nTotal: ₹{{total}}\nBranch: {{branch}}\n\nThank you for ordering with Fried King` |
| Footer | (none) |
| Buttons | (none) |

- **Named parameters:** `customer_name`, `order_number`, `status`, `total`, `branch`.
- **Used by:** n8n `Fried King | Order Events` workflow whenever sending receipts to customers outside the 24-hour WhatsApp messaging window. (Customers inside the 24h window receive the free-form branded receipt image directly).

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

## 5. `friedking_promo_en` / `friedking_offers` (Marketing / Blasts)

| Field | Value |
|---|---|
| Category | **Marketing** |
| Header | **Image** (Upload any promo poster sample) |
| Body | See recommended generic copy below |
| Button | **Call to action (URL)**: Text `Order Now`, URL `https://friedking.vercel.app/` |

> [!TIP]
> **Why Generic Text is Best**: When the template body text is generic and creative, you never have to submit a new template for approval whenever a new offer starts. The specific offer (e.g. *"Buy 1 Get 1 Free on Burgers"*, *"Flat ₹100 Off"*, *"Weekend Broast Special"*) goes directly into the **Header Image**, while the text provides an attractive, evergreen invitation to order!

### Recommended Copy Options for YCloud / Meta Review:

#### Option 1 (Craving-Driven & Warm — Recommended):
```
Craving something hot, fresh, and irresistibly crispy, {{1}}? 🍗✨

We've got an exclusive treat waiting just for you! Check out the delicious offer above, freshly crafted to make your day extra special.

Tap the button below to browse our menu and grab your favourites now!
```
*Sample value:* `{{1}}` = `Maithri`

#### Option 2 (Vibrant & Celebration-Ready):
```
Hey {{1}}! Great moments deserve great food. 🍔🔥

Whether you're treating yourself, hanging out with friends, or having a family feast, we've got an exciting surprise for you in the image above!

Order hot & fresh from Fried King today. Fresh flavours, fast delivery!
```

#### Option 3 (Short & Premium):
```
Hello {{1}}! Freshly fried, packed with flavour, and made just the way you love it. 🍗🍟

Take a look at today's exclusive offer above and treat your tastebuds to something special.

Tap below to order your favourites in a few clicks!
```

---

## After approval

1. In YCloud, check each template shows **Approved**.
2. Tell Claude. Test: OTP from a number that has not messaged in 24 hours; accept an order; close a table; assign a rider.
3. If a template is named differently, change the name in `branch_settings` (`otp_template`) or in the n8n workflow
   `Fried King | Order Events` (Build Message node).

---

## 6. `friedking_shift_report_v2` (daily shift closing report: a receipt-style image, same as Analytics > Shift Close Report)

The report is an IMAGE drawn by the app (`/api/shift-report`). A number that messaged us in the last 24 hours gets it as a normal
image message; everyone else needs this approved template with an image header (staff numbers rarely message the bot first).

| Field | Value |
|---|---|
| Name | `friedking_shift_report_v2` |
| Category | **Utility** |
| Language | English (`en`) |
| Variable type | **Number** ({{1}} to {{12}}) |
| Header | **Media > Image** (upload any sample picture, for example a receipt screenshot; the real report image is attached on every send) |
| Body | see below (keep the line breaks and the *stars*) |
| Buttons / footer | none |

```
📊 *Fried King - Shift report*
*{{1}}*

*{{2}}* {{3}}

*Orders:* *{{4}}*   *Sales:* *{{5}}*

🛵 Delivery: {{6}}
🛍 Takeaway: {{7}}
🍽 Dine-in: {{8}}

From: {{9}}

Cash collected: *{{10}}*
Yet to collect: {{11}}
Cancelled: {{12}}

The full report is in the picture above.
```

Sample values for review: 1 = Fried King Pandeshwar, 2 = 20 Nov FRIDAY, 3 = 02:08 PM to 20 Nov 02:09 PM, 4 = 24, 5 = Rs 18,450,
6 = 10 · Rs 9,000, 7 = 6 · Rs 3,450, 8 = 8 · Rs 6,000, 9 = WhatsApp 12 · Website 6 · POS 6, 10 = Rs 15,000, 11 = Rs 3,450, 12 = 1

Set in Dashboard > Settings > Shift closing report (switch, time in IST, numbers). n8n workflow: `Fried King | Shift Report` (every minute).
Database: `supabase/friedking_shift_report.sql`.
