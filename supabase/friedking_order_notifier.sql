-- ============================================================
-- Fried King order notifier (n8n "Fried King | Order Events").
-- Run in the Supabase SQL Editor AFTER friedking_whatsapp_bot.sql. Safe to re-run.
--
-- The dashboard writes an `order_status_changed` row to order_events whenever staff accept,
-- ready, deliver or cancel an order. n8n polls with claim_order_events(), messages the customer
-- on WhatsApp (receipt image when the order is accepted) and reports back with complete_order_event().
-- ============================================================

-- Hand out up to p_limit new status events. Each is claimed once; a claim that never completed
-- (n8n crashed) is retried after 5 minutes, at most 3 times. Events older than 30 minutes are not sent
-- (a customer should not get "your order is ready" an hour late).
create or replace function public.claim_order_events(p_branch text default 'pandeshwar', p_limit int default 10)
returns jsonb language plpgsql security definer set search_path = public as $$
declare b branches%rowtype; v_ids uuid[]; r jsonb;
begin
  select * into b from branches where slug = p_branch;
  if not found then return '[]'::jsonb; end if;

  update order_events set status = 'failed', error_message = 'expired: older than 30 minutes when picked up'
   where branch_id = b.id and event_type = 'order_status_changed' and status = 'pending'
     and created_at < now() - interval '30 minutes';
  update order_events set status = 'failed', error_message = coalesce(error_message, 'gave up after 3 tries')
   where branch_id = b.id and event_type = 'order_status_changed' and status = 'claimed'
     and claimed_at < now() - interval '5 minutes' and retry_count >= 3;

  select array_agg(id) into v_ids from (
    select id from order_events
     where branch_id = b.id and event_type = 'order_status_changed'
       and (status = 'pending' or (status = 'claimed' and claimed_at < now() - interval '5 minutes' and retry_count < 3))
     order by created_at limit p_limit for update skip locked) s;
  if v_ids is null then return '[]'::jsonb; end if;

  update order_events set status = 'claimed', claimed_by = 'n8n', claimed_at = now(), retry_count = retry_count + 1
   where id = any(v_ids);

  select coalesce(jsonb_agg(jsonb_build_object(
      'event_id', e.id,
      'order_id', o.id,
      'status', e.payload->>'status',
      'prep_minutes', e.payload->>'prepMinutes',
      'reason', e.payload->>'reason',
      'phone', ltrim(c.phone, '+'),
      'source', o.source,
      -- WhatsApp only allows free-form messages within 24 hours of the customer's last message
      'in_window', exists (select 1 from chat_messages m where m.branch_id = b.id and m.phone = c.phone
                            and m.direction = 'inbound' and m.created_at > now() - interval '24 hours'),
      'order', public.fk_wa_order_json(o.id)) order by e.created_at), '[]'::jsonb)
    into r
    from order_events e join orders o on o.id = e.order_id join customers c on c.id = o.customer_id
   where e.id = any(v_ids);
  return r;
end $$;

-- Mark an event done or failed, and keep what was sent in the chat log (Live Chat shows it).
create or replace function public.complete_order_event(p_id uuid, p_ok boolean, p_error text default null, p_phone text default null, p_text text default null, p_branch text default 'pandeshwar')
returns void language plpgsql security definer set search_path = public as $$
declare b branches%rowtype; o_id uuid;
begin
  select * into b from branches where slug = p_branch;
  update order_events set status = case when p_ok then 'done'::outbox_status else 'failed'::outbox_status end,
         processed_at = now(), error_message = case when p_ok then null else left(coalesce(p_error, 'send failed'), 500) end
   where id = p_id returning order_id into o_id;
  if p_ok and coalesce(p_text, '') <> '' and coalesce(p_phone, '') <> '' then
    insert into chat_messages (branch_id, phone, direction, content, sender, delivery_status)
      values (b.id, p_phone, 'outbound', p_text, 'system', 'done');
  end if;
  if o_id is not null then
    update orders set order_notify_status = case when p_ok then 'sent' else 'failed' end where id = o_id;
  end if;
end $$;

revoke all on function public.claim_order_events(text, int) from public, anon, authenticated;
revoke all on function public.complete_order_event(uuid, boolean, text, text, text, text) from public, anon, authenticated;
grant execute on function public.claim_order_events(text, int), public.complete_order_event(uuid, boolean, text, text, text, text) to service_role;

select 'claim_order_events()' as item, to_regprocedure('public.claim_order_events(text,int)') is not null as ok
union all select 'complete_order_event()', to_regprocedure('public.complete_order_event(uuid,boolean,text,text,text,text)') is not null;
