-- Fried King: promotions received, stored on each contact.
--
-- Adds customers.promo_count and customers.last_promo_at, kept up to date by a trigger on outbound_messages,
-- so Contacts can show "promotions received", sort by the latest promotion and filter "never sent a promotion"
-- in the database.
--
-- A promotion counts once WhatsApp ACCEPTED it: the message was sent by n8n (status 'done') and has not
-- failed afterwards (delivery_status is not 'failed'). Queued, waiting and failed messages are not counted.
--
-- SAFE TO RUN ON A LIVE DATABASE:
--   * Only ADDS things (2 columns, 2 functions, 1 trigger, 2 indexes). Nothing is dropped or rewritten.
--   * The current dashboard keeps working before and after this runs.
--   * The trigger can never block a send: if counting fails it only logs a warning.
--   * Safe to run again.
--
-- Run on the MAIN project (Pandeshwar, Falnir, Kadri) AND on the SECOND project (Bangalore).
-- Needs supabase/friedking_blast_delivery_status.sql (it adds outbound_messages.delivery_status) to be run first.

-- 1. Columns ------------------------------------------------------------------------------------
alter table public.customers
  add column if not exists promo_count   integer not null default 0,
  add column if not exists last_promo_at timestamptz;

-- 2. Indexes --------------------------------------------------------------------------------------
create index if not exists outbound_messages_branch_phone on public.outbound_messages(branch_id, to_phone) where kind = 'blast';
create index if not exists customers_branch_last_promo    on public.customers(branch_id, last_promo_at desc nulls last);

-- 3. Recount one contact --------------------------------------------------------------------------
-- Recounts from outbound_messages every time (never +1/-1), so the numbers cannot drift.
create or replace function public.fk_refresh_promo_stats(p_branch uuid, p_phone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n    integer;
  v_last timestamptz;
begin
  select count(*)::int, max(coalesce(m.processed_at, m.created_at)) into v_n, v_last
    from public.outbound_messages m
   where m.branch_id = p_branch
     and m.to_phone = p_phone
     and m.kind = 'blast'
     and m.status::text = 'done'
     and coalesce(m.delivery_status, '') <> 'failed';

  update public.customers
     set promo_count = v_n, last_promo_at = v_last
   where branch_id = p_branch
     and phone = p_phone
     and (promo_count is distinct from v_n or last_promo_at is distinct from v_last);
end;
$$;

-- 4. Trigger on outbound_messages -----------------------------------------------------------------
create or replace function public.fk_outbound_promo_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    if new.kind = 'blast' then
      perform public.fk_refresh_promo_stats(new.branch_id, new.to_phone);
    end if;
  exception when others then
    -- Never let contact stats stop a message from being sent.
    raise warning 'fk_outbound_promo_stats: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists fk_outbound_promo_stats on public.outbound_messages;
create trigger fk_outbound_promo_stats
after insert or update of status, delivery_status on public.outbound_messages
for each row execute function public.fk_outbound_promo_stats();

revoke all on function public.fk_refresh_promo_stats(uuid, text) from public, anon, authenticated;
revoke all on function public.fk_outbound_promo_stats() from public, anon, authenticated;

-- 5. Fill in the numbers for existing contacts ------------------------------------------------------
-- Needed once (counts the promotions already sent). Also a repair: re-running this block recounts every contact.
update public.customers c
   set promo_count = s.n, last_promo_at = s.last
  from (
    select c2.id, count(m.id)::int as n, max(coalesce(m.processed_at, m.created_at)) as last
      from public.customers c2
      left join public.outbound_messages m
        on m.branch_id = c2.branch_id
       and m.to_phone = c2.phone
       and m.kind = 'blast'
       and m.status::text = 'done'
       and coalesce(m.delivery_status, '') <> 'failed'
     group by c2.id
  ) s
 where s.id = c.id
   and (c.promo_count is distinct from s.n or c.last_promo_at is distinct from s.last);

-- 6. Check ------------------------------------------------------------------------------------------
-- Expect mismatches = 0 for every branch.
select b.slug,
       count(*)                                         as contacts,
       count(*) filter (where c.promo_count > 0)        as got_a_promotion,
       count(*) filter (where c.promo_count <> coalesce(x.n, 0)
                           or c.last_promo_at is distinct from x.last) as mismatches
  from public.customers c
  join public.branches b on b.id = c.branch_id
  left join lateral (
    select count(*)::int as n, max(coalesce(m.processed_at, m.created_at)) as last
      from public.outbound_messages m
     where m.branch_id = c.branch_id and m.to_phone = c.phone and m.kind = 'blast'
       and m.status::text = 'done' and coalesce(m.delivery_status, '') <> 'failed'
  ) x on true
 group by b.slug
 order by b.slug;
