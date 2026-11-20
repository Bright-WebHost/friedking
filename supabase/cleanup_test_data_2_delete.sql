-- ============================================================
-- FRIED KING: STEP 2 of 2 - delete the TEST data only. Run cleanup_test_data_1_preview.sql first and check its list.
--
-- Safety built in:
--   * Only the phone numbers in the list below are touched. Real customers, their orders and chats stay.
--   * A copy of every row it deletes is saved first, in the schema  cleanup_backup_20261120  (see "UNDO" at the bottom).
--   * It REFUSES to run (nothing changes) if any of the test orders is still live in the kitchen (pending / preparing / ready).
--   * The whole job is ONE statement (a single DO block), so it is all-or-nothing in any SQL editor: if any step fails, nothing is deleted.
--   * Menu, prices, branches, settings, tables, riders, staff, stock, recipes, promotions, loyalty rules, pincodes are never touched.
--   * Order numbers: by default the counter restarts after the highest order that is KEPT (first new order = that + 1, or FK-1001 if
--     none are kept), so the numbering looks fresh. To keep counting instead (which also keeps the UNDO below possible forever),
--     change  v_restart  to  false  below.
--   * Safe to run again: with nothing left to delete it changes nothing.
--
-- Edit the phone list here AND in the preview file if you change it.
-- ============================================================
do $$
declare
  v_phones  text[]  := array[
    '+919035960307'                  -- Maithri (your test number)
    -- , '+917795240605'             -- Shahil (uncomment if his chats are test data)
  ];
  v_restart boolean := true;         -- RESTART NUMBERING: true = start again after the last kept order, false = keep counting
  v_cust    uuid[];
  v_ord     uuid[];
  v_nums    bigint[];
  v_live    int;
begin
  select coalesce(array_agg(id), '{}') into v_cust from public.customers where phone = any (v_phones);
  select coalesce(array_agg(id), '{}'), coalesce(array_agg(order_number), '{}') into v_ord, v_nums
    from public.orders where customer_id = any (v_cust);

  -- STOP if a test order is still being worked on
  select count(*) into v_live from public.orders where id = any (v_ord) and status::text in ('pending', 'confirmed', 'preparing', 'ready');
  if v_live > 0 then
    raise exception 'STOPPED, nothing was deleted: % test order(s) are still live (pending / preparing / ready). Finish or cancel them in the dashboard, then run this again.', v_live;
  end if;

  -- 1) safety copy of exactly what will be deleted
  create schema if not exists cleanup_backup_20261120;
  create table if not exists cleanup_backup_20261120.orders             (like public.orders);
  create table if not exists cleanup_backup_20261120.order_items        (like public.order_items);
  create table if not exists cleanup_backup_20261120.order_events       (like public.order_events);
  create table if not exists cleanup_backup_20261120.order_audit        (like public.order_audit);
  create table if not exists cleanup_backup_20261120.stock_movements    (like public.stock_movements);
  create table if not exists cleanup_backup_20261120.customers          (like public.customers);
  create table if not exists cleanup_backup_20261120.chat_messages      (like public.chat_messages);
  create table if not exists cleanup_backup_20261120.chat_sessions      (like public.chat_sessions);
  create table if not exists cleanup_backup_20261120.table_sessions     (like public.table_sessions);
  create table if not exists cleanup_backup_20261120.customer_addresses (like public.customer_addresses);
  create table if not exists cleanup_backup_20261120.wa_links           (like public.wa_links);
  create table if not exists cleanup_backup_20261120.loyalty_accounts   (like public.loyalty_accounts);
  create table if not exists cleanup_backup_20261120.loyalty_transactions (like public.loyalty_transactions);

  insert into cleanup_backup_20261120.orders            select * from public.orders            where id = any (v_ord);
  insert into cleanup_backup_20261120.order_items       select * from public.order_items       where order_id = any (v_ord);
  insert into cleanup_backup_20261120.order_events      select * from public.order_events      where order_id = any (v_ord);
  insert into cleanup_backup_20261120.order_audit       select * from public.order_audit       where order_id = any (v_ord) or order_number = any (v_nums);
  insert into cleanup_backup_20261120.stock_movements   select * from public.stock_movements   where order_id = any (v_ord);
  insert into cleanup_backup_20261120.customers         select * from public.customers         where id = any (v_cust);
  insert into cleanup_backup_20261120.chat_messages     select * from public.chat_messages     where phone = any (v_phones);
  insert into cleanup_backup_20261120.chat_sessions     select * from public.chat_sessions     where phone = any (v_phones);
  insert into cleanup_backup_20261120.table_sessions    select * from public.table_sessions    where phone = any (v_phones);
  insert into cleanup_backup_20261120.customer_addresses select * from public.customer_addresses where phone = any (v_phones);
  insert into cleanup_backup_20261120.wa_links          select * from public.wa_links          where phone = any (v_phones);
  insert into cleanup_backup_20261120.loyalty_accounts  select * from public.loyalty_accounts  where customer_id = any (v_cust);
  insert into cleanup_backup_20261120.loyalty_transactions select * from public.loyalty_transactions
    where account_id in (select id from public.loyalty_accounts where customer_id = any (v_cust)) or order_id = any (v_ord);

  -- 2) delete the test data (children first)
  delete from public.order_events      where order_id = any (v_ord);
  delete from public.order_audit       where order_id = any (v_ord) or order_number = any (v_nums);
  delete from public.stock_movements   where order_id = any (v_ord);
  delete from public.loyalty_transactions
    where account_id in (select id from public.loyalty_accounts where customer_id = any (v_cust)) or order_id = any (v_ord);
  delete from public.loyalty_accounts  where customer_id = any (v_cust);
  delete from public.order_items       where order_id = any (v_ord);
  delete from public.orders            where id = any (v_ord);
  delete from public.table_sessions    where phone = any (v_phones);
  delete from public.customer_addresses where phone = any (v_phones);
  delete from public.wa_links          where phone = any (v_phones);
  delete from public.wa_verifications  where phone = any (v_phones);
  delete from public.chat_messages     where phone = any (v_phones);
  delete from public.chat_sessions     where phone = any (v_phones);
  delete from public.customers         where id = any (v_cust);

  -- 3) order counter: restart after the highest order that is kept (FK-1001 if nothing is kept)
  if v_restart then
    perform setval(pg_get_serial_sequence('public.orders', 'order_number'),
                   greatest(1000, coalesce((select max(order_number) from public.orders), 1000)), true);
  end if;
end $$;

-- Result: what is left. With RESTART NUMBERING on, the next order is highest_order_kept + 1 (or FK-1001 if it shows 0).
select
  (select count(*) from public.orders)            as orders_left,
  (select count(*) from public.customers)         as customers_left,
  (select count(*) from public.chat_sessions)     as chat_conversations_left,
  (select count(*) from public.menu_items)        as menu_items_untouched,
  (select count(*) from public.restaurant_tables) as tables_untouched,
  (select coalesce(max(order_number), 0) from public.orders) as highest_order_kept;

-- ============================================================
-- UNDO (only if something looks wrong). Do it straight away, BEFORE any new order arrives: with RESTART NUMBERING on, new orders reuse
-- the freed numbers and the restored ones would clash. Copy the saved rows back, in this order, then run the DROP below.
--   insert into public.customers          select * from cleanup_backup_20261120.customers;
--   insert into public.orders             select * from cleanup_backup_20261120.orders;
--   insert into public.order_items        select * from cleanup_backup_20261120.order_items;
--   insert into public.order_events       select * from cleanup_backup_20261120.order_events;
--   insert into public.order_audit        select * from cleanup_backup_20261120.order_audit;
--   insert into public.stock_movements    select * from cleanup_backup_20261120.stock_movements;
--   insert into public.table_sessions     select * from cleanup_backup_20261120.table_sessions;
--   insert into public.customer_addresses select * from cleanup_backup_20261120.customer_addresses;
--   insert into public.wa_links           select * from cleanup_backup_20261120.wa_links;
--   insert into public.chat_sessions      select * from cleanup_backup_20261120.chat_sessions;
--   insert into public.chat_messages      select * from cleanup_backup_20261120.chat_messages;
--   insert into public.loyalty_accounts   select * from cleanup_backup_20261120.loyalty_accounts;
--   insert into public.loyalty_transactions select * from cleanup_backup_20261120.loyalty_transactions;
--
-- When you are happy (a few days later), remove the saved copy: it contains customer phone numbers.
--   drop schema cleanup_backup_20261120 cascade;
-- ============================================================
