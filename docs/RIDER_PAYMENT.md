# Rider delivery and payment integration

## App endpoint

`POST /api/rider/payment` uses the existing server-side `SUPABASE_SERVICE_ROLE_KEY` as a Bearer token. The n8n HTTP node uses the dedicated **Fried King | Rider Payment Callback** `httpHeaderAuth` credential (ID `ctAJt7bgOzseT8lV`), with header `Authorization: Bearer <server key>` and its allowed domain restricted to `friedking.vercel.app`. The Supabase credential is restricted to the Supabase host and cannot call this endpoint. No new app environment variable or database migration is needed.

The request contains `branchSlug`, `riderPhone`, and `orderId`. Older buttons can supply `messageId` instead of `orderId`. The server normalizes the sender's phone, resolves the branch and rider, and requires the delivery to remain assigned to that rider. The update also checks the rider during the status write to cover reassignment races.

The endpoint uses the dashboard's existing Done action: it records cash, marks the order delivered (displayed as Done), earns loyalty points, writes an audit entry, and queues the existing customer thank-you event. The customer message follows the existing 24-hour WhatsApp window policy. Repeated taps return `already` and do not repeat completion events. Cancelled and unrelated deliveries are rejected.

## n8n changes and release order

The release deploys the app endpoint first, then publishes these workflow updates in order:

1. Main (`bs21eCX2lGfXAeme`): route interactive and template replies with `fk_paid:<order UUID>` before takeover/opening-hour checks; call the app endpoint with the app-scoped credential; retain legacy message-context matching; terminate without replying to the rider. Bare typed `Payment collected` acknowledgements go to the existing Ignore stop node. Status callbacks also replace stored YCloud IDs with WhatsApp WAMIDs when available.
2. Order Events (`ppgSbbKzkPUQBdgF`): send a clearly labelled rider message with customer phone, address, order total and cash to collect. Inside the rider's 24-hour window, use an interactive button. Otherwise retain the approved six-parameter `friedking_rider_msg` template and attach the same order UUID as its quick-reply payload. Rider sends use YCloud's synchronous endpoint so the WhatsApp message ID can be saved. Customer rider-assignment messages use the scooter emoji.

Main can handle existing dispatch messages while Order Events is being published. Keep the previous exports for rollback. Preserve the existing receipt suppression for later table rounds.

`scripts/prepare-rider-workflows.cjs` reproduces the reviewed changes from fresh n8n API exports named `<workflow ID>-before.json`. It verifies the expected source before changing it, checks code-node syntax, and writes `<workflow ID>-after.json` exports. It does not call n8n or publish anything:

```powershell
node scripts/prepare-rider-workflows.cjs <export-directory> <output-directory> <callback-credential-id>
```

If the live workflows change before release, re-export and review the result instead of importing an old snapshot. Credentials remain references to the existing n8n credentials.

## Verification on 17 November 2026

- Production build and TypeScript checks passed.
- Isolated tests exercised the real payment helper and API with a mocked database: valid payment, repeat taps, simultaneous taps, wrong rider, reassignment, cancelled order, legacy WAMID, old cash-only completion, malformed JSON and authorization.
- Workflow code tests covered formatted numbers and amounts, actual line breaks, long item lists, both button types, early routing, customer thank-you, and table receipt suppression.
- Chromium checks covered the customer confirmation, Settings saves without the promotion cap, POS printing/failure recovery, and table completion on desktop/mobile.
- Actual receipt PNGs were rendered and visually checked at phone width and with long names/notes.

These checks do not send real customer messages or modify live orders. After publishing the app and workflows, verify one agreed test delivery on a rider's phone to confirm provider delivery and the resulting customer message.

## Published release

App commit `455cd0c` was pushed to `main` and verified live on 17 November 2026. The live payment endpoint returned 401 without authentication, 400 for an authenticated invalid request, and `not_found` for a nonexistent delivery. The deployed homepage bundle contains `Order placed`; the promotions API and active banner image returned HTTP 200.

Both workflow updates were published around 10:32 UTC and verified active with `activeVersionId` equal to `versionId`. Main's published version is `5532706a-01ac-4678-9844-98ade0cecbaf`; Order Events' version is `8a6c0b40-8269-4d1f-825d-b799352bf647`.

Existing dispatch references for orders 1060, 1059, and 1047 were repaired using exact YCloud-ID/WAMID pairs found in recorded provider status callbacks. Only `rider_wa_message_id` was updated, with a comparison against the previous value. No order was marked paid or completed by this repair.

## Callback credential correction and silent rider acknowledgements

Recorded Main executions `72404` and `72721` showed the exact failure: the reused Supabase credential blocked `friedking.vercel.app` because its allowed domain was only the Supabase host. Earlier direct app API checks did not exercise that n8n restriction.

The corrected Main version `cadc3e92-e8d2-4306-a867-7dfb3c9f2946` was published and verified active on 17 November 2026. The payment node now uses the dedicated callback credential, has a 30-second timeout, retries failed HTTP requests up to three times, and stops with an execution error if they still fail. It has no outgoing connection to a send node. `Build Rider Payment Reply` was removed entirely, so success, repeat taps, and failures cannot produce rider replies from this path.

`scripts/rider-payment-workflow.cjs` applies this focused correction to a fresh Main export and verifies the expected endpoint and routing marker. It is also used by the original workflow preparation script:

```powershell
node scripts/rider-payment-workflow.cjs <before.json> <after.json> <callback-credential-id>
```

Verification used a temporary authenticated n8n workflow with the exact payment HTTP node and credential. An unauthenticated test was rejected; an authenticated nonexistent delivery reached the live app and returned `not_found`. The recorded payment tap for order 1073 then returned `collected` and recorded cash; a repeat returned `already`. Staff had already marked that order Done and its one customer thank-you event was processed, so the replay produced no duplicate notification. The temporary verification workflow and webhook were deactivated and deleted afterward.

The real app payment helper tests also passed for Ready to Done, cash recording, one customer thank-you event, repeated/concurrent taps, wrong riders, cancelled orders, reassignment, legacy message IDs, authorization, and request validation. Workflow checks cover button/interactive/legacy routing, silent typed acknowledgements, and the absence of a rider send path.
