-- ============================================================
-- Fried King: delivery fee on web orders. Safe to re-run.
-- Run in the Supabase SQL Editor. The website works without it (fee is simply not charged until this is run).
-- ============================================================
alter table public.orders add column if not exists delivery_fee_paise int not null default 0;

select 'orders.delivery_fee_paise' as item,
  exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name = 'delivery_fee_paise') as ok;
