-- Fried King: customer order stats stored on each contact (for large contact lists).
--
-- Adds customers.total_orders and customers.last_order_at, kept up to date by a trigger on orders,
-- so Contacts / POS / Blast can search, filter, sort and page in the database instead of downloading
-- every customer and every order to the browser.
--
-- SAFE TO RUN ON A LIVE DATABASE:
--   * Only ADDS things (2 columns, 2 functions, 1 trigger, 3 indexes). Nothing is dropped or rewritten.
--   * The current dashboard code keeps working before and after this runs.
--   * The trigger can never block an order: if counting fails it only logs a warning.
--   * Safe to run again (everything is "if not exists" / "or replace").
--
-- Run on the MAIN project (Pandeshwar, Falnir, Kadri). Also run on the SECOND project (Bangalore) when
-- you can; until then that project's dashboard keeps using the old way automatically.
--
-- Counted statuses = real orders: pending, confirmed, preparing, ready, delivered
-- (not draft, not cancelled), same as the dashboard has always counted.

-- 1. Columns ------------------------------------------------------------------------------------
alter table public.customers
  add column if not exists total_orders  integer not null default 0,
  add column if not exists last_order_at timestamptz;

-- 2. Indexes --------------------------------------------------------------------------------------
-- Counting one customer's orders (used by the trigger).
create index if not exists orders_customer_id on public.orders(customer_id);
-- Contacts page sorted by last order / newest, inside one branch.
create index if not exists customers_branch_last_order on public.customers(branch_id, last_order_at desc nulls last);
create index if not exists customers_branch_created    on public.customers(branch_id, created_at desc);

-- 3. Recount one customer --------------------------------------------------------------------------
-- Recounts from the orders table every time (never +1/-1), so the numbers cannot drift.
-- Locks the customer row first so two orders for the same customer at the same moment both get counted.
create or replace function public.fk_refresh_customer_stats(p_customer uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_n    integer;
  v_last timestamptz;
begin
  perform 1 from public.customers where id = p_customer for update;
  if not found then return; end if;

  select count(*)::int, max(created_at) into v_n, v_last
    from public.orders
   where customer_id = p_customer
     and status::text in ('pending', 'confirmed', 'preparing', 'ready', 'delivered');

  update public.customers
     set total_orders = v_n, last_order_at = v_last
   where id = p_customer
     and (total_orders is distinct from v_n or last_order_at is distinct from v_last);
end;
$$;

-- 4. Trigger on orders ----------------------------------------------------------------------------
create or replace function public.fk_orders_customer_stats()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  begin
    -- NEW only exists on INSERT/UPDATE and OLD only on UPDATE/DELETE, so each case reads only its own record.
    if tg_op = 'INSERT' then
      if new.customer_id is not null then
        perform public.fk_refresh_customer_stats(new.customer_id);
      end if;
    elsif tg_op = 'UPDATE' then
      if new.customer_id is not null then
        perform public.fk_refresh_customer_stats(new.customer_id);
      end if;
      if old.customer_id is not null and old.customer_id is distinct from new.customer_id then
        perform public.fk_refresh_customer_stats(old.customer_id);
      end if;
    elsif tg_op = 'DELETE' then
      if old.customer_id is not null then
        perform public.fk_refresh_customer_stats(old.customer_id);
      end if;
    end if;
  exception when others then
    -- Never let contact stats stop an order from being saved.
    raise warning 'fk_orders_customer_stats: %', sqlerrm;
  end;
  return null;
end;
$$;

drop trigger if exists fk_orders_customer_stats on public.orders;
create trigger fk_orders_customer_stats
after insert or delete or update of status, customer_id, created_at on public.orders
for each row execute function public.fk_orders_customer_stats();

-- Only the database itself calls these (not the website or the API).
revoke all on function public.fk_refresh_customer_stats(uuid) from public, anon, authenticated;
revoke all on function public.fk_orders_customer_stats() from public, anon, authenticated;

-- 5. Fill in the numbers for existing contacts ------------------------------------------------------
-- Needed once. It is also a repair: re-running this block any time recounts every contact from the orders table.
update public.customers c
   set total_orders = s.n, last_order_at = s.last
  from (
    select c2.id, count(o.id)::int as n, max(o.created_at) as last
      from public.customers c2
      left join public.orders o
        on o.customer_id = c2.id
       and o.status::text in ('pending', 'confirmed', 'preparing', 'ready', 'delivered')
     group by c2.id
  ) s
 where s.id = c.id
   and (c.total_orders is distinct from s.n or c.last_order_at is distinct from s.last);

-- 6. Check ------------------------------------------------------------------------------------------
-- Expect mismatches = 0 for every branch.
select b.slug,
       count(*)                                            as contacts,
       count(*) filter (where c.total_orders > 0)          as with_orders,
       count(*) filter (where c.total_orders <> coalesce(x.n, 0)
                           or c.last_order_at is distinct from x.last) as mismatches
  from public.customers c
  join public.branches b on b.id = c.branch_id
  left join lateral (
    select count(*)::int as n, max(o.created_at) as last
      from public.orders o
     where o.customer_id = c.id
       and o.status::text in ('pending', 'confirmed', 'preparing', 'ready', 'delivered')
  ) x on true
 group by b.slug
 order by b.slug;
