-- ============================================================
-- Fried King: daily SHIFT CLOSING REPORT sent on WhatsApp. Safe to re-run. Functions + default settings only (no table changes).
-- Run in the Supabase SQL Editor AFTER friedking_whatsapp_bot.sql.
--
-- How it works (same outbox pattern as the rest of the system):
--   Dashboard > Settings > Shift closing report   -> switch, time (IST) and WhatsApp numbers, stored in branch_settings
--   n8n "Fried King | Shift Report" (every minute) -> claim_shift_report(): returns the report once, when the time has come
--                                                    -> sends it to every number (plain text inside the 24-hour window,
--                                                       the approved template friedking_shift_report outside it)
--                                                    -> complete_shift_report() saves what happened (shown in Settings)
-- The report covers everything since the previous report (or since midnight IST for the first one). "Send report now" in Settings
-- sends one straight away without disturbing the scheduled one.
-- ============================================================

-- Defaults for Pandeshwar (only inserted when not set yet; change them in Dashboard > Settings afterwards)
insert into public.branch_settings (branch_id, key, value)
select b.id, v.key, v.value
  from public.branches b
  cross join (values ('shift_report_enabled', 'true'), ('shift_report_time', '23:45'), ('shift_report_numbers', '9852225222, 9180108354')) as v(key, value)
 where b.slug = 'pandeshwar'
on conflict (branch_id, key) do nothing;

-- Rupee text with thousands separators: 1845000 paise -> "Rs 18,450"
create or replace function public.fk_rs(p_paise numeric)
returns text language sql immutable as $$ select 'Rs ' || to_char(round(coalesce(p_paise, 0) / 100.0), 'FM999,999,999') $$;

create or replace function public.claim_shift_report(p_branch text default 'pandeshwar')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b branches%rowtype; v_set jsonb; v_now timestamptz := now();
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
  v_enabled boolean; v_time time; v_nums text[]; v_force boolean; v_last_at timestamptz; v_from timestamptz;
  r record; v_orders int; v_sales numeric; v_gst numeric; v_cancel_n int; v_cancel_v numeric; v_cash numeric; v_pending_cash numeric; v_disc numeric;
  v_open_new int; v_open_kitchen int;
  v_by_type jsonb; v_by_src jsonb; v_top text; v_staff text; v_label text; v_period text; v_text text; v_split text; v_top1 text;
  v_rec jsonb;
begin
  select * into b from branches where slug = p_branch;
  if not found then return jsonb_build_object('send', false, 'reason', 'unknown branch'); end if;

  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_set from branch_settings where branch_id = b.id and key like 'shift_report_%';
  v_force := coalesce(v_set->>'shift_report_force', '') = '1';
  v_enabled := coalesce(v_set->>'shift_report_enabled', 'false') = 'true';
  begin v_time := coalesce(nullif(trim(v_set->>'shift_report_time'), ''), '23:45')::time; exception when others then v_time := '23:45'::time; end;
  -- numbers are separated by commas, semicolons or new lines; spaces, +91 and dashes inside a number are fine
  select coalesce(array_agg(distinct '91' || right(d, 10)), '{}') into v_nums
    from (select regexp_replace(t, '[^0-9]', '', 'g') as d
            from unnest(regexp_split_to_array(coalesce(v_set->>'shift_report_numbers', ''), E'[,;\n]+')) t) x
   where length(d) >= 10 and right(d, 10) ~ '^[6-9][0-9]{9}$';

  if not v_force then
    if not v_enabled or cardinality(v_nums) = 0 then return jsonb_build_object('send', false, 'reason', 'off'); end if;
    if (now() at time zone 'Asia/Kolkata')::time < v_time then return jsonb_build_object('send', false, 'reason', 'not yet'); end if;
    if v_set->>'shift_report_last_day' = v_today::text then return jsonb_build_object('send', false, 'reason', 'already sent today'); end if;
  elsif cardinality(v_nums) = 0 then
    delete from branch_settings where branch_id = b.id and key = 'shift_report_force';
    insert into branch_settings (branch_id, key, value) values (b.id, 'shift_report_last_status', 'Not sent: add at least one valid WhatsApp number in Settings.')
      on conflict (branch_id, key) do update set value = excluded.value, updated_at = now();
    return jsonb_build_object('send', false, 'reason', 'no numbers');
  end if;

  v_last_at := nullif(v_set->>'shift_report_last_at', '')::timestamptz;
  v_from := greatest(coalesce(v_last_at, (v_today::timestamp at time zone 'Asia/Kolkata')), v_now - interval '48 hours');

  -- the numbers
  select count(*) filter (where status::text not in ('cancelled')), coalesce(sum(total_paise) filter (where status::text <> 'cancelled'), 0),
         coalesce(sum(gst_paise) filter (where status::text <> 'cancelled'), 0),
         count(*) filter (where status::text = 'cancelled'), coalesce(sum(total_paise) filter (where status::text = 'cancelled'), 0),
         coalesce(sum(coalesce(cash_amount_paise, total_paise)) filter (where status::text <> 'cancelled' and cash_collected), 0),
         coalesce(sum(total_paise) filter (where status::text in ('preparing', 'ready', 'delivered') and not cash_collected), 0),
         coalesce(sum(coalesce(discount_paise, 0) + coalesce(loyalty_discount_paise, 0)) filter (where status::text <> 'cancelled'), 0),
         count(*) filter (where status::text in ('pending', 'confirmed')), count(*) filter (where status::text in ('preparing', 'ready'))
    into v_orders, v_sales, v_gst, v_cancel_n, v_cancel_v, v_cash, v_pending_cash, v_disc, v_open_new, v_open_kitchen
    from orders where branch_id = b.id and created_at >= v_from and created_at < v_now and status::text <> 'draft';

  select coalesce(jsonb_object_agg(t, jsonb_build_object('n', n, 'paise', s)), '{}'::jsonb) into v_by_type
    from (select order_type::text t, count(*) n, sum(total_paise) s from orders
           where branch_id = b.id and created_at >= v_from and created_at < v_now and status::text not in ('draft', 'cancelled') group by 1) x;
  select coalesce(jsonb_object_agg(t, n), '{}'::jsonb) into v_by_src
    from (select coalesce(source, 'web') t, count(*) n from orders
           where branch_id = b.id and created_at >= v_from and created_at < v_now and status::text not in ('draft', 'cancelled') group by 1) x;
  select string_agg(name || ' x' || q, ', ' order by q desc, name), (array_agg(name || ' x' || q order by q desc, name))[1] into v_top, v_top1
    from (select i.name_snapshot as name, sum(i.quantity) q from order_items i join orders o on o.id = i.order_id
           where o.branch_id = b.id and o.created_at >= v_from and o.created_at < v_now and o.status::text not in ('draft', 'cancelled')
           group by 1 order by sum(i.quantity) desc, 1 limit 3) t;
  select string_agg(who || ' ' || n || ' (' || public.fk_rs(s) || ')', ', ' order by n desc, who) into v_staff
    from (select taken_by as who, count(*) n, sum(total_paise) s from orders
           where branch_id = b.id and created_at >= v_from and created_at < v_now and status::text not in ('draft', 'cancelled') and nullif(trim(taken_by), '') is not null
           group by 1) x;

  v_label := to_char(v_today, 'DD Mon YYYY');
  v_period := to_char(v_from at time zone 'Asia/Kolkata', 'DD Mon HH12:MI AM') || ' to ' || to_char(v_now at time zone 'Asia/Kolkata', 'DD Mon HH12:MI AM');
  v_split := 'Delivery ' || coalesce((v_by_type->'delivery'->>'n'), '0') || ', Takeaway ' || coalesce((v_by_type->'pickup'->>'n'), '0') || ', Dine-in ' || coalesce((v_by_type->'dine-in'->>'n'), '0');

  v_text := E'📊 *Fried King - Shift report*\n' || b.name || E'\n' || v_period || E'\n\n' ||
    '*Orders:* ' || v_orders || E'   *Sales:* ' || public.fk_rs(v_sales) || E'\n' ||
    case when v_orders > 0 then 'Average order: ' || public.fk_rs(v_sales / v_orders) || ' · GST included: ' || public.fk_rs(v_gst) || E'\n' else '' end ||
    E'\n🛵 Delivery: ' || coalesce(v_by_type->'delivery'->>'n', '0') || ' · ' || public.fk_rs((v_by_type->'delivery'->>'paise')::numeric) ||
    E'\n🛍 Takeaway: ' || coalesce(v_by_type->'pickup'->>'n', '0') || ' · ' || public.fk_rs((v_by_type->'pickup'->>'paise')::numeric) ||
    E'\n🍽 Dine-in: ' || coalesce(v_by_type->'dine-in'->>'n', '0') || ' · ' || public.fk_rs((v_by_type->'dine-in'->>'paise')::numeric) ||
    E'\n\nFrom: WhatsApp ' || coalesce(v_by_src->>'whatsapp', '0') || ' · Website ' || coalesce(v_by_src->>'web', '0') || ' · POS ' || coalesce(v_by_src->>'pos', '0') ||
    E'\n\n💵 Cash collected: ' || public.fk_rs(v_cash) || E'\nStill to collect: ' || public.fk_rs(v_pending_cash) ||
    E'\n❌ Cancelled: ' || v_cancel_n || case when v_cancel_n > 0 then ' (' || public.fk_rs(v_cancel_v) || ')' else '' end ||
    case when v_disc > 0 then E'\n🎁 Discounts and points: ' || public.fk_rs(v_disc) else '' end ||
    case when v_top is not null then E'\n\n⭐ Top items: ' || v_top else '' end ||
    case when v_staff is not null then E'\n👤 By staff (POS): ' || v_staff else '' end ||
    case when v_open_new + v_open_kitchen > 0 then E'\n\n⚠ Still open now: ' || v_open_new || ' waiting to be accepted, ' || v_open_kitchen || ' in the kitchen' else '' end;

  -- recipients, and whether each is inside the free 24-hour reply window
  select coalesce(jsonb_agg(jsonb_build_object('phone', n, 'in_window', exists (
           select 1 from chat_messages m where m.branch_id = b.id and m.phone = public.fk_wa_phone(n) and m.direction = 'inbound' and m.created_at > now() - interval '24 hours'))), '[]'::jsonb)
    into v_rec from unnest(v_nums) n;

  -- mark it: window start for the next report, clear the "send now" flag; scheduled runs also remember the day
  insert into branch_settings (branch_id, key, value) values (b.id, 'shift_report_last_at', v_now::text)
    on conflict (branch_id, key) do update set value = excluded.value, updated_at = now();
  if not v_force then
    insert into branch_settings (branch_id, key, value) values (b.id, 'shift_report_last_day', v_today::text)
      on conflict (branch_id, key) do update set value = excluded.value, updated_at = now();
  end if;
  delete from branch_settings where branch_id = b.id and key = 'shift_report_force';
  insert into branch_settings (branch_id, key, value) values (b.id, 'shift_report_last_status', 'Sending... (' || v_period || ')')
    on conflict (branch_id, key) do update set value = excluded.value, updated_at = now();

  return jsonb_build_object('send', true, 'forced', v_force, 'recipients', v_rec, 'text', v_text,
    'template', jsonb_build_object('name', 'friedking_shift_report', 'params', jsonb_build_array(
      v_label, v_orders::text, public.fk_rs(v_sales), v_split, public.fk_rs(v_cash),
      v_cancel_n::text || case when v_cancel_n > 0 then ' (' || public.fk_rs(v_cancel_v) || ')' else '' end, coalesce(v_top1, 'none'))),
    'report', jsonb_build_object('from', v_from, 'to', v_now, 'orders', v_orders, 'sales_paise', v_sales, 'cancelled', v_cancel_n, 'cash_paise', v_cash));
end $$;

-- n8n reports what happened; Settings shows it ("Last report: ...")
create or replace function public.complete_shift_report(p_branch text, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare b branches%rowtype;
begin
  select * into b from branches where slug = p_branch;
  if not found then return; end if;
  insert into branch_settings (branch_id, key, value) values (b.id, 'shift_report_last_status',
    to_char(now() at time zone 'Asia/Kolkata', 'DD Mon HH12:MI AM') || ' - ' || left(coalesce(p_status, ''), 400))
    on conflict (branch_id, key) do update set value = excluded.value, updated_at = now();
end $$;

revoke all on function public.claim_shift_report(text) from public, anon, authenticated;
revoke all on function public.complete_shift_report(text, text) from public, anon, authenticated;
revoke all on function public.fk_rs(numeric) from public, anon, authenticated;
grant execute on function public.claim_shift_report(text), public.complete_shift_report(text, text), public.fk_rs(numeric) to service_role;

select 'claim_shift_report()' as item, to_regprocedure('public.claim_shift_report(text)') is not null as ok
union all select 'complete_shift_report()', to_regprocedure('public.complete_shift_report(text,text)') is not null
union all select 'defaults saved', (select count(*) from public.branch_settings where key like 'shift_report_%') >= 3;
