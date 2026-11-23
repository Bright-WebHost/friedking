-- The branch created by friedking_attavar_branch.sql is really FALNIR. Rename it (same row, same menu copy).
-- Run once in the Supabase SQL Editor. It refuses to run if the branch already has orders.

do $$
declare
  bid uuid;
begin
  select id into bid from public.branches where slug = 'attavar';
  if bid is null then raise exception 'No branch with slug attavar (already renamed?)'; end if;
  if exists (select 1 from public.branches where slug = 'falnir') then
    raise exception 'A branch with slug falnir already exists';
  end if;
  if exists (select 1 from public.orders where branch_id = bid) then
    raise exception 'This branch already has orders - not renaming';
  end if;

  update public.branches
  set name = 'Fried King Falnir',
      slug = 'falnir',
      address = 'Falnir, Mangaluru, Karnataka',
      phone = null,
      whatsapp_number = null
  where id = bid;

  -- Falnir's own WhatsApp number (used for table QR codes and invoices; 10 digits, as Settings expects)
  insert into public.branch_settings (branch_id, key, value)
  values (bid, 'whatsapp_number', '7337687522')
  on conflict (branch_id, key) do update set value = excluded.value, updated_at = now();

  -- The copied shift-report recipients belong to Pandeshwar; remove them until Falnir has its own
  delete from public.branch_settings where branch_id = bid and key = 'shift_report_numbers';
end $$;

select slug, name, address from public.branches where slug in ('pandeshwar', 'falnir', 'attavar');
select key, value from public.branch_settings
where branch_id = (select id from public.branches where slug = 'falnir') and key = 'whatsapp_number';
