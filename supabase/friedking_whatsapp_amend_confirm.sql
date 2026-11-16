-- ============================================================
-- Fried King WhatsApp bot: changes to a PLACED order need the customer's confirmation.
-- Run in the Supabase SQL Editor AFTER friedking_whatsapp_bot.sql. Safe to re-run.
--
-- Before: "I want to order 2 french fries" while order FK-1027 was placed but not yet accepted changed FK-1027 at once
--         and told the kitchen. Now the bot stages the new item list, shows it with Confirm / Keep buttons, and only
--         calls customer_amend() when the customer taps Confirm (same as Rasoi: nothing changes without a yes).
-- New order drafts already needed Confirm; they are not touched.
-- ============================================================

create table if not exists public.wa_pending_amend (
  order_id   uuid primary key references public.orders(id) on delete cascade,
  branch_id  uuid not null references public.branches(id) on delete cascade,
  phone      text not null,
  items      jsonb not null,
  created_at timestamptz not null default now()
);
alter table public.wa_pending_amend enable row level security;   -- service role only, like every other bot table

-- Hold the new item list for a placed order. Does NOT change the order.
create or replace function public.customer_amend_stage(p_phone text, p_order text, p_items jsonb, p_branch text default 'pandeshwar')
returns jsonb language plpgsql security definer set search_path = public as $$
declare b branches%rowtype; v_id uuid; o orders%rowtype;
begin
  select * into b from branches where slug = p_branch;
  v_id := public.fk_wa_find_order(b.id, p_phone, p_order);
  if v_id is null then return jsonb_build_object('result', 'locked'); end if;
  select * into o from orders where id = v_id;
  -- only an order the kitchen has not accepted yet can still be changed
  if o.status::text not in ('pending', 'confirmed') or o.accepted_at is not null then
    return jsonb_build_object('result', 'locked', 'order', public.fk_wa_order_json(v_id));
  end if;
  insert into wa_pending_amend (order_id, branch_id, phone, items, created_at)
    values (v_id, b.id, public.fk_wa_phone(p_phone), p_items, now())
    on conflict (order_id) do update set items = excluded.items, phone = excluded.phone, created_at = now();
  return jsonb_build_object('result', 'staged', 'order', public.fk_wa_order_json(v_id), 'items', p_items);
exception when others then
  raise warning 'customer_amend_stage failed: %', sqlerrm;
  return jsonb_build_object('result', 'error');
end $$;

-- The customer tapped Confirm: apply the staged list (customer_amend re-checks that the order is still unaccepted).
create or replace function public.customer_amend_confirm(p_phone text, p_order text, p_branch text default 'pandeshwar')
returns jsonb language plpgsql security definer set search_path = public as $$
declare b branches%rowtype; v_id uuid; s wa_pending_amend%rowtype; r jsonb;
begin
  select * into b from branches where slug = p_branch;
  v_id := public.fk_wa_find_order(b.id, p_phone, p_order);
  if v_id is null then return jsonb_build_object('result', 'error'); end if;
  select * into s from wa_pending_amend where order_id = v_id;
  if not found or s.created_at < now() - interval '30 minutes' then
    delete from wa_pending_amend where order_id = v_id;
    return jsonb_build_object('result', 'expired', 'order', public.fk_wa_order_json(v_id));
  end if;
  r := public.customer_amend(p_phone, p_order, s.items, null, p_branch);
  delete from wa_pending_amend where order_id = v_id;
  return r;
end $$;

-- The customer tapped Keep as is: forget the staged list.
create or replace function public.customer_amend_discard(p_phone text, p_order text, p_branch text default 'pandeshwar')
returns jsonb language plpgsql security definer set search_path = public as $$
declare b branches%rowtype; v_id uuid;
begin
  select * into b from branches where slug = p_branch;
  v_id := public.fk_wa_find_order(b.id, p_phone, p_order);
  if v_id is not null then delete from wa_pending_amend where order_id = v_id; end if;
  return jsonb_build_object('result', 'kept', 'order', case when v_id is null then null else public.fk_wa_order_json(v_id) end);
end $$;

revoke all on function public.customer_amend_stage(text, text, jsonb, text) from public, anon, authenticated;
revoke all on function public.customer_amend_confirm(text, text, text) from public, anon, authenticated;
revoke all on function public.customer_amend_discard(text, text, text) from public, anon, authenticated;
grant execute on function public.customer_amend_stage(text, text, jsonb, text), public.customer_amend_confirm(text, text, text),
  public.customer_amend_discard(text, text, text) to service_role;

select 'wa_pending_amend' as item, to_regclass('public.wa_pending_amend') is not null as ok
union all select 'customer_amend_stage()', to_regprocedure('public.customer_amend_stage(text,text,jsonb,text)') is not null
union all select 'customer_amend_confirm()', to_regprocedure('public.customer_amend_confirm(text,text,text)') is not null
union all select 'customer_amend_discard()', to_regprocedure('public.customer_amend_discard(text,text,text)') is not null;
