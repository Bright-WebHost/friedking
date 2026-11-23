-- Remove the "King's " prefix from menu category names (King's Meals -> Meals, King's Burgers -> Burgers ...).
-- Affects the customer menu, POS and dashboard. Run in the Supabase SQL Editor. Safe to re-run.
-- To change Pandeshwar only, delete "'falnir'," from the slug list below.

update public.menu_categories c
set name = regexp_replace(c.name, '^King''s\s+', '', 'i')
from public.branches b
where b.id = c.branch_id
  and b.slug in ('pandeshwar', 'falnir')
  and c.name ~* '^King''s\s+';

select b.slug, c.name
from public.menu_categories c
join public.branches b on b.id = c.branch_id
where b.slug in ('pandeshwar', 'falnir')
order by b.slug, c.sort_order;
