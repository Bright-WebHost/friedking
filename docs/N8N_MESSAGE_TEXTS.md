# WhatsApp message texts (n8n `Fried King | Order Events`)

These texts are built inside the live n8n workflow (node **Build Message**, id `ppgSbbKzkPUQBdgF`), not in the Next.js app.
The app only sends the data (rider name and phone, order number, amount). Change 2026-11-19: final wording below.

## 1. Customer, rider assigned (`customer_rider_assigned`, inside the 24 h window)

```
🛵 Your order FK-1127 is on the way!
Delivery partner: rasoi (+919180348124)
```

Nothing else: no estimated time, no extra lines. In `Build Message`, the branch for `etype === 'customer_rider_assigned'` should end with:

```js
m.text = '🛵 Your order ' + num + ' is on the way!\nDelivery partner: ' + clean(e.rider_name || '') + ' (' + '+' + wa(e.rider_phone || '') + ')';
```

`wa()` returns digits with country code (919180348124), so the phone prints as `+919180348124`, no spaces.

## 2. Customer, delivered (`customerNotification.kind = 'thank_you'`)

```
Thank you for choosing Fried King!
```

In the `thank_you` branch: `m.text = 'Thank you for choosing Fried King!';` (remove any order number, rating link or "see you again" line).

## 3. Rider, new delivery (`rider_assigned`)

Rider sees this exact layout (bold = WhatsApp `*bold*`):

```
*New delivery FK-1125*.

Customer: *TEST QA W08,*
Phone +91 77952 40605.

Address: Janapriya complex, ..., Mangaluru - 575001.

Items: 2 x Breakfast Meal.

*Collect cash: Rs 676.*

Tap the button below after you collect the payment.
```

* Inside the rider's 24 h window it is sent as an interactive message (`m.text` + "Payment collected" button). `scripts/prepare-rider-workflows.cjs` now builds `m.text` in this layout. Re-run it against a fresh export of the workflow, or paste the same `heading` / `ending` lines into `Build Message`.
* Outside the window WhatsApp only allows an approved template, and an approved template cannot be edited freely. To get the identical layout there, submit a new **Utility** template (suggested name `friedking_rider_msg_v2`, quick-reply button `Payment collected`) with this body, then point `m.template` at it:

```
*New delivery {{1}}*.

Customer: *{{2}},*
Phone {{3}}.

Address: {{4}}.

Items: {{5}}.

*Collect cash: Rs {{6}}.*

Tap the button below after you collect the payment.
```

  Params in order: order number (FK-1125), customer name, customer phone (+91 77952 40605), address, items (`2 x Breakfast Meal`), cash amount (676). Until it is approved, the old `friedking_rider_msg` keeps working.
