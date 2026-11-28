-- Fried King: business day that ends after midnight (Settings > Business day ends at).
--
-- The dashboard reads the new setting `day_close_time` (default 00:00) for Today / Yesterday / reports.
-- This file makes the daily TOKEN numbers follow the same business day: with 03:00, orders placed
-- between midnight and 3 am keep counting on the previous day's token numbers instead of starting again at 1.
--
-- SAFE TO RUN ON A LIVE DATABASE:
--   * Only replaces the function that picks the token day. Nothing else changes, no data is rewritten.
--   * Branches that have not set a time behave exactly as before (midnight IST).
--   * Existing orders keep their token numbers.
--   * Safe to run again.
--
-- Run on the MAIN project (Pandeshwar, Falnir, Kadri) AND on the SECOND project (Bangalore).
-- Run AFTER supabase/friedking_order_tokens.sql.

create or replace function public.fk_assign_daily_token()
returns trigger
language plpgsql
as $$
declare
  next_token bigint;
  v_shift    interval := interval '0';
  v_raw      text;
begin
  if new.token_date is null then
    -- The branch's "business day ends at" time (HH:MM, 00:00 - 12:00), if any.
    begin
      select value into v_raw from public.branch_settings where branch_id = new.branch_id and key = 'day_close_time';
      if v_raw ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$' and v_raw <= '12:00' then
        v_shift := v_raw::time - time '00:00';
      end if;
    exception when others then
      v_shift := interval '0';
    end;
    new.token_date := ((coalesce(new.created_at, now()) at time zone 'Asia/Kolkata') - v_shift)::date;
  end if;
  if new.token_number is null then
    perform pg_advisory_xact_lock(
      hashtextextended(new.branch_id::text || ':' || new.token_date::text, 0)
    );
    select coalesce(max(token_number), 0) + 1
      into next_token
      from public.orders
      where branch_id = new.branch_id
        and token_date = new.token_date;
    new.token_number := next_token;
  end if;
  return new;
end;
$$;

-- Check: shows the branches that have set a time (empty until someone saves one in Settings).
select b.slug, s.value as day_close_time
  from public.branch_settings s
  join public.branches b on b.id = s.branch_id
 where s.key = 'day_close_time';
