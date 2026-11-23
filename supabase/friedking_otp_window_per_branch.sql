-- WhatsApp's 24-hour free-message window belongs to ONE business number. otp_window_open() used to ask "did this customer
-- message ANY of our numbers in the last 24 hours?", so a customer who had just messaged Pandeshwar looked "in window" for
-- Falnir too; the OTP / rider message was then sent as free text from the Falnir number and WhatsApp rejected it.
-- Now it can be asked per branch: otp_window_open(p_phone, p_branch). Without p_branch it behaves exactly as before,
-- so nothing breaks while the n8n workflows are being updated (do that AFTER running this file).
-- Safe to re-run.

drop function if exists public.otp_window_open(text);

create or replace function public.otp_window_open(p_phone text, p_branch text default null)
returns boolean language sql security definer set search_path = public as $$
  select exists (
    select 1 from chat_messages m
     where m.direction = 'inbound'
       and m.created_at > now() - interval '24 hours'
       and m.phone in (p_phone, public.fk_wa_phone(p_phone))
       and (p_branch is null or m.branch_id = (select b.id from branches b where b.slug = p_branch))
  )
$$;

revoke all on function public.otp_window_open(text, text) from public, anon, authenticated;
grant execute on function public.otp_window_open(text, text) to service_role;

-- Check (should return true/false without an error)
select public.otp_window_open('+919999999999', 'falnir') as falnir_window,
       public.otp_window_open('+919999999999') as any_branch_window;
