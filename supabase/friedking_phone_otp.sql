-- Fried King: WhatsApp OTP sent from the website (Send OTP button), plus saved addresses for customer profiles.
-- Run after friedking_phone_verify.sql. Safe to run more than once.

-- The website now creates the row with the customer's phone and a 6-digit OTP, then asks n8n to send it.
alter table public.wa_verifications add column if not exists otp text;
alter table public.wa_verifications add column if not exists otp_attempts int not null default 0;
alter table public.wa_verifications add column if not exists ip text;
alter table public.wa_verifications alter column code drop not null;
create index if not exists wa_verifications_phone_idx on public.wa_verifications (phone, created_at);
create index if not exists wa_verifications_ip_idx on public.wa_verifications (ip, created_at);

-- Old "send us VERIFY <code>" flow is gone. This stub only lets a stray VERIFY message get a polite "not valid" reply.
drop function if exists public.wa_verify(text, text);
create function public.wa_verify(p_code text, p_phone text) returns text language sql security definer set search_path = public as $$ select null::text $$;
revoke all on function public.wa_verify(text, text) from public, anon, authenticated;
grant execute on function public.wa_verify(text, text) to service_role;

-- n8n asks this before sending the OTP: true = the customer messaged us in the last 24 hours, so a normal
-- (free) message is allowed; false = it must go as the approved authentication template.
create or replace function public.otp_window_open(p_phone text)
returns boolean language sql security definer set search_path = public as $$
  select exists (select 1 from chat_messages m
                  where m.direction = 'inbound' and m.created_at > now() - interval '24 hours'
                    and m.phone in (p_phone, public.fk_wa_phone(p_phone)))
$$;
revoke all on function public.otp_window_open(text) from public, anon, authenticated;
grant execute on function public.otp_window_open(text) to service_role;

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
