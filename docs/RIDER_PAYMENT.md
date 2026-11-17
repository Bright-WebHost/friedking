# Rider delivery and payment integration

## App endpoint

`POST /api/rider/payment` uses the existing server-side `SUPABASE_SERVICE_ROLE_KEY` as a Bearer token. The n8n HTTP node uses its existing Fried King Supabase credential, which supplies this header. No new environment variable or database migration is needed.

The request contains `branchSlug`, `riderPhone`, and `orderId`. Older buttons can supply `messageId` instead of `orderId`. The server normalizes the sender's phone, resolves the branch and rider, and requires the delivery to remain assigned to that rider. The update also checks the rider during the status write to cover reassignment races.

The endpoint uses the dashboard's existing Done action: it records cash, marks the order delivered (displayed as Done), earns loyalty points, writes an audit entry, and queues the existing customer thank-you event. The customer message follows the existing 24-hour WhatsApp window policy. Repeated taps return `already` and do not repeat completion events. Cancelled and unrelated deliveries are rejected.

## n8n changes and release order

Two workflow updates are prepared, but must be published after the new app endpoint is deployed:

1. Main (`bs21eCX2lGfXAeme`): route interactive and template replies with `fk_paid:<order UUID>` before takeover/opening-hour checks; call the app endpoint; retain legacy message-context matching; correct the rider reply. Status callbacks also replace stored YCloud IDs with WhatsApp WAMIDs when available.
2. Order Events (`ppgSbbKzkPUQBdgF`): send a clearly labelled rider message with customer phone, address, order total and cash to collect. Inside the rider's 24-hour window, use an interactive button. Otherwise retain the approved six-parameter `friedking_rider_msg` template and attach the same order UUID as its quick-reply payload. Rider sends use YCloud's synchronous endpoint so the WhatsApp message ID can be saved. Customer rider-assignment messages use the scooter emoji.

Main can handle existing dispatch messages while Order Events is being published. Keep the previous exports for rollback. Preserve the existing receipt suppression for later table rounds.

`scripts/prepare-rider-workflows.cjs` reproduces the reviewed changes from fresh n8n API exports named `<workflow ID>-before.json`. It verifies the expected source before changing it, checks code-node syntax, and writes `<workflow ID>-after.json` exports. It does not call n8n or publish anything:

```powershell
node scripts/prepare-rider-workflows.cjs <export-directory> <output-directory>
```

If the live workflows change before release, re-export and review the result instead of importing an old snapshot. Credentials remain references to the existing n8n credentials.

## Verification on 17 November 2026

- Production build and TypeScript checks passed.
- Isolated tests exercised the real payment helper and API with a mocked database: valid payment, repeat taps, simultaneous taps, wrong rider, reassignment, cancelled order, legacy WAMID, old cash-only completion, malformed JSON and authorization.
- Workflow code tests covered formatted numbers and amounts, actual line breaks, long item lists, both button types, early routing, customer thank-you, and table receipt suppression.
- Chromium checks covered the customer confirmation, Settings saves without the promotion cap, POS printing/failure recovery, and table completion on desktop/mobile.
- Actual receipt PNGs were rendered and visually checked at phone width and with long names/notes.

These checks do not send real customer messages or modify live orders. After publishing the app and workflows, verify one agreed test delivery on a rider's phone to confirm provider delivery and the resulting customer message.
