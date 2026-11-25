-- Promotions: real delivery status per message (sent / delivered / read / failed).
-- Run once in the Supabase SQL Editor. Safe to re-run.
--
-- Before: the dashboard showed every promotion as "queued" forever, and a message that
-- WhatsApp rejected AFTER YCloud accepted it (e.g. error 131049 or 132000) still looked fine.
-- After: n8n Blast Sender saves YCloud's message id on each row, the bot's webhook
-- (n8n Main) reports sent/delivered/read/failed via fk_blast_status, and the dashboard
-- shows counts per promotion via fk_blast_campaign_stats.

alter table public.outbound_messages
  add column if not exists wa_message_id   text,
  add column if not exists delivery_status text,   -- sent | delivered | read | failed
  add column if not exists delivery_error  text,
  add column if not exists delivered_at    timestamptz,
  add column if not exists read_at         timestamptz;

create index if not exists outbound_messages_wa_message_id
  on public.outbound_messages(wa_message_id) where wa_message_id is not null;

-- Called by n8n Main for every YCloud "message.updated" event. Ignores ids that are not
-- promotions. Never moves backwards (a late "sent" cannot overwrite "read"); "failed" always wins.
create or replace function public.fk_blast_status(p_message_id text, p_status text, p_error text default null)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rank int := case lower(coalesce(p_status, ''))
                  when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 when 'failed' then 9 else 0 end;
begin
  if coalesce(p_message_id, '') = '' or v_rank = 0 then return; end if;
  update public.outbound_messages m
     set delivery_status = lower(p_status),
         delivery_error  = case when lower(p_status) = 'failed' then left(nullif(p_error, ''), 500) else m.delivery_error end,
         delivered_at    = case when lower(p_status) in ('delivered', 'read') then coalesce(m.delivered_at, now()) else m.delivered_at end,
         read_at         = case when lower(p_status) = 'read' then coalesce(m.read_at, now()) else m.read_at end
   where m.wa_message_id = p_message_id
     and coalesce(m.delivery_status, '') <> 'failed'
     and v_rank > case coalesce(m.delivery_status, '')
                    when 'sent' then 1 when 'delivered' then 2 when 'read' then 3 else 0 end;
end;
$$;

-- Counts per promotion for Dashboard > Promotions.
create or replace function public.fk_blast_campaign_stats(p_campaign_ids uuid[])
returns table (campaign_id uuid, total int, waiting int, sent int, delivered int, read int, failed int, top_error text)
language sql
stable
security definer
set search_path = public
as $$
  select m.campaign_id,
         count(*)::int,
         count(*) filter (where m.status in ('pending', 'claimed'))::int,
         count(*) filter (where m.status = 'done' and coalesce(m.delivery_status, 'sent') = 'sent')::int,
         count(*) filter (where m.delivery_status = 'delivered')::int,
         count(*) filter (where m.delivery_status = 'read')::int,
         count(*) filter (where m.status = 'failed' or m.delivery_status = 'failed')::int,
         (select coalesce(x.delivery_error, x.error_message)
            from public.outbound_messages x
           where x.campaign_id = m.campaign_id and (x.status = 'failed' or x.delivery_status = 'failed')
           group by 1 order by count(*) desc limit 1)
    from public.outbound_messages m
   where m.campaign_id = any(p_campaign_ids)
   group by m.campaign_id;
$$;

revoke all on function public.fk_blast_status(text, text, text) from public, anon, authenticated;
revoke all on function public.fk_blast_campaign_stats(uuid[]) from public, anon, authenticated;
grant execute on function public.fk_blast_status(text, text, text) to service_role;
grant execute on function public.fk_blast_campaign_stats(uuid[]) to service_role;

-- Check: should list the 5 new columns.
select column_name from information_schema.columns
 where table_schema = 'public' and table_name = 'outbound_messages'
   and column_name in ('wa_message_id', 'delivery_status', 'delivery_error', 'delivered_at', 'read_at');
