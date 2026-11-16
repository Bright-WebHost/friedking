# Copilot instructions for Fried King

Read `docs/HANDOFF.md` first (status, what is done, what remains, what Maithri still has to do, n8n and database notes), then `CLAUDE.md` for the project rules. `docs/DASHBOARD_PLAN.md` is the dashboard feature checklist.

Essentials:
- Next.js 16: read `node_modules/next/dist/docs/` before using an API. Do not downgrade Next.js.
- Money is integer paise. The server is the source of truth for prices. Never expose the Supabase service role key to the browser.
- Ask before changing the schema or the `order_events` payload; give SQL as a separate file in `supabase/` for Maithri to run in the Supabase SQL Editor.
- Vercel must stay pinned to the Singapore region (`vercel.json`).
- The old Oceana-copy n8n workflows are inactive on purpose: do not switch them on. Editing a live n8n workflow via the API can switch it off: always re-check `active`.
- Customers get ONE WhatsApp message per order (the receipt). Do not add status messages without asking.
