# n8n change needed BEFORE running `supabase/friedking_branch_order_numbers.sql`

Once every branch counts from FK-1001, two branches can have the same order number. One n8n step looks an order up by
number only, so it would also change the other branch's order. Add the branch to it, in BOTH workflows.

Workflows: `Fried King | Main` (Pandeshwar) and `Fried King Falnir | Main`.
Node: **Enforce Order Type** (HTTP Request, PATCH). Its URL is an expression ending in `.replace(/\D/g, "") }}`.

Add `+ "&branch_id=eq.<BRANCH ID>"` just before the closing `}}`:

| Workflow | BRANCH ID |
|---|---|
| Fried King \| Main (Pandeshwar) | `a1b2c3d4-0001-0001-0001-000000000001` |
| Fried King Falnir \| Main | `b7153019-abf6-478f-b31c-4fbfd1e0ab4a` |

Result for Pandeshwar (one line):

```
={{ "https://alhnmwwbdydcgcgnwhqw.supabase.co/rest/v1/orders?order_number=eq." + String($json.order ? $json.order.order_number : ($json.order_number || "")).replace(/\D/g, "") + "&branch_id=eq.a1b2c3d4-0001-0001-0001-000000000001" }}
```

Save each workflow and keep it active. Nothing else in n8n looks orders up by number (checked: Order Events, Chat Replies,
Shift Report and Send OTP use event ids or branch-scoped database functions; the bot's database functions already filter by branch).
