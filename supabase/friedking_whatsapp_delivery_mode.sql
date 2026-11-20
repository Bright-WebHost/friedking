-- ============================================================
-- Fried King WhatsApp bot: ask takeaway / delivery, take the typed delivery address, never place a delivery order without one.
-- Run in the Supabase SQL Editor AFTER friedking_whatsapp_checkout.sql. Safe to re-run. No table changes (functions only).
--
-- Chat order flow after this (the n8n side is deployed after you run this file):
--   1. Customer asks for items          -> bot shows the cart and asks  [Delivery | Takeaway]
--   2. Takeaway                         -> full summary  [Confirm | Modify | Cancel]
--      Delivery                         -> "type your delivery address" -> customer types it -> full summary
--   3. Confirm                          -> customer_checkout('confirm') as before (points question, then placed)
-- Before this, delivery orders were saved with the placeholder "Address to be confirmed ..." and the typed address was lost.
-- ============================================================

-- Set the order type (and the typed address) on a DRAFT. Only the customer's own open draft can be changed.
--   p_mode   'delivery' | 'pickup'
--   p_address  null = "delivery chosen, address still to come"; text = the address the customer typed
create or replace function public.customer_set_delivery(p_phone text, p_order text, p_mode text, p_address text default null, p_branch text default 'pandeshwar')
returns jsonb language plpgsql security definer set search_path = public as $$
declare b branches%rowtype; v_id uuid; o orders%rowtype; v_mode text := lower(coalesce(p_mode, ''));
        v_addr text := nullif(trim(regexp_replace(coalesce(p_address, ''), '\s+', ' ', 'g')), ''); v_pin text;
begin
  select * into b from branches where slug = p_branch;
  if not found then return jsonb_build_object('result', 'error'); end if;
  v_id := public.fk_wa_find_order(b.id, p_phone, p_order);
  if v_id is null then return jsonb_build_object('result', 'error'); end if;
  select * into o from orders where id = v_id for update;
  if o.status::text <> 'draft' or o.created_at < now() - interval '60 minutes' then
    return jsonb_build_object('result', 'locked', 'order', public.fk_wa_order_json(v_id));
  end if;

  if v_mode in ('takeaway', 'pickup') then
    update orders set order_type = 'pickup', delivery_address = null, delivery_pincode = null, table_session_id = null, table_number = null where id = v_id;
    return jsonb_build_object('result', 'ok', 'mode', 'pickup', 'order', public.fk_wa_order_json(v_id));
  elsif v_mode = 'delivery' then
    if v_addr is null then
      -- delivery chosen, address still to come. The orders table requires an address for every delivery order, so the
      -- standard placeholder is stored (customer_checkout refuses to place an order that still has it).
      update orders set order_type = 'delivery', delivery_address = 'Address to be confirmed with the customer on WhatsApp', delivery_pincode = null, table_session_id = null, table_number = null where id = v_id;
      return jsonb_build_object('result', 'ok', 'mode', 'delivery', 'order', public.fk_wa_order_json(v_id));
    end if;
    if length(v_addr) < 10 or v_addr !~ '[A-Za-z]' then
      return jsonb_build_object('result', 'bad_address', 'order', public.fk_wa_order_json(v_id));
    end if;
    v_addr := left(v_addr, 400);
    v_pin := substring(v_addr from '(?:^|[^0-9])([0-9]{6})(?:[^0-9]|$)');
    if v_pin is not null and exists (select 1 from delivery_pincodes d where d.branch_id = b.id and d.is_active)
       and not exists (select 1 from delivery_pincodes d where d.branch_id = b.id and d.is_active and d.pincode = v_pin) then
      return jsonb_build_object('result', 'no_area', 'pincode', v_pin, 'order', public.fk_wa_order_json(v_id));
    end if;
    update orders set order_type = 'delivery', delivery_address = v_addr, delivery_pincode = v_pin, table_session_id = null, table_number = null where id = v_id;
    return jsonb_build_object('result', 'ok', 'mode', 'delivery', 'order', public.fk_wa_order_json(v_id));
  end if;
  return jsonb_build_object('result', 'error');
exception when others then
  raise warning 'customer_set_delivery failed: %', sqlerrm;
  return jsonb_build_object('result', 'error');
end $$;

-- customer_checkout (from friedking_whatsapp_checkout.sql) with ONE addition: a delivery draft without a real address is not placed;
-- the bot is told 'needs_address' and asks for it. Everything else is unchanged.
create or replace function public.customer_checkout(p_phone text, p_order text, p_action text, p_branch text default 'pandeshwar')
returns jsonb language plpgsql security definer set search_path = public as $$
declare b branches%rowtype; v_id uuid; o orders%rowtype; v_off jsonb; v_action text := lower(coalesce(p_action, ''));
begin
  select * into b from branches where slug = p_branch;
  if not found then return jsonb_build_object('result', 'error'); end if;
  v_id := public.fk_wa_find_order(b.id, p_phone, p_order);
  if v_id is null then return jsonb_build_object('result', 'error'); end if;
  select * into o from orders where id = v_id;

  -- NEW: an open delivery draft needs the customer's typed address before it can be placed
  if o.status::text = 'draft' and o.created_at >= now() - interval '60 minutes' and v_action in ('confirm', 'place', 'use_points', 'skip_points')
     and o.order_type::text = 'delivery'
     and (nullif(trim(coalesce(o.delivery_address, '')), '') is null or o.delivery_address like 'Address to be confirmed%') then
    return jsonb_build_object('result', 'needs_address', 'order', public.fk_wa_order_json(v_id));
  end if;

  -- anything that is not an open draft: customer_confirm gives the right answer (already / cancelled / expired / in_progress)
  if o.status::text <> 'draft' or o.created_at < now() - interval '60 minutes' or v_action = 'place' then
    return public.customer_confirm(p_phone, p_order, p_branch);
  end if;

  if v_action = 'confirm' then
    -- points already chosen, dine-in, or nothing to redeem: place it now
    if coalesce(o.loyalty_points_redeemed, 0) > 0 or o.order_type::text = 'dine-in' then
      return public.customer_confirm(p_phone, p_order, p_branch);
    end if;
    v_off := public.fk_loyalty_offer(o.customer_id, o.subtotal_paise + o.gst_paise);
    if coalesce((v_off->>'usable_points')::int, 0) > 0 then
      return jsonb_build_object('result', 'ask_points', 'offer', v_off, 'order', public.fk_wa_order_json(v_id));
    end if;
    return public.customer_confirm(p_phone, p_order, p_branch);

  elsif v_action = 'use_points' then
    perform public.fk_wa_apply_points(v_id, true);
    select * into o from orders where id = v_id;
    if coalesce(o.loyalty_points_redeemed, 0) = 0 then
      -- nothing could be applied (balance changed): place at full price and say so
      return public.customer_confirm(p_phone, p_order, p_branch) || jsonb_build_object('points_failed', true);
    end if;
    return jsonb_build_object('result', 'final', 'order', public.fk_wa_order_json(v_id),
      'points_used', o.loyalty_points_redeemed, 'points_value', o.loyalty_discount_paise / 100,
      'subtotal_before_points', round((o.subtotal_paise + o.gst_paise) / 100.0)::int);

  elsif v_action = 'skip_points' then
    perform public.fk_wa_apply_points(v_id, false);
    return public.customer_confirm(p_phone, p_order, p_branch);
  end if;

  return jsonb_build_object('result', 'error');
exception when others then
  raise warning 'customer_checkout failed: %', sqlerrm;
  return jsonb_build_object('result', 'error');
end $$;

revoke all on function public.customer_set_delivery(text, text, text, text, text) from public, anon, authenticated;
revoke all on function public.customer_checkout(text, text, text, text) from public, anon, authenticated;
grant execute on function public.customer_set_delivery(text, text, text, text, text), public.customer_checkout(text, text, text, text) to service_role;

select 'customer_set_delivery()' as item, to_regprocedure('public.customer_set_delivery(text,text,text,text,text)') is not null as ok
union all select 'customer_checkout()', to_regprocedure('public.customer_checkout(text,text,text,text)') is not null;
