-- Fried King: verify a phone by WhatsApp message (free, no SMS).
-- The checkout shows a code; the customer sends "VERIFY <code>" to the bot; the bot calls wa_verify.
create table if not exists public.wa_verifications (
  id uuid primary key default gen_random_uuid(),
  secret text not null unique,          -- kept by the browser, never sent over WhatsApp
  code text not null,                   -- short code the customer sends
  phone text,                           -- E.164, filled when the message arrives
  verified_at timestamptz,
  consumed_at timestamptz,              -- set when an order has used it
  created_at timestamptz not null default now()
);
create index if not exists wa_verifications_code_idx on public.wa_verifications (code) where verified_at is null;
alter table public.wa_verifications enable row level security;

-- Called by n8n when a customer sends "VERIFY ABC123". Returns true if the code was valid.
create or replace function public.wa_verify(p_code text, p_phone text)
returns boolean language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_phone text := '+91' || right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10);
begin
  select id into v_id from wa_verifications
   where code = upper(trim(p_code)) and verified_at is null and consumed_at is null
     and created_at > now() - interval '15 minutes'
   order by created_at desc limit 1;
  if v_id is null then return false; end if;
  update wa_verifications set phone = v_phone, verified_at = now() where id = v_id;
  return true;
end $$;
revoke all on function public.wa_verify(text, text) from public, anon, authenticated;
grant execute on function public.wa_verify(text, text) to service_role;
