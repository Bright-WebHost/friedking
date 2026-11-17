-- ============================================================
-- Fried King order notifier (n8n "Fried King | Order Events").
-- Run in the Supabase SQL Editor AFTER friedking_whatsapp_bot.sql. Safe to re-run.
--
-- The dashboard writes an `order_status_changed` row to order_events whenever staff accept,
-- ready, deliver or cancel an order. n8n polls with claim_order_events(), messages the customer
-- on WhatsApp (receipt image when the order is accepted) and reports back with complete_order_event().
-- ============================================================

-- Hand out up to p_limit events for n8n to send. These kinds are handled:
--   order_status_changed      accepted / ready / delivered / cancelled customer messages
--   table_invoice_requested   the table was closed and paid -> receipt image of the whole table
--   rider_assigned            template message to the rider with a "Payment collected" button
--   customer_rider_assigned   on-the-way message to the customer (inside 24 h only)
--   order_created             table round update only, identified by customerNotification.kind
-- Each is claimed once; a claim that never completed (n8n crashed) is retried after 5 minutes, at most 3 times.
-- Events older than 30 minutes are not sent (a customer should not get "accepted" an hour late).
create or replace function public.claim_order_events(p_branch text default 'pandeshwar', p_limit int default 10)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b branches%rowtype; v_ids uuid[]; r jsonb;
begin
  select * into b from branches where slug = p_branch;
  if not found then return '[]'::jsonb; end if;

  update order_events set status = 'failed', error_message = 'expired: older than 30 minutes when picked up'
   where branch_id = b.id and (
     event_type in ('order_status_changed', 'table_invoice_requested', 'rider_assigned', 'customer_rider_assigned')
     or (event_type = 'order_created' and payload->'customerNotification'->>'kind' = 'table_round_added')
   ) and status = 'pending'
     and created_at < now() - interval '30 minutes';
  update order_events set status = 'failed', error_message = coalesce(error_message, 'gave up after 3 tries')
   where branch_id = b.id and (
     event_type in ('order_status_changed', 'table_invoice_requested', 'rider_assigned', 'customer_rider_assigned')
     or (event_type = 'order_created' and payload->'customerNotification'->>'kind' = 'table_round_added')
   ) and status = 'claimed'
     and claimed_at < now() - interval '5 minutes' and retry_count >= 3;

  select array_agg(id) into v_ids from (
    select id from order_events
     where branch_id = b.id and (
       event_type in ('order_status_changed', 'table_invoice_requested', 'rider_assigned', 'customer_rider_assigned')
       or (event_type = 'order_created' and payload->'customerNotification'->>'kind' = 'table_round_added')
     )
       and (status = 'pending' or (status = 'claimed' and claimed_at < now() - interval '5 minutes' and retry_count < 3))
     order by created_at limit p_limit for update skip locked) s;
  if v_ids is null then return '[]'::jsonb; end if;

  update order_events set status = 'claimed', claimed_by = 'n8n', claimed_at = now(), retry_count = retry_count + 1
   where id = any(v_ids);

  select coalesce(jsonb_agg(x.j order by x.created_at), '[]'::jsonb) into r from (
    select e.created_at, jsonb_build_object(
      'event_id', e.id,
      'event_type', e.event_type,
      'order_id', o.id,
      'status', e.payload->>'status',
      'customer_notification', e.payload->'customerNotification',
      'prep_minutes', e.payload->>'prepMinutes',
      'reason', e.payload->>'reason',
      'session_id', e.payload->>'sessionId',
      'table_number', coalesce(e.payload->>'tableNumber', o.table_number::text),
      'customer_name', c.name,
      -- who to message: the table payer for a table bill, the rider for a dispatch, otherwise the customer
      'phone', case e.event_type
                 when 'rider_assigned' then regexp_replace(coalesce(e.payload->>'riderPhone', ''), '\D', '', 'g')
                 when 'table_invoice_requested' then ltrim(public.fk_wa_phone(coalesce(nullif(e.payload->>'phone', ''), c.phone)), '+')
                 else ltrim(c.phone, '+') end,
      'rider_name', e.payload->>'riderName',
      'rider_phone', e.payload->>'riderPhone',
      'customer_phone', c.phone,
      'amount', coalesce((e.payload->>'amountPaise')::numeric, o.total_paise) / 100.0,
      'source', o.source,
      -- WhatsApp only allows free-form messages within 24 hours of the person's last message
      'in_window', exists (select 1 from chat_messages m where m.branch_id = b.id
                            and m.phone = case e.event_type when 'table_invoice_requested' then public.fk_wa_phone(coalesce(nullif(e.payload->>'phone', ''), c.phone)) else c.phone end
                            and m.direction = 'inbound' and m.created_at > now() - interval '24 hours'),
      'order', public.fk_wa_order_json(o.id)) as j
    from order_events e join orders o on o.id = e.order_id join customers c on c.id = o.customer_id
   where e.id = any(v_ids)) x;
  return r;
end $$;

-- Mark an event done or failed. p_message_id is the WhatsApp message id of what was sent (a rider dispatch
-- stores it so the rider's "Payment collected" tap can be matched to the order). What was sent is kept in
-- the chat log so Live Chat shows it.
drop function if exists public.complete_order_event(uuid, boolean, text, text, text, text);
create or replace function public.complete_order_event(p_id uuid, p_ok boolean, p_error text default null, p_phone text default null, p_text text default null, p_branch text default 'pandeshwar', p_message_id text default null)
returns void language plpgsql security definer set search_path = public as $$
declare b branches%rowtype; o_id uuid; v_type text;
begin
  select * into b from branches where slug = p_branch;
  update order_events set status = case when p_ok then 'done'::outbox_status else 'failed'::outbox_status end,
         processed_at = now(), error_message = case when p_ok then null else left(coalesce(p_error, 'send failed'), 500) end
   where id = p_id returning order_id, event_type into o_id, v_type;
  if p_ok and coalesce(p_text, '') <> '' and coalesce(p_phone, '') <> '' and v_type <> 'rider_assigned' then
    insert into chat_messages (branch_id, phone, direction, content, sender, delivery_status)
      values (b.id, p_phone, 'outbound', p_text, 'system', 'done');
  end if;
  if o_id is not null then
    if v_type = 'rider_assigned' then
      update orders set rider_notify_status = case when p_ok then 'sent' else 'failed' end,
             rider_wa_message_id = coalesce(p_message_id, rider_wa_message_id) where id = o_id;
    else
      update orders set order_notify_status = case when p_ok then 'sent' else 'failed' end,
             order_wa_message_id = coalesce(p_message_id, order_wa_message_id) where id = o_id;
    end if;
  end if;
end $$;

revoke all on function public.claim_order_events(text, int) from public, anon, authenticated;
revoke all on function public.complete_order_event(uuid, boolean, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_order_events(text, int), public.complete_order_event(uuid, boolean, text, text, text, text, text) to service_role;

select 'claim_order_events()' as item, to_regprocedure('public.claim_order_events(text,int)') is not null as ok
union all select 'complete_order_event()', to_regprocedure('public.complete_order_event(uuid,boolean,text,text,text,text,text)') is not null;
