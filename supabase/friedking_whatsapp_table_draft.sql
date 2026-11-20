-- ============================================================
-- Fried King WhatsApp bot: a customer seated at a table orders as DINE-IN, with no delivery / takeaway question.
-- Run in the Supabase SQL Editor AFTER friedking_whatsapp_delivery_mode.sql. Safe to re-run. Adds one function; no table changes,
-- and customer_draft() itself is not touched.
--
-- p_type = 'auto' (the bot sends this when the customer did not say how they want the order):
--   * the customer has an open table tab (scanned the table QR in the last 6 hours)  -> dine-in on that table
--   * otherwise                                                                       -> a takeaway placeholder; the bot then asks
--                                                                                        Delivery / Takeaway
-- Any other p_type (delivery, takeaway, dine-in) behaves exactly as customer_draft() does today.
-- ============================================================
create or replace function public.customer_draft_auto(p_phone text, p_name text, p_items jsonb, p_type text default 'auto', p_branch text default 'pandeshwar')
returns jsonb language plpgsql security definer set search_path = public as $$
declare b branches%rowtype; v_phone text := public.fk_wa_phone(p_phone); v_type text := lower(coalesce(p_type, 'auto')); v_has boolean;
begin
  if v_type <> 'auto' and v_type <> '' then
    return public.customer_draft(p_phone, p_name, p_items, p_type, p_branch);
  end if;
  select * into b from branches where slug = p_branch;
  if not found then return jsonb_build_object('result', 'error'); end if;
  select exists (
    select 1 from table_sessions s
     where s.branch_id = b.id and s.status = 'open' and s.phone = v_phone and s.opened_at > now() - interval '6 hours'
  ) into v_has;
  return public.customer_draft(p_phone, p_name, p_items, case when v_has then 'dine-in' else 'pickup' end, p_branch);
end $$;

revoke all on function public.customer_draft_auto(text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.customer_draft_auto(text, text, jsonb, text, text) to service_role;

select 'customer_draft_auto()' as item, to_regprocedure('public.customer_draft_auto(text,text,jsonb,text,text)') is not null as ok;
