-- ============================================================
-- Fried King WhatsApp bot: use reward points on a chat order.
-- Run in the Supabase SQL Editor AFTER friedking_dashboard_oceana.sql, friedking_whatsapp_bot.sql and
-- friedking_whatsapp_amend_confirm.sql. Safe to re-run. No table or column changes.
--
-- Flow:
--   customer_draft()            (unchanged) -> n8n calls customer_points() to see if the customer has points
--   customer_use_points(true)   customer tapped "Use points": the draft gets the discount (nothing spent yet)
--   customer_use_points(false)  customer tapped "Not now": discount removed
--   customer_confirm()          (replaced) spends the points with fk_loyalty_redeem; if that fails the order
--                               is placed at full price and the result says points_failed = true
--   customer_cancel()           (replaced) a cancelled order gives its points back
--   fk_wa_write_items()         (replaced) edits keep the discount; a draft's points are re-capped for the new items
--
-- Same rules as the website (lib/loyalty.ts): capped by the program's max % per order, whole rupees only,
-- not for dine-in. The phone is proven because the message came from that WhatsApp number.
--
-- NOTE: this replaces customer_confirm, customer_cancel and fk_wa_write_items with the versions in
-- friedking_whatsapp_bot.sql plus the points logic. If those were edited by hand in Supabase, re-apply the edits.
-- ============================================================

-- ---------- how many points a customer can use on a food total ----------
create or replace function public.fk_loyalty_offer(p_customer uuid, p_food_total_paise int)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare p loyalty_programs%rowtype; v_bal int; v_pts int; v_max int; v_today int; v_acct uuid;
begin
  select lp.* into p from customers c join loyalty_programs lp on lp.branch_id = c.branch_id and lp.is_active
   where c.id = p_customer limit 1;
  if not found or p.type = 'visit' or coalesce(p.redemption_paise_per_point, 0) <= 0 then
    return jsonb_build_object('available', false, 'balance', 0, 'usable_points', 0, 'usable_value', 0, 'value_paise', 0);
  end if;
  select id, points_balance into v_acct, v_bal from loyalty_accounts where customer_id = p_customer;
  v_bal := coalesce(v_bal, 0);
  v_max := floor(greatest(coalesce(p_food_total_paise, 0), 0) * coalesce(p.max_redeem_pct_per_order, 0) / 100.0);
  if p.max_redeem_paise_per_day is not null and v_acct is not null then
    select coalesce(sum(-t.points), 0) * p.redemption_paise_per_point into v_today
      from loyalty_transactions t
      where t.account_id = v_acct and t.type = 'redeem'
        and t.created_at >= date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
    v_max := least(v_max, greatest(0, p.max_redeem_paise_per_day - coalesce(v_today, 0)));
  end if;
  v_pts := least(v_bal, floor(v_max::numeric / p.redemption_paise_per_point)::int);
  -- bills have no paise: only use a number of points worth whole rupees
  while v_pts > 0 and (v_pts * p.redemption_paise_per_point) % 100 <> 0 loop v_pts := v_pts - 1; end loop;
  return jsonb_build_object(
    'available', v_bal > 0,
    'balance', v_bal,
    'usable_points', v_pts,
    'usable_value', (v_pts * p.redemption_paise_per_point) / 100,
    'value_paise', v_pts * p.redemption_paise_per_point,
    'currency', coalesce(nullif(p.currency_name, ''), 'points'),
    'program', coalesce(nullif(p.name, ''), 'Fried King Rewards'),
    'max_pct', p.max_redeem_pct_per_order);
end $$;

-- ---------- put / remove the points discount on a DRAFT (nothing is spent until Confirm) ----------
create or replace function public.fk_wa_apply_points(p_order uuid, p_use boolean)
returns void language plpgsql security definer set search_path = public as $$
declare o orders%rowtype; v_food int; v_off jsonb; v_pts int := 0; v_val int := 0;
begin
  select * into o from orders where id = p_order for update;
  if not found or o.status::text <> 'draft' then return; end if;
  v_food := o.subtotal_paise + o.gst_paise;
  if p_use and o.order_type::text <> 'dine-in' then
    v_off := public.fk_loyalty_offer(o.customer_id, v_food);
    v_pts := coalesce((v_off->>'usable_points')::int, 0);
    v_val := coalesce((v_off->>'value_paise')::int, 0);
  end if;
  update orders set loyalty_points_redeemed = v_pts, loyalty_discount_paise = v_val,
         total_paise = greatest(0, round((v_food - v_val) / 100.0)::int * 100)
   where id = p_order;
end $$;

-- ---------- give points back for a cancelled order (safe to call twice: checks the ledger) ----------
create or replace function public.fk_loyalty_refund(p_order uuid, p_staff text default null)
returns int language plpgsql security definer set search_path = public as $$
declare o record; a loyalty_accounts%rowtype; v_out int; v_give int;
begin
  select id, order_number, customer_id, loyalty_points_redeemed into o from orders where id = p_order;
  if not found or coalesce(o.loyalty_points_redeemed, 0) <= 0 then return 0; end if;
  select * into a from loyalty_accounts where customer_id = o.customer_id for update;
  if not found then return 0; end if;
  -- redeem rows are negative, refunds positive: what is still owed back for this order
  select -coalesce(sum(points), 0) into v_out from loyalty_transactions where order_id = p_order and type in ('redeem', 'refund');
  v_give := least(o.loyalty_points_redeemed, v_out);
  if v_give <= 0 then return 0; end if;
  update loyalty_accounts set points_balance = points_balance + v_give, updated_at = now() where id = a.id;
  insert into loyalty_transactions (account_id, points, reason, order_id, type, balance_after, staff_name)
    values (a.id, v_give, 'Refund · order #' || o.order_number || ' cancelled', p_order, 'refund', a.points_balance + v_give, p_staff);
  return v_give;
end $$;

-- ---------- bot: does this customer have points for this order? ----------
create or replace function public.customer_points(p_phone text, p_order text, p_branch text default 'pandeshwar')
returns jsonb language plpgsql security definer set search_path = public as $$
declare b branches%rowtype; v_id uuid; o orders%rowtype; v_off jsonb;
begin
  select * into b from branches where slug = p_branch;
  if not found then return jsonb_build_object('result', 'error'); end if;
  v_id := public.fk_wa_find_order(b.id, p_phone, p_order);
  if v_id is null then return jsonb_build_object('result', 'error'); end if;
  select * into o from orders where id = v_id;
  if o.order_type::text = 'dine-in' then
    return jsonb_build_object('result', 'not_allowed', 'offer', jsonb_build_object('available', false, 'usable_points', 0), 'order', public.fk_wa_order_json(v_id));
  end if;
  v_off := public.fk_loyalty_offer(o.customer_id, o.subtotal_paise + o.gst_paise);
  return jsonb_build_object('result', 'ok', 'offer', v_off,
    'points_used', coalesce(o.loyalty_points_redeemed, 0), 'points_value', coalesce(o.loyalty_discount_paise, 0) / 100,
    'order', public.fk_wa_order_json(v_id));
exception when others then
  raise warning 'customer_points failed: %', sqlerrm;
  return jsonb_build_object('result', 'error');
end $$;

-- ---------- bot: customer tapped "Use points" (true) or "Not now" (false) ----------
create or replace function public.customer_use_points(p_phone text, p_order text, p_use boolean, p_branch text default 'pandeshwar')
returns jsonb language plpgsql security definer set search_path = public as $$
declare b branches%rowtype; v_id uuid; o orders%rowtype;
begin
  select * into b from branches where slug = p_branch;
  if not found then return jsonb_build_object('result', 'error'); end if;
  v_id := public.fk_wa_find_order(b.id, p_phone, p_order);
  if v_id is null then return jsonb_build_object('result', 'error'); end if;
  select * into o from orders where id = v_id;
  -- only before Confirm: a placed order has already spent (or not spent) its points
  if o.status::text <> 'draft' then return jsonb_build_object('result', 'locked', 'order', public.fk_wa_order_json(v_id)); end if;
  if o.created_at < now() - interval '60 minutes' then return jsonb_build_object('result', 'expired', 'order', public.fk_wa_order_json(v_id)); end if;
  perform public.fk_wa_apply_points(v_id, p_use);
  select * into o from orders where id = v_id;
  return jsonb_build_object(
    'result', case when not p_use then 'removed' when coalesce(o.loyalty_points_redeemed, 0) > 0 then 'applied' else 'none' end,
    'points_used', coalesce(o.loyalty_points_redeemed, 0),
    'points_value', coalesce(o.loyalty_discount_paise, 0) / 100,
    'order', public.fk_wa_order_json(v_id));
exception when others then
  raise warning 'customer_use_points failed: %', sqlerrm;
  return jsonb_build_object('result', 'error');
end $$;

-- ---------- replaced: items keep the points discount ----------
create or replace function public.fk_wa_write_items(p_order uuid, p_branch uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare it jsonb; m record; n int := 0; sub int := 0; qty int; v_status text; v_pts int;
begin
  delete from order_items where order_id = p_order;
  for it in select * from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) loop
    qty := least(50, greatest(1, round((it->>'quantity')::numeric)::int));
    select id, name, price_paise into m from menu_items
      where branch_id = p_branch and is_active and lower(name) = lower(trim(it->>'name')) limit 1;
    if not found then raise exception 'unknown dish: %', it->>'name'; end if;
    n := n + 1;
    insert into order_items (order_id, menu_item_id, name_snapshot, unit_price_paise, quantity, line_total_paise, line_no)
      values (p_order, m.id, m.name, m.price_paise, qty, m.price_paise * qty, n);
    sub := sub + m.price_paise * qty;
  end loop;
  if n = 0 then raise exception 'empty order'; end if;
  update orders set subtotal_paise = sub, gst_paise = round(sub * 0.05)::int,
         total_paise = greatest(0, round((sub + round(sub * 0.05)::int - coalesce(loyalty_discount_paise, 0)) / 100.0)::int * 100)
   where id = p_order
   returning status::text, coalesce(loyalty_points_redeemed, 0) into v_status, v_pts;
  -- a draft that uses points: re-cap them for the new items (a placed order keeps the points it already spent)
  if v_status = 'draft' and v_pts > 0 then perform public.fk_wa_apply_points(p_order, true); end if;
end $$;

-- ---------- replaced: Confirm spends the points ----------
create or replace function public.customer_confirm(p_phone text, p_order text, p_branch text default 'pandeshwar')
returns jsonb language plpgsql security definer set search_path = public as $$
declare b branches%rowtype; v_id uuid; o orders%rowtype; c customers%rowtype; v_items jsonb; v_r jsonb; v_failed boolean := false;
begin
  select * into b from branches where slug = p_branch;
  v_id := public.fk_wa_find_order(b.id, p_phone, p_order);
  if v_id is null then return jsonb_build_object('result', 'error'); end if;
  select * into o from orders where id = v_id for update;
  if o.status::text = 'cancelled' then return jsonb_build_object('result', 'cancelled', 'order', public.fk_wa_order_json(v_id)); end if;
  if o.status::text in ('preparing', 'ready', 'delivered') then return jsonb_build_object('result', 'in_progress', 'order', public.fk_wa_order_json(v_id)); end if;
  if o.status::text <> 'draft' then return jsonb_build_object('result', 'already', 'order', public.fk_wa_order_json(v_id)); end if;
  if o.created_at < now() - interval '60 minutes' then return jsonb_build_object('result', 'expired', 'order', public.fk_wa_order_json(v_id)); end if;

  -- reward points chosen on the draft: re-check the balance and spend them now
  if coalesce(o.loyalty_points_redeemed, 0) > 0 then
    perform public.fk_wa_apply_points(v_id, true);
    select * into o from orders where id = v_id;
    if coalesce(o.loyalty_points_redeemed, 0) > 0 then
      v_r := public.fk_loyalty_redeem(o.customer_id, o.loyalty_points_redeemed, v_id, 'WhatsApp order #' || o.order_number, 'WhatsApp')::jsonb;
      if not coalesce((v_r->>'ok')::boolean, false) then
        perform public.fk_wa_apply_points(v_id, false);
        v_failed := true;
      end if;
    else
      v_failed := true;   -- points were spent elsewhere since the draft
    end if;
    select * into o from orders where id = v_id;
  end if;

  update orders set status = 'pending' where id = v_id;
  select * into c from customers where id = o.customer_id;
  select jsonb_agg(jsonb_build_object('name', i.name_snapshot, 'quantity', i.quantity, 'unitPricePaise', i.unit_price_paise) order by i.line_no)
    into v_items from order_items i where i.order_id = v_id;
  -- same payload as an order placed on the website, so n8n and the dashboard treat it the same
  insert into order_events (order_id, branch_id, event_type, payload)
    values (v_id, b.id, 'order_created', jsonb_build_object(
      'orderId', v_id, 'orderNumber', o.order_number, 'branchSlug', b.slug, 'branchName', b.name,
      'customerName', c.name, 'customerPhone', c.phone, 'orderType', o.order_type, 'paymentMethod', o.payment_method,
      'deliveryAddress', o.delivery_address, 'specialInstructions', o.special_instructions, 'source', 'whatsapp',
      'items', coalesce(v_items, '[]'::jsonb), 'subtotalPaise', o.subtotal_paise, 'gstPaise', o.gst_paise, 'totalPaise', o.total_paise,
      'loyaltyPointsRedeemed', coalesce(o.loyalty_points_redeemed, 0), 'loyaltyDiscountPaise', coalesce(o.loyalty_discount_paise, 0)));
  return jsonb_build_object('result', 'confirmed', 'order', public.fk_wa_order_json(v_id),
    'points_used', coalesce(o.loyalty_points_redeemed, 0), 'points_value', coalesce(o.loyalty_discount_paise, 0) / 100)
    || case when v_failed then jsonb_build_object('points_failed', true) else '{}'::jsonb end;
exception when others then
  raise warning 'customer_confirm failed: %', sqlerrm;
  return jsonb_build_object('result', 'error');
end $$;

-- ---------- replaced: a cancelled order gives its points back ----------
create or replace function public.customer_cancel(p_phone text, p_order text, p_reason text default 'other', p_branch text default 'pandeshwar')
returns jsonb language plpgsql security definer set search_path = public as $$
declare b branches%rowtype; v_id uuid; o orders%rowtype; v_back int := 0;
begin
  select * into b from branches where slug = p_branch;
  v_id := public.fk_wa_find_order(b.id, p_phone, p_order);
  if v_id is null then return jsonb_build_object('result', 'error'); end if;
  select * into o from orders where id = v_id for update;

  if o.status::text = 'cancelled' then return jsonb_build_object('result', 'already_cancelled', 'order', public.fk_wa_order_json(v_id)); end if;
  if o.status::text = 'delivered' then return jsonb_build_object('result', 'delivered', 'order', public.fk_wa_order_json(v_id)); end if;
  if o.status::text in ('preparing', 'ready') then
    -- already cooking: only staff can cancel; leave a note in the audit log
    insert into order_audit (branch_id, order_id, order_number, action, detail, staff)
      values (b.id, v_id, o.order_number, 'cancel_requested', 'Customer asked to cancel on WhatsApp: ' || coalesce(p_reason, 'other'), 'customer (WhatsApp)');
    return jsonb_build_object('result', 'requested', 'order', public.fk_wa_order_json(v_id));
  end if;

  update orders set status = 'cancelled', cancelled_at = now(), cancelled_by = 'customer (WhatsApp)', cancel_reason = coalesce(p_reason, 'other')
   where id = v_id;
  if o.status::text <> 'draft' then
    v_back := public.fk_loyalty_refund(v_id, 'customer (WhatsApp)');
    insert into order_events (order_id, branch_id, event_type, payload)
      values (v_id, b.id, 'order_status_changed', jsonb_build_object('orderId', v_id, 'orderNumber', o.order_number,
              'branchSlug', b.slug, 'status', 'cancelled', 'previousStatus', o.status::text, 'orderType', o.order_type, 'reason', coalesce(p_reason, 'other')));
  end if;
  return jsonb_build_object('result', 'cancelled', 'order', public.fk_wa_order_json(v_id), 'points_refunded', v_back);
exception when others then
  raise warning 'customer_cancel failed: %', sqlerrm;
  return jsonb_build_object('result', 'error');
end $$;

-- ---------- permissions: service role only (n8n and the app) ----------
revoke all on function public.fk_loyalty_offer(uuid, int) from public, anon, authenticated;
revoke all on function public.fk_wa_apply_points(uuid, boolean) from public, anon, authenticated;
revoke all on function public.fk_loyalty_refund(uuid, text) from public, anon, authenticated;
revoke all on function public.customer_points(text, text, text) from public, anon, authenticated;
revoke all on function public.customer_use_points(text, text, boolean, text) from public, anon, authenticated;
revoke all on function public.fk_wa_write_items(uuid, uuid, jsonb) from public, anon, authenticated;
revoke all on function public.customer_confirm(text, text, text) from public, anon, authenticated;
revoke all on function public.customer_cancel(text, text, text, text) from public, anon, authenticated;
grant execute on function public.fk_loyalty_offer(uuid, int), public.fk_loyalty_refund(uuid, text),
  public.customer_points(text, text, text), public.customer_use_points(text, text, boolean, text),
  public.customer_confirm(text, text, text), public.customer_cancel(text, text, text, text) to service_role;

-- ============================================================
-- Check: every row should say true
-- ============================================================
select 'fk_loyalty_offer()' as item, to_regprocedure('public.fk_loyalty_offer(uuid,int)') is not null as ok
union all select 'fk_loyalty_refund()', to_regprocedure('public.fk_loyalty_refund(uuid,text)') is not null
union all select 'customer_points()', to_regprocedure('public.customer_points(text,text,text)') is not null
union all select 'customer_use_points()', to_regprocedure('public.customer_use_points(text,text,boolean,text)') is not null
union all select 'orders.loyalty_points_redeemed', exists (select 1 from information_schema.columns where table_name = 'orders' and column_name = 'loyalty_points_redeemed');
