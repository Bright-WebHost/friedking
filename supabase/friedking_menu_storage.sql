-- Menu image storage for dashboard uploads.
-- Run in the Supabase SQL Editor before using the dashboard image uploader.

insert into storage.buckets (id, name, public)
values ('menu', 'menu', true)
on conflict (id) do update set public = true;
