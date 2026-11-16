-- Fried King: typed OTP on top of the WhatsApp VERIFY message, plus saved addresses for customer profiles.
-- Run after friedking_phone_verify.sql.
alter table public.wa_verifications add column if not exists otp text;
alter table public.wa_verifications add column if not exists otp_attempts int not null default 0;

-- The customer's VERIFY message now returns a 6-digit OTP (n8n sends it back on WhatsApp).
-- The number is only "verified" once the OTP is typed on the website.
drop function if exists public.wa_verify(text, text);
create function public.wa_verify(p_code text, p_phone text)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_otp text := lpad((floor(random() * 1000000))::int::text, 6, '0');
        v_phone text := '+91' || right(regexp_replace(coalesce(p_phone,''), '\D', '', 'g'), 10);
begin
  select id into v_id from wa_verifications
   where code = upper(trim(p_code)) and phone is null and consumed_at is null
     and created_at > now() - interval '15 minutes'
   order by created_at desc limit 1;
  if v_id is null then return null; end if;
  update wa_verifications set phone = v_phone, otp = v_otp where id = v_id;
  return v_otp;
end $$;
revoke all on function public.wa_verify(text, text) from public, anon, authenticated;
grant execute on function public.wa_verify(text, text) to service_role;

-- Saved delivery addresses for logged-in customers (keyed by verified phone, E.164).
create table if not exists public.customer_addresses (
  id uuid primary key default gen_random_uuid(),
  phone text not null,
  label text,
  address text not null,
  created_at timestamptz not null default now()
);
create index if not exists customer_addresses_phone_idx on public.customer_addresses (phone);
alter table public.customer_addresses enable row level security;
