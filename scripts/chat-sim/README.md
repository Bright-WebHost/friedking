# Chat simulator (run before changing the WhatsApp bot)

Runs the LIVE `Fried King | Main` workflow's Code nodes against the REAL SQL functions in a throwaway Postgres (PGlite),
for whole conversations (takeaway, delivery + address, dine-in, change/cancel, AI failure...). It catches bugs a unit test misses,
for example the orders table rule "a delivery order must have an address".

    npm i --no-save @electric-sql/pglite
    # save the live workflow: GET /api/v1/workflows/bs21eCX2lGfXAeme -> main.json
    node scripts/chat-sim/chatsim.mjs main.json        # end to end
    node scripts/chat-sim/n8n_nodes_test.mjs main.json # node by node

`realschema.mjs` rebuilds the base tables (the v2 schema file is not in the repo) and then loads every SQL file in `supabase/` in order.
