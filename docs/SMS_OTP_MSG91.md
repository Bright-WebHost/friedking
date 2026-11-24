# OTP by SMS (MSG91) for customers outside the 24-hour WhatsApp window

Why: a customer who comes straight to the website and has not messaged the branch in the last 24 hours can only be sent a
WhatsApp OTP through an approved *Authentication* template. Falnir's WhatsApp account cannot create templates yet, so those
OTPs go by SMS instead. Inside the 24-hour window the OTP still goes as a free WhatsApp text.

Already built (dormant until the template id below is set, so nothing changes today):
- n8n `Fried King <Branch> | Send OTP` (Falnir, Kadri): outside the window it uses the branch setting `sms_template_id`; if that is
  empty it keeps sending the WhatsApp template exactly as before.
- Website: `POST /api/verify/start` passes `smsTemplateId` to n8n and tells the page whether the OTP came by SMS or WhatsApp.
- Pandeshwar's Send OTP is NOT changed yet. Add the same SMS branch there after Falnir works.

## What you need to do (outside the code)

1. **MSG91 account** (msg91.com), add balance.
2. **DLT registration** (required by Indian telecom rules for every SMS, MSG91 guides you through it):
   - Register the business (entity) on a DLT portal of an operator (Jio, Airtel, Vi...). Needs business documents (PAN / GST).
   - Register a **sender ID** (header), 6 letters, for example `FRDKNG`.
   - Register an OTP **content template**. Suggested text (the variable is the OTP):
     `{#var#} is your Fried King verification code. It is valid for 30 minutes. Do not share it with anyone.`
   - Approval usually takes a few days.
3. In MSG91, add the DLT entity id + sender ID + template, and create an **OTP template** (the OTP placeholder is `##OTP##`).
   Copy its **template id**.
4. Copy your MSG91 **auth key** (MSG91 > API / authkey).

## What to give Claude (never paste the key in chat)

- Put the auth key in `.env.local` as a new line: `MSG91_AUTHKEY=your_key_here` (that file is never committed).
- Tell Claude the **template id** (it is not secret).

Claude then: creates the n8n credential `Fried King | MSG91` from `.env.local`, attaches it to the `Send SMS (MSG91)` step in each
Send OTP workflow, sets `branch_settings.sms_template_id` for the branches, and tests one OTP to your own number.

## How it behaves afterwards

| Customer | OTP goes by |
|---|---|
| Messaged the branch in the last 24 h | WhatsApp text (free, instant) |
| Came straight from the website, outside the window | SMS (MSG91) |
| SMS not configured for the branch | WhatsApp template (as before) |

The checkout card also keeps "Verify by WhatsApp message", which needs no template, no SMS and also opens the 24-hour window so the
customer then receives order updates on WhatsApp.

## n8n step details (for maintainers)

`Send SMS (MSG91)` calls `POST https://control.msg91.com/api/v5/otp?template_id=<id>&mobile=91XXXXXXXXXX&otp=<code>&otp_expiry=30&realTimeResponse=1`
with the header `authkey` (credential type "Header Auth", name `authkey`). Success is `{"type":"success"}`; anything else makes the website
say the OTP could not be sent and offer the WhatsApp-message option.
