-- Rename the existing seeded branch from Falnir to Pandeshwar.
-- The UUID stays unchanged so the existing menu, images, staff access,
-- and order relationships remain attached to the same branch record.

update public.branches
set
  name = 'Fried King Pandeshwar',
  slug = 'pandeshwar',
  address = 'Pandeshwar, Mangaluru, Karnataka'
where id = 'a1b2c3d4-0001-0001-0001-000000000001'
  and slug = 'falnir';

select id, name, slug, address
from public.branches
where id = 'a1b2c3d4-0001-0001-0001-000000000001';
