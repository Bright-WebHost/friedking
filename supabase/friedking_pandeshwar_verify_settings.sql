-- Pandeshwar: use the same WhatsApp-message-only verification as Falnir.
-- Run after friedking_verify_by_message.sql is installed and the Pandeshwar
-- n8n Main workflow's Verify Code node passes p_branch = 'pandeshwar'.
-- Safe to re-run. The OTP sender configuration is kept for rollback.

insert into public.branch_settings (branch_id, key, value)
select id, 'verify_by_message', 'only'
from public.branches
where slug = 'pandeshwar'
on conflict (branch_id, key) do update
set value = excluded.value, updated_at = now();
