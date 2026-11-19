-- ============================================================
-- FRIED KING: CLEANUP TEST DATA FOR PRODUCTION HANDOVER
-- Run this in the Supabase SQL Editor BEFORE handing over to the client.
--
-- WHAT THIS CLEARS (Transactional & Test Data):
--   - All test orders, order items, events, and audits
--   - All test customers, addresses, and OTP verifications
--   - All test loyalty transactions & customer balances
--   - All test chat messages and sessions
--   - All test stock movements & table sessions
--   - Resets order counter to restart at FK-1001
--
-- WHAT THIS PRESERVES (Configuration & Master Data):
--   ✅ Menu categories & items (all dishes & prices)
--   ✅ Restaurant settings & branches (hours, address, phone)
--   ✅ Tables & QR codes (restaurant_tables)
--   ✅ Loyalty program rules (Fried King Rewards, 50% max)
--   ✅ Staff & Rider accounts (admin logins & delivery riders)
--   ✅ Inventory items & recipes
--   ✅ Delivery pincodes
-- ============================================================

begin;

-- 1. Truncate orders and all related order tables
truncate table public.order_items cascade;
truncate table public.order_events cascade;
truncate table public.order_audit cascade;
truncate table public.wa_pending_amend cascade;
truncate table public.rider_payments cascade;
truncate table public.stock_movements cascade;
truncate table public.orders cascade;

-- 2. Truncate test chats and outbound queues
truncate table public.chat_messages cascade;
truncate table public.chat_sessions cascade;
truncate table public.outbound_messages cascade;

-- 3. Truncate test customer accounts & loyalty ledgers
truncate table public.loyalty_transactions cascade;
truncate table public.loyalty_accounts cascade;
truncate table public.customer_addresses cascade;
truncate table public.wa_verifications cascade;
truncate table public.otp_verifications cascade;
truncate table public.wa_links cascade;
truncate table public.table_sessions cascade;
truncate table public.broadcast_campaigns cascade;
truncate table public.expenses cascade;
truncate table public.customers cascade;

-- 4. Reset Order Number sequence to 1001 (First real order will be FK-1001)
alter table public.orders alter column order_number restart with 1001;

commit;

-- 5. Notify PostgREST to refresh schema cache
NOTIFY pgrst, 'reload schema';

-- Verification check: everything should report 0 rows
select 
  (select count(*) from orders) as remaining_orders,
  (select count(*) from customers) as remaining_customers,
  (select count(*) from chat_messages) as remaining_chat_messages,
  (select count(*) from menu_items) as preserved_menu_items,
  (select count(*) from restaurant_tables) as preserved_tables,
  (select count(*) from loyalty_programs) as preserved_loyalty_programs;
