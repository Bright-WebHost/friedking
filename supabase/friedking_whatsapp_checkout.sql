-- ============================================================
-- Fried King WhatsApp bot: one checkout function for chat orders, plus a guard against bot loops.
-- Run in the Supabase SQL Editor AFTER friedking_whatsapp_loyalty.sql. Safe to re-run. No table changes.
--
-- Chat order flow (what the customer sees):
--   1. They add / remove items      -> bot shows the current cart  [Confirm | Modify | Cancel]
--   2. Confirm                      -> customer_checkout('confirm')
--        has points to use          -> result 'ask_points'          [Use points | Not now]
--        no points                  -> order placed, result 'confirmed'
--   3. Use points                   -> customer_checkout('use_points') -> result 'final': cart with the points line
--                                                                    [Place order | Modify | Cancel]
--      Not now                      -> customer_checkout('skip_points') -> order placed at full price ('confirmed')
--   4. Place order                  -> customer_checkout('place')      -> order placed ('confirmed')
-- Changing items after choosing points keeps the points (re-capped); Confirm then places the order directly.
-- ============================================================

create or replace function public.customer_checkout(p_phone text, p_order text, p_action text, p_branch text default 'pandeshwar')
returns jsonb language plpgsql security definer set search_path = public as $$
declare b branches%rowtype; v_id uuid; o orders%rowtype; v_off jsonb; v_action text := lower(coalesce(p_action, ''));
begin
  select * into b from branches where slug = p_branch;
  if not found then return jsonb_build_object('result', 'error'); end if;
  v_id := public.fk_wa_find_order(b.id, p_phone, p_order);
  if v_id is null then return jsonb_build_object('result', 'error'); end if;
  select * into o from orders where id = v_id;

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

-- ============================================================
-- Loop guard: should the bot answer this number with a greeting / AI reply?
-- Riders only use the "Payment collected" button (handle that BEFORE calling this), and a number that the bot has
-- already answered many times in a few minutes is probably another bot (two bots replying to each other forever).
-- ============================================================
create or replace function public.bot_guard(p_phone text, p_branch text default 'pandeshwar')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b branches%rowtype; v_phone text := public.fk_wa_phone(p_phone); v_recent int; v_rider boolean;
begin
  select * into b from branches where slug = p_branch;
  if not found then return jsonb_build_object('reply', true); end if;
  select exists (select 1 from riders r where r.branch_id = b.id and public.fk_wa_phone(r.phone) = v_phone) into v_rider;
  if v_rider then return jsonb_build_object('reply', false, 'reason', 'rider'); end if;
  select count(*) into v_recent from chat_messages
   where branch_id = b.id and phone = v_phone and direction = 'outbound' and sender in ('ai', 'system')
     and created_at > now() - interval '3 minutes';
  if v_recent >= 8 then return jsonb_build_object('reply', false, 'reason', 'too_many_replies'); end if;
  return jsonb_build_object('reply', true);
end $$;

revoke all on function public.customer_checkout(text, text, text, text) from public, anon, authenticated;
revoke all on function public.bot_guard(text, text) from public, anon, authenticated;
grant execute on function public.customer_checkout(text, text, text, text), public.bot_guard(text, text) to service_role;

select 'customer_checkout()' as item, to_regprocedure('public.customer_checkout(text,text,text,text)') is not null as ok
union all select 'bot_guard()', to_regprocedure('public.bot_guard(text,text)') is not null
union all select 'fk_wa_apply_points() (needs friedking_whatsapp_loyalty.sql)', to_regprocedure('public.fk_wa_apply_points(uuid,boolean)') is not null;
