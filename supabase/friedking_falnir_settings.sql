-- Falnir: point the website at Falnir's own links (the branch copy still had Pandeshwar's OTP sender).
-- Run in the Supabase SQL Editor. Safe to re-run.

insert into public.branch_settings (branch_id, key, value)
select b.id, v.key, v.value
from public.branches b,
     (values
       -- OTP is sent by the Falnir "Send OTP" workflow (from Falnir's WhatsApp number)
       ('otp_webhook_url', 'https://staff.brightmedia.tech/webhook/friedking-falnir-otp-780f5dd4c7e5c77b5e875c0bb8ca32c7'),
       -- the bot's menu link for Falnir customers
       ('menu_url', 'https://friedking.vercel.app/falnir')
     ) as v(key, value)
where b.slug = 'falnir'
on conflict (branch_id, key) do update set value = excluded.value, updated_at = now();

select key, value from public.branch_settings
where branch_id = (select id from public.branches where slug = 'falnir')
  and key in ('otp_webhook_url', 'menu_url', 'whatsapp_number');
