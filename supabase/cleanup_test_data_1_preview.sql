-- ============================================================
-- FRIED KING: STEP 1 of 2 - PREVIEW what the test-data cleanup would delete. READ ONLY: this changes nothing.
-- Run in the Supabase SQL Editor and look at the result. Then run cleanup_test_data_2_delete.sql.
--
-- Only the phone numbers in the list below are treated as test data. Everyone else is kept.
-- Edit the list in BOTH files if you want to include more numbers (always the +91 form).
-- ============================================================
with test_phones(phone) as (
  values ('+919035960307'), ('+917795240605'), ('+919852225222'), ('+916363365232'), ('+918861411098')   -- Maithri, Shahil + 3 more (test). Moideen +919180108354 is kept
),
cust as (select id, phone from customers where phone in (select phone from test_phones)),
ords as (select id, order_number, status from orders where customer_id in (select id from cust)),
res(sort, what, how_many) as (
            select 10, 'WILL BE DELETED: orders', count(*) from ords
  union all select 11, '   ...of which still LIVE (pending / preparing / ready): the cleanup refuses to run until these are finished', count(*) from ords where status::text in ('pending', 'confirmed', 'preparing', 'ready')
  union all select 12, 'WILL BE DELETED: order items',       count(*) from order_items where order_id in (select id from ords)
  union all select 13, 'WILL BE DELETED: order events',      count(*) from order_events where order_id in (select id from ords)
  union all select 14, 'WILL BE DELETED: order audit rows',  count(*) from order_audit where order_id in (select id from ords) or order_number in (select order_number from ords)
  union all select 15, 'WILL BE DELETED: customers',         count(*) from cust
  union all select 16, 'WILL BE DELETED: chat messages',     count(*) from chat_messages where phone in (select phone from test_phones)
  union all select 17, 'WILL BE DELETED: chat conversations', count(*) from chat_sessions where phone in (select phone from test_phones)
  union all select 18, 'WILL BE DELETED: table tabs',        count(*) from table_sessions where phone in (select phone from test_phones)
  union all select 19, 'WILL BE DELETED: saved addresses',   count(*) from customer_addresses where phone in (select phone from test_phones)
  union all select 20, 'WILL BE DELETED: website menu links', count(*) from wa_links where phone in (select phone from test_phones)
  union all select 21, 'WILL BE DELETED: loyalty accounts',  count(*) from loyalty_accounts where customer_id in (select id from cust)
  union all select 50, '----- KEPT (not in the test list) -----', null
  union all select 51, 'kept order #' || order_number || ' - ' || status::text || ', Rs ' || (total_paise / 100) || ', ' || to_char(created_at at time zone 'Asia/Kolkata', 'DD Mon HH24:MI'), null
              from orders where customer_id not in (select id from cust)
  union all select 52, 'kept customer: ' || coalesce(name, '(no name)') || ' ' || phone, null from customers where id not in (select id from cust)
  union all select 53, 'kept chat conversation: ' || phone, null from chat_sessions where phone not in (select phone from test_phones)
)
select what, how_many from res order by sort, what;
