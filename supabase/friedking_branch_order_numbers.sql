-- Per-branch order numbers: each branch counts its own orders from FK-1001 (Pandeshwar keeps its current numbers and
-- carries on; Falnir starts fresh). Until now one counter was shared by all branches, so Falnir continued Pandeshwar's numbers.
--
-- RUN ORDER: first make the one n8n change in docs/BRANCH_ORDER_NUMBERS_N8N.md (both Main workflows), THEN run this file once.
-- Safe to re-run. Runs as one transaction: if anything fails, nothing changes.
--
-- What it does
--  1. Stops the shared identity counter on orders.order_number.
--  2. Makes the number unique per branch (branch_id + order_number) instead of globally.
--  3. Adds branch_order_counters + a trigger that gives every new order the next number FOR ITS BRANCH (never reused).
--  4. Renumbers Falnir's existing TEST orders to 1001, 1002 ... (only if Falnir has fewer than 50 orders, as a safety check).

begin;

-- 1. no more shared counter
alter table public.orders alter column order_number drop identity if exists;

-- 2. unique per branch, not across all branches
drop index if exists public.idx_orders_order_number;
create unique index if not exists orders_branch_order_number on public.orders(branch_id, order_number);

-- 3. one counter row per branch
create table if not exists public.branch_order_counters (
  branch_id   uuid primary key references public.branches(id) on delete cascade,
  last_number bigint not null
);
alter table public.branch_order_counters enable row level security;   -- closed to the public; the trigger runs as owner

insert into public.branch_order_counters (branch_id, last_number)
select branch_id, max(order_number) from public.orders group by branch_id
on conflict (branch_id) do nothing;

create or replace function public.fk_assign_order_number()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.order_number is null then
    insert into public.branch_order_counters as c (branch_id, last_number)
    values (new.branch_id, 1001)
    on conflict (branch_id) do update set last_number = c.last_number + 1
    returning c.last_number into new.order_number;
  end if;
  return new;
end;
$$;

drop trigger if exists fk_assign_order_number on public.orders;
create trigger fk_assign_order_number
before insert on public.orders
for each row execute function public.fk_assign_order_number();

-- 4. Falnir test orders -> 1001, 1002 ... (never touches Pandeshwar)
do $$
declare
  fid uuid;
  cnt int;
begin
  select id into fid from public.branches where slug = 'falnir';
  if fid is null then return; end if;
  select count(*) into cnt from public.orders where branch_id = fid;
  if cnt = 0 then
    delete from public.branch_order_counters where branch_id = fid;
    return;
  end if;
  if cnt >= 50 then
    raise notice 'Falnir has % orders - not renumbering (this step is only for test orders)', cnt;
    return;
  end if;

  with n as (
    select id, 1000 + row_number() over (order by created_at, id) as nn
    from public.orders where branch_id = fid
  )
  update public.orders o set order_number = n.nn from n where o.id = n.id;

  update public.order_audit a set order_number = o.order_number
  from public.orders o where a.order_id = o.id and o.branch_id = fid;

  insert into public.branch_order_counters (branch_id, last_number)
  values (fid, 1000 + cnt)
  on conflict (branch_id) do update set last_number = excluded.last_number;
end $$;

commit;

-- Check: each branch's highest number, and nothing duplicated inside a branch
select b.slug, count(*) as orders, min(o.order_number) as lowest, max(o.order_number) as highest, c.last_number as counter
from public.orders o
join public.branches b on b.id = o.branch_id
left join public.branch_order_counters c on c.branch_id = o.branch_id
group by b.slug, c.last_number;
