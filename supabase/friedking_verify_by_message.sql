-- Verify a phone by sending a WhatsApp message to the branch number (no WhatsApp template needed).
-- Why: the OTP needs an approved "Authentication" template for customers who have not messaged us in the last 24 hours,
-- and Falnir's WhatsApp account cannot create templates yet. Here the CUSTOMER messages us first ("VERIFY ABC123"),
-- which opens the free 24-hour window, and the bot confirms. Works for every branch. Safe to run more than once.
--
-- RUN ORDER: 1) this file  2) tell Claude (it then updates the Falnir n8n Main workflow). The website code is already deployed
-- and keeps working exactly as before until this file is run.

-- 1. Which branch a verification was started for (so a Falnir code can only be used on the Falnir number)
alter table public.wa_verifications add column if not exists branch_id uuid references public.branches(id) on delete cascade;
create index if not exists wa_verifications_code_pending_idx on public.wa_verifications (code) where verified_at is null and code is not null;

-- 2. n8n calls this when a customer sends "VERIFY ABC123" (replaces the empty stub). Returns true when the code was valid.
--    p_branch is optional: without it any branch's code is accepted (what the old workflow does until it is updated).
drop function if exists public.wa_verify(text, text);
drop function if exists public.wa_verify(text, text, text);
create function public.wa_verify(p_code text, p_phone text, p_branch text default null)
returns boolean language plpgsql security definer set search_path = public as $$
declare
  v_id uuid;
  v_phone text := '+91' || right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  v_branch uuid;
begin
  if p_branch is not null then select id into v_branch from branches where slug = p_branch; end if;
  select id into v_id from wa_verifications
   where code = upper(trim(p_code)) and verified_at is null and consumed_at is null
     and created_at > now() - interval '15 minutes'
     and (p_branch is null or branch_id is null or branch_id = v_branch)
   order by created_at desc limit 1;
  if v_id is null then return false; end if;
  update wa_verifications set phone = v_phone, verified_at = now() where id = v_id;
  return true;
end $$;
revoke all on function public.wa_verify(text, text, text) from public, anon, authenticated;
grant execute on function public.wa_verify(text, text, text) to service_role;

-- 3. Check: both lines should return false (no such code) without an error
select public.wa_verify('ZZZZZZ', '+919999999999') as any_branch, public.wa_verify('ZZZZZZ', '+919999999999', 'falnir') as falnir;

-- 4. Falnir: "Verify on WhatsApp" is the ONLY way to verify at checkout (no OTP button at all). Other branches stay unchanged.
--    Values for the branch setting verify_by_message:  'only' = WhatsApp message only,  '1' = WhatsApp message AND OTP,
--    missing = OTP only (as before). Falnir's OTP / SMS link stays configured, so 'only' can be changed back later.
insert into public.branch_settings (branch_id, key, value)
select b.id, 'verify_by_message', 'only' from public.branches b where b.slug = 'falnir'
on conflict (branch_id, key) do update set value = 'only', updated_at = now();

-- 5. (NOT needed any more.) Falnir and Kadri keep their OTP link: outside the 24 h window their OTP goes by SMS (MSG91) once
--    an SMS template is configured (see docs/SMS_OTP_MSG91.md). Until then, customers who cannot get an OTP use the
--    "Verify by WhatsApp message" option on the same card. Only if you ever want a branch to offer ONLY the message option:
--    delete from public.branch_settings where key = 'otp_webhook_url'
--     and branch_id in (select id from public.branches where slug = 'falnir');
