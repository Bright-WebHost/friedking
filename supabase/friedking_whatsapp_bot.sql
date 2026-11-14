-- ============================================================
-- Fried King WhatsApp bot (n8n "Fried King | Main") database layer.
-- Run in the Supabase SQL Editor AFTER friedking_dashboard_oceana.sql. Safe to re-run.
--
-- The Main workflow was copied from Oceana and called Oceana's tables and functions
-- (messages, chat_context, customer_confirm, customer_cancel, customer_amend, ...).
-- This file provides the Fried King versions of those, on Fried King's own tables:
--   * chat is stored in chat_messages / chat_sessions (what the dashboard's Live Chat reads)
--   * an order the customer is still building is an `orders` row with status 'draft'
--     (the dashboard hides drafts); confirming it makes it 'pending' = "new order" popup
--   * confirming / cancelling / amending write the same order_events rows as the website
--
-- The bot serves ONE branch (default 'pandeshwar', the number 9742175222). When another
-- branch gets its own WhatsApp number, pass p_branch from that branch's workflow.
-- ============================================================

-- A draft is an order the customer has not confirmed yet.
alter type public.order_status add value if not exists 'draft';

-- ---------- chat: message id (duplicate protection), type, phone format, sessions ----------
alter table public.chat_messages
  add column if not exists message_id   text,
  add column if not exists message_type text not null default 'text';
create unique index if not exists chat_messages_message_id_key
  on public.chat_messages(message_id) where message_id is not null;

-- ---------- WhatsApp delivery receipts written back by the workflow ----------
alter table public.customers
  add column if not exists blast_status     text,
  add column if not exists blast_message_id text,
  add column if not exists blast_read_at    timestamptz;
alter table public.orders
  add column if not exists order_notify_status  text,
  add column if not exists order_wa_message_id  text,
  add column if not exists rider_notify_status  text,
  add column if not exists rider_wa_message_id  text;

-- keeps the order of dishes as the customer asked for them
alter table public.order_items add column if not exists line_no int not null default 0;

-- ---------- helpers ----------
-- "919742175222", "+91 97421 75222", "09742175222" -> "+919742175222"
create or replace function public.fk_wa_phone(p text)
returns text language sql immutable as $$
  select '+91' || right(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 10)
$$;

-- Chat messages are always stored with the +91 form so Live Chat and the bot agree.
create or replace function public.fk_chat_message_before() returns trigger
language plpgsql as $$
begin
  new.phone := public.fk_wa_phone(new.phone);
  return new;
end $$;

-- Every message updates the conversation list (last message, unread count) for Live Chat.
create or replace function public.fk_chat_message_after() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into chat_sessions (branch_id, phone, customer_name, last_message, last_message_at, unread_count)
  values (new.branch_id, new.phone,
          (select name from customers c where c.branch_id = new.branch_id and c.phone = new.phone),
          left(new.content, 200), new.created_at, case when new.direction = 'inbound' then 1 else 0 end)
  on conflict (branch_id, phone) do update set
    last_message = left(new.content, 200),
    last_message_at = new.created_at,
    unread_count = chat_sessions.unread_count + case when new.direction = 'inbound' then 1 else 0 end,
    customer_name = coalesce(chat_sessions.customer_name, excluded.customer_name);
  return new;
end $$;

drop trigger if exists fk_chat_message_before on public.chat_messages;
create trigger fk_chat_message_before before insert on public.chat_messages
  for each row execute function public.fk_chat_message_before();
drop trigger if exists fk_chat_message_after on public.chat_messages;
create trigger fk_chat_message_after after insert on public.chat_messages
  for each row execute function public.fk_chat_message_after();

-- One order as the workflow sees it (rupees, text order number, Oceana-style status names).
create or replace function public.fk_wa_order_json(p_order_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'order_number', 'FK-' || o.order_number,
    'status', case o.status::text
                when 'pending' then 'new'
                when 'ready' then case when o.order_type = 'delivery' then 'out_for_delivery' else 'ready_for_pickup' end
                else o.status::text end,
    'order_type', case o.order_type when 'pickup' then 'takeaway' else o.order_type end,
    'items', coalesce((select string_agg(i.name_snapshot || ' x' || i.quantity, ', ' order by i.line_no, i.name_snapshot)
                       from order_items i where i.order_id = o.id), ''),
    'items_json', coalesce((select jsonb_agg(jsonb_build_object('name', i.name_snapshot, 'quantity', i.quantity,
                                   'price', i.unit_price_paise / 100.0) order by i.line_no, i.name_snapshot)
                            from order_items i where i.order_id = o.id), '[]'::jsonb),
    'total', o.total_paise / 100.0,
    'created_at', o.created_at,
    'customer_name', c.name,
    'customer_phone', ltrim(c.phone, '+'),
    'address', o.delivery_address,
    'pincode', o.delivery_pincode,
    'landmark', '',
    'amendment_count', o.amendment_count,
    'cash_amount', o.total_paise / 100.0)
  into r
  from orders o join customers c on c.id = o.customer_id
  where o.id = p_order_id;
  return r;
end $$;

-- Which order does the customer mean? "FK-1042" or "1042", scoped to their phone.
create or replace function public.fk_wa_find_order(p_branch uuid, p_phone text, p_order text)
returns uuid language plpgsql stable security definer set search_path = public as $$
declare v_num bigint; v_id uuid;
begin
  v_num := nullif(regexp_replace(coalesce(p_order, ''), '\D', '', 'g'), '')::bigint;
  if v_num is null then return null; end if;
  select o.id into v_id from orders o join customers c on c.id = o.customer_id
   where o.branch_id = p_branch and c.phone = public.fk_wa_phone(p_phone) and o.order_number = v_num;
  return v_id;
end $$;

-- ============================================================
-- chat_context: everything the bot needs before it answers.
-- ============================================================
create or replace function public.chat_context(p_phone text, p_order text default null, p_branch text default 'pandeshwar')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  b branches%rowtype;
  v_phone text := public.fk_wa_phone(p_phone);
  v_set jsonb; v_menu text := ''; v_last text; r record;
  v_open uuid; v_active uuid; v_session jsonb; v_customer jsonb;
begin
  select * into b from branches where slug = p_branch;
  if not found then return jsonb_build_object('settings', '{}'::jsonb); end if;

  -- settings: defaults, then branch facts, then anything saved in Dashboard > Settings
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_set
    from branch_settings where branch_id = b.id and coalesce(value, '') <> '';
  v_set := jsonb_build_object(
      'restaurant_name', 'Fried King',
      'address', coalesce(b.address, ''),
      'phone', coalesce(b.phone, case when v_set ? 'whatsapp_number' then '+91 ' || (v_set->>'whatsapp_number') end, ''),
      'hours', case when b.opens_at is not null and b.closes_at is not null
                    then to_char(b.opens_at, 'FMHH12:MI AM') || ' to ' || to_char(b.closes_at, 'FMHH12:MI AM') else '' end,
      'cuisines', 'Fried chicken, burgers, wraps, sandwiches and sides',
      'delivery_time', '30 to 40 minutes',
      'menu_url', 'https://friedking.vercel.app/')
    || v_set;

  -- menu digest "Name|price" (rupees); "## Category" lines are headings the order parser skips
  for r in
    select mc.name as cat, mi.name, mi.price_paise
      from menu_items mi join menu_categories mc on mc.id = mi.category_id
     where mi.branch_id = b.id and mi.is_active and mc.is_active
     order by mc.sort_order, mc.name, mi.sort_order, mi.name
  loop
    if r.cat is distinct from v_last then v_menu := v_menu || E'\n## ' || r.cat || E'\n'; v_last := r.cat; end if;
    v_menu := v_menu || r.name || '|' || trim_scale((r.price_paise / 100.0)::numeric)::text || E'\n';
  end loop;

  -- the order the customer can still change (or the one a button points at)
  if coalesce(p_order, '') <> '' then
    v_open := public.fk_wa_find_order(b.id, p_phone, p_order);
  end if;
  if v_open is null then
    select o.id into v_open from orders o join customers c on c.id = o.customer_id
     where o.branch_id = b.id and c.phone = v_phone and o.accepted_at is null
       and o.status in ('draft', 'pending', 'confirmed')
       and (o.status::text <> 'draft' or o.created_at > now() - interval '60 minutes')
     order by o.created_at desc limit 1;
  end if;
  -- an order already with the kitchen (cannot be changed)
  select o.id into v_active from orders o join customers c on c.id = o.customer_id
   where o.branch_id = b.id and c.phone = v_phone and o.status in ('preparing', 'ready')
     and o.created_at > now() - interval '12 hours' and o.id is distinct from v_open
   order by o.created_at desc limit 1;

  select jsonb_build_object('ai_enabled', s.ai_enabled) into v_session
    from chat_sessions s where s.branch_id = b.id and s.phone = v_phone;
  select jsonb_build_object('name', c.name, 'total_orders',
           (select count(*) from orders o where o.customer_id = c.id and o.status::text not in ('draft', 'cancelled')))
    into v_customer from customers c where c.branch_id = b.id and c.phone = v_phone;

  return jsonb_build_object(
    'settings', v_set,
    'session', v_session,
    'customer', v_customer,
    'open_order', case when v_open is null then null else public.fk_wa_order_json(v_open) end,
    'active_order', case when v_active is null then null else public.fk_wa_order_json(v_active) end,
    'menu', v_menu,
    'pincodes', coalesce((select jsonb_agg(pincode order by pincode) from delivery_pincodes where branch_id = b.id and is_active), '[]'::jsonb),
    'promos', coalesce((select jsonb_agg(jsonb_build_object('title', p.title, 'price', coalesce(p.description, '')) order by p.created_at desc)
                          from menu_promotions p
                         where p.branch_id = b.id and p.is_active
                           and (p.starts_at is null or p.starts_at <= current_date)
                           and (p.ends_at is null or p.ends_at >= current_date)), '[]'::jsonb),
    'history', coalesce((select jsonb_agg(jsonb_build_object('direction', m.direction, 'content', m.content) order by m.created_at)
                           from (select * from chat_messages where branch_id = b.id and phone = v_phone
                                  order by created_at desc limit 10) m), '[]'::jsonb));
end $$;

-- ============================================================
-- Draft / amend: items are matched to the real menu by name, prices come from the database.
-- ============================================================
create or replace function public.fk_wa_write_items(p_order uuid, p_branch uuid, p_items jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare it jsonb; m record; n int := 0; sub int := 0; qty int;
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
         total_paise = sub + round(sub * 0.05)::int
   where id = p_order;
end $$;

create or replace function public.customer_draft(p_phone text, p_name text, p_items jsonb, p_type text default 'delivery', p_branch text default 'pandeshwar')
returns jsonb language plpgsql security definer set search_path = public as $$
declare b branches%rowtype; v_phone text := public.fk_wa_phone(p_phone); v_cust uuid; v_id uuid; v_type text;
begin
  select * into b from branches where slug = p_branch;
  if not found then return jsonb_build_object('result', 'error'); end if;
  v_type := case lower(coalesce(p_type, '')) when 'takeaway' then 'pickup' when 'pickup' then 'pickup' when 'dine-in' then 'dine-in' else 'delivery' end;

  insert into customers (branch_id, phone, name, source) values (b.id, v_phone, nullif(trim(p_name), ''), 'whatsapp')
    on conflict (branch_id, phone) do update set name = coalesce(customers.name, excluded.name)
    returning id into v_cust;

  insert into orders (branch_id, customer_id, status, source, order_type, payment_method, delivery_address, idempotency_key)
    values (b.id, v_cust, 'draft', 'whatsapp', v_type, 'cash',
            case when v_type = 'delivery' then 'Address to be confirmed with the customer on WhatsApp' end,
            'wa-' || gen_random_uuid())
    returning id into v_id;
  perform public.fk_wa_write_items(v_id, b.id, p_items);
  return jsonb_build_object('result', 'created', 'order', public.fk_wa_order_json(v_id));
exception when others then
  raise warning 'customer_draft failed: %', sqlerrm;
  return jsonb_build_object('result', 'error');
end $$;

create or replace function public.customer_amend(p_phone text, p_order text, p_items jsonb, p_total numeric default null, p_branch text default 'pandeshwar')
returns jsonb language plpgsql security definer set search_path = public as $$
declare b branches%rowtype; v_id uuid; o orders%rowtype; v_before text; v_after text;
begin
  select * into b from branches where slug = p_branch;
  v_id := public.fk_wa_find_order(b.id, p_phone, p_order);
  if v_id is null then return jsonb_build_object('result', 'locked'); end if;
  select * into o from orders where id = v_id for update;

  if o.status::text = 'draft' then
    perform public.fk_wa_write_items(v_id, b.id, p_items);
    return jsonb_build_object('result', 'updated_draft', 'order', public.fk_wa_order_json(v_id));
  elsif o.status::text in ('pending', 'confirmed') and o.accepted_at is null then
    v_before := public.fk_wa_order_json(v_id)->>'items';
    perform public.fk_wa_write_items(v_id, b.id, p_items);
    update orders set amendment_count = amendment_count + 1, amended_at = now() where id = v_id;
    v_after := public.fk_wa_order_json(v_id)->>'items';
    insert into order_events (order_id, branch_id, event_type, payload)
      values (v_id, b.id, 'order_amended', jsonb_build_object('orderId', v_id, 'orderNumber', o.order_number,
              'branchSlug', b.slug, 'totalPaise', (select total_paise from orders where id = v_id), 'items', v_after, 'previousItems', v_before));
    insert into order_audit (branch_id, order_id, order_number, action, detail, staff)
      values (b.id, v_id, o.order_number, 'edit_items', v_before || ' -> ' || v_after, 'customer (WhatsApp)');
    return jsonb_build_object('result', 'amended', 'order',
      public.fk_wa_order_json(v_id) || jsonb_build_object('original_items', v_before));
  end if;
  return jsonb_build_object('result', 'locked', 'order', public.fk_wa_order_json(v_id));
exception when others then
  raise warning 'customer_amend failed: %', sqlerrm;
  return jsonb_build_object('result', 'error');
end $$;

-- ============================================================
-- Confirm / cancel
-- ============================================================
create or replace function public.customer_confirm(p_phone text, p_order text, p_branch text default 'pandeshwar')
returns jsonb language plpgsql security definer set search_path = public as $$
declare b branches%rowtype; v_id uuid; o orders%rowtype; c customers%rowtype; v_items jsonb;
begin
  select * into b from branches where slug = p_branch;
  v_id := public.fk_wa_find_order(b.id, p_phone, p_order);
  if v_id is null then return jsonb_build_object('result', 'error'); end if;
  select * into o from orders where id = v_id for update;
  if o.status::text = 'cancelled' then return jsonb_build_object('result', 'cancelled', 'order', public.fk_wa_order_json(v_id)); end if;
  if o.status::text in ('preparing', 'ready', 'delivered') then return jsonb_build_object('result', 'in_progress', 'order', public.fk_wa_order_json(v_id)); end if;
  if o.status::text <> 'draft' then return jsonb_build_object('result', 'already', 'order', public.fk_wa_order_json(v_id)); end if;
  if o.created_at < now() - interval '60 minutes' then return jsonb_build_object('result', 'expired', 'order', public.fk_wa_order_json(v_id)); end if;

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
      'items', coalesce(v_items, '[]'::jsonb), 'subtotalPaise', o.subtotal_paise, 'gstPaise', o.gst_paise, 'totalPaise', o.total_paise));
  return jsonb_build_object('result', 'confirmed', 'order', public.fk_wa_order_json(v_id));
exception when others then
  raise warning 'customer_confirm failed: %', sqlerrm;
  return jsonb_build_object('result', 'error');
end $$;

create or replace function public.customer_cancel(p_phone text, p_order text, p_reason text default 'other', p_branch text default 'pandeshwar')
returns jsonb language plpgsql security definer set search_path = public as $$
declare b branches%rowtype; v_id uuid; o orders%rowtype;
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
    insert into order_events (order_id, branch_id, event_type, payload)
      values (v_id, b.id, 'order_status_changed', jsonb_build_object('orderId', v_id, 'orderNumber', o.order_number,
              'branchSlug', b.slug, 'status', 'cancelled', 'previousStatus', o.status::text, 'orderType', o.order_type, 'reason', coalesce(p_reason, 'other')));
  end if;
  return jsonb_build_object('result', 'cancelled', 'order', public.fk_wa_order_json(v_id));
exception when others then
  raise warning 'customer_cancel failed: %', sqlerrm;
  return jsonb_build_object('result', 'error');
end $$;

-- Receipt Image workflow: one order in the shape its template reads (paid / table number included).
create or replace function public.receipt_order(p_order text, p_branch text default 'pandeshwar')
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare b branches%rowtype; v_num bigint; v_id uuid;
begin
  select * into b from branches where slug = p_branch;
  v_num := nullif(regexp_replace(coalesce(p_order, ''), '\D', '', 'g'), '')::bigint;
  select o.id into v_id from orders o where o.branch_id = b.id and o.order_number = v_num and o.status::text <> 'draft';
  if v_id is null then return '{}'::jsonb; end if;
  return public.fk_wa_order_json(v_id) || (
    select jsonb_build_object('payment_status', case when o.cash_collected then 'paid' else 'pending' end, 'table_number', o.table_number)
      from orders o where o.id = v_id);
end $$;

-- Riders do not have a WhatsApp "Payment collected" button yet; answers "not found" until they do.
create or replace function public.rider_confirm_payment(p_message_id text)
returns jsonb language sql stable as $$ select jsonb_build_object('result', 'not_found') $$;

-- ---------- access: the workflow uses the service key only ----------
revoke all on function public.chat_context(text, text, text) from public, anon, authenticated;
revoke all on function public.customer_draft(text, text, jsonb, text, text) from public, anon, authenticated;
revoke all on function public.customer_amend(text, text, jsonb, numeric, text) from public, anon, authenticated;
revoke all on function public.customer_confirm(text, text, text) from public, anon, authenticated;
revoke all on function public.customer_cancel(text, text, text, text) from public, anon, authenticated;
revoke all on function public.rider_confirm_payment(text) from public, anon, authenticated;
revoke all on function public.receipt_order(text, text) from public, anon, authenticated;
revoke all on function public.fk_wa_order_json(uuid) from public, anon, authenticated;
revoke all on function public.fk_wa_find_order(uuid, text, text) from public, anon, authenticated;
revoke all on function public.fk_wa_write_items(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function public.chat_context(text, text, text), public.customer_draft(text, text, jsonb, text, text),
  public.customer_amend(text, text, jsonb, numeric, text), public.customer_confirm(text, text, text),
  public.customer_cancel(text, text, text, text), public.rider_confirm_payment(text), public.receipt_order(text, text) to service_role;

-- ============================================================
-- Check: every row should say true
-- ============================================================
select 'chat_context()' as item, to_regprocedure('public.chat_context(text,text,text)') is not null as ok
union all select 'customer_draft()', to_regprocedure('public.customer_draft(text,text,jsonb,text,text)') is not null
union all select 'customer_confirm()', to_regprocedure('public.customer_confirm(text,text,text)') is not null
union all select 'draft status', exists (select 1 from pg_enum e join pg_type t on t.oid = e.enumtypid where t.typname = 'order_status' and e.enumlabel = 'draft')
union all select 'chat_messages.message_id', exists (select 1 from information_schema.columns where table_name = 'chat_messages' and column_name = 'message_id');
