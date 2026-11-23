-- Create the Attavar branch as a copy of Pandeshwar (menu, prices, settings, tables, pincodes, loyalty, ingredients, recipes).
-- Run once in the Supabase SQL Editor. It stops with an error if 'attavar' already exists, so it cannot double-copy.
--
-- NOT copied (set these up for Attavar yourself): staff logins, riders, orders, customers, chat, expenses,
-- stock quantities (ingredients and dish stock start at 0), menu promotions / offers banners.
-- After running: edit offers and any price differences in Dashboard > Menu / Settings.

do $$
declare
  src uuid;
  dst uuid := gen_random_uuid();
  r   record;
  nid uuid;
begin
  select id into src from public.branches where slug = 'pandeshwar';
  if src is null then raise exception 'Pandeshwar branch not found'; end if;
  if exists (select 1 from public.branches where slug = 'attavar') then
    raise exception 'Attavar branch already exists - nothing was changed';
  end if;

  create temp table cat_map  (old_id uuid, new_id uuid) on commit drop;
  create temp table item_map (old_id uuid, new_id uuid) on commit drop;
  create temp table stock_map(old_id uuid, new_id uuid) on commit drop;

  -- 1. Branch row (phone / WhatsApp number left empty: fill in once Attavar has its own YCloud number)
  insert into public.branches
  select (jsonb_populate_record(null::public.branches,
           to_jsonb(b) || jsonb_build_object(
             'id', dst,
             'name', 'Fried King Attavar',
             'slug', 'attavar',
             'address', 'Attavar, Mangaluru, Karnataka',
             'phone', null,
             'whatsapp_number', null,
             'created_at', now()))).*
  from public.branches b where b.id = src;

  -- 2. Categories
  for r in select * from public.menu_categories where branch_id = src loop
    nid := gen_random_uuid();
    insert into public.menu_categories
    select (jsonb_populate_record(null::public.menu_categories,
             to_jsonb(r) || jsonb_build_object('id', nid, 'branch_id', dst, 'created_at', now()))).*;
    insert into cat_map values (r.id, nid);
  end loop;

  -- 3. Menu items (dish stock counters reset to 0)
  for r in select * from public.menu_items where branch_id = src loop
    nid := gen_random_uuid();
    insert into public.menu_items
    select (jsonb_populate_record(null::public.menu_items,
             to_jsonb(r) || jsonb_build_object(
               'id', nid,
               'branch_id', dst,
               'category_id', (select m.new_id from cat_map m where m.old_id = r.category_id),
               'stock_qty', 0,
               'stock_updated_at', null,
               'stock_updated_by', null,
               'created_at', now()))).*;
    insert into item_map values (r.id, nid);
  end loop;

  -- 4. Variants
  for r in select v.* from public.menu_item_variants v where v.item_id in (select old_id from item_map) loop
    insert into public.menu_item_variants
    select (jsonb_populate_record(null::public.menu_item_variants,
             to_jsonb(r) || jsonb_build_object(
               'id', gen_random_uuid(),
               'item_id', (select m.new_id from item_map m where m.old_id = r.item_id)))).*;
  end loop;

  -- 5. Ingredients (quantity 0) and recipes
  for r in select * from public.stock_items where branch_id = src loop
    nid := gen_random_uuid();
    insert into public.stock_items
    select (jsonb_populate_record(null::public.stock_items,
             to_jsonb(r) || jsonb_build_object('id', nid, 'branch_id', dst)
             || case when to_jsonb(r) ? 'quantity' then jsonb_build_object('quantity', 0) else '{}'::jsonb end
             || case when to_jsonb(r) ? 'nearest_expiry' then jsonb_build_object('nearest_expiry', null) else '{}'::jsonb end
           )).*;
    insert into stock_map values (r.id, nid);
  end loop;

  insert into public.recipe_lines (menu_item_id, stock_item_id, qty_per_item)
  select im.new_id, sm.new_id, rl.qty_per_item
  from public.recipe_lines rl
  join item_map  im on im.old_id = rl.menu_item_id
  join stock_map sm on sm.old_id = rl.stock_item_id;

  -- 6. Settings (delivery rules, fee, passcode, hours text, shift report time ...).
  --    Skipped: internal shift-report state, and menu_url (it points at the Pandeshwar menu).
  insert into public.branch_settings (branch_id, key, value)
  select dst, key, value
  from public.branch_settings
  where branch_id = src
    and key not like 'shift\_report\_last\_%'
    and key not in ('shift_report_force', 'shift_report_image', 'menu_url');

  -- 7. Dine-in tables, delivery pincodes
  for r in select * from public.restaurant_tables where branch_id = src loop
    insert into public.restaurant_tables
    select (jsonb_populate_record(null::public.restaurant_tables,
             to_jsonb(r) || jsonb_build_object('id', gen_random_uuid(), 'branch_id', dst, 'created_at', now()))).*;
  end loop;

  insert into public.delivery_pincodes (branch_id, pincode, area, is_active)
  select dst, pincode, area, is_active from public.delivery_pincodes where branch_id = src;

  -- 8. Rewards programme (replace any default row created for the new branch)
  delete from public.loyalty_programs where branch_id = dst;
  for r in select * from public.loyalty_programs where branch_id = src and is_active loop
    insert into public.loyalty_programs
    select (jsonb_populate_record(null::public.loyalty_programs,
             to_jsonb(r) || jsonb_build_object('id', gen_random_uuid(), 'branch_id', dst,
                                               'created_at', now(), 'updated_at', now()))).*;
  end loop;
end $$;

-- Check: the Attavar counts should match Pandeshwar
select b.slug,
  (select count(*) from public.menu_categories c where c.branch_id = b.id) as categories,
  (select count(*) from public.menu_items i where i.branch_id = b.id)      as items,
  (select count(*) from public.restaurant_tables t where t.branch_id = b.id) as tables_count
from public.branches b
where b.slug in ('pandeshwar', 'attavar');
