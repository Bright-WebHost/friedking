-- Fried King: daily customer token numbers.
-- Reset is at midnight IST, independently for each branch.
-- Bill No. remains orders.order_number.

alter table public.orders
  add column if not exists token_date date,
  add column if not exists token_number bigint;

with numbered as (
  select
    id,
    (created_at at time zone 'Asia/Kolkata')::date as token_date,
    row_number() over (
      partition by branch_id, (created_at at time zone 'Asia/Kolkata')::date
      order by created_at, id
    )::bigint as token_number
  from public.orders
  where token_number is null
)
update public.orders as o
set token_date = n.token_date,
    token_number = n.token_number
from numbered as n
where o.id = n.id;

alter table public.orders
  alter column token_date set not null,
  alter column token_number set not null;

alter table public.orders
  drop constraint if exists orders_token_number_positive;
alter table public.orders
  add constraint orders_token_number_positive check (token_number > 0);

create unique index if not exists orders_branch_token_day
  on public.orders(branch_id, token_date, token_number);

create or replace function public.fk_assign_daily_token()
returns trigger
language plpgsql
as $$
declare
  next_token bigint;
begin
  if new.token_date is null then
    new.token_date := (coalesce(new.created_at, now()) at time zone 'Asia/Kolkata')::date;
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

drop trigger if exists fk_assign_daily_token on public.orders;
create trigger fk_assign_daily_token
before insert on public.orders
for each row execute function public.fk_assign_daily_token();
