-- Fried King internal platform admin access.
-- Create the Supabase Auth user first, then insert their UUID into platform_admins.

create table if not exists public.platform_admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  name       text not null,
  is_active  boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.platform_admin_audit (
  id            uuid primary key default gen_random_uuid(),
  actor_user_id uuid not null references auth.users(id) on delete restrict,
  branch_id     uuid references public.branches(id) on delete set null,
  action        text not null,
  from_value    text,
  to_value      text,
  detail        text,
  created_at    timestamptz not null default now()
);

create index if not exists platform_admin_audit_created
  on public.platform_admin_audit(created_at desc);

alter table public.platform_admins enable row level security;
alter table public.platform_admin_audit enable row level security;

-- The Next.js server uses the service-role client after checking platform_admins.
-- No client-side policy is granted for these internal tables.

