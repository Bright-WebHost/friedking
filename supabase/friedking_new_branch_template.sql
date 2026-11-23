-- NEW BRANCH TEMPLATE: copies an existing branch (menu, prices, delivery settings, tables, loyalty programme, ingredients, recipes)
-- into a new branch. Used for Falnir; use it again for Kadri or any later branch.
--
-- HOW TO USE: edit ONLY the five values in the "EDIT THESE" block below, then run the whole file once in the Supabase SQL Editor.
-- It stops with an error if the new slug already exists, so it cannot double-copy.
--
-- NOT copied on purpose (they belong to one branch): staff logins, riders, orders, customers, chat, expenses, offer banners,
-- delivery pincodes (areas differ), stock quantities (start at 0), GSTIN, shift-report recipients, OTP and menu links.
-- After running, in the new branch's Dashboard > Settings: pincodes, GSTIN, offers, riders, staff logins, shift report.
-- Then follow docs/NEW_BRANCH_CHECKLIST.md for the n8n copies and YCloud.

do $$
declare
  -- ===================== EDIT THESE =====================
  new_slug    text := 'kadri';                              -- lower-case, used in the link: friedking.vercel.app/kadri
  new_name    text := 'Fried King Kadri';
  new_address text := 'City Commercial Complex, near City Hospital, Mallikatte, Kadri, Mangaluru, Karnataka 575003';
  new_whatsapp text := '';                                  -- 10 digits, no +91; leave '' until the branch has its number (set later in Dashboard > Settings)
  copy_from   text := 'pandeshwar';                         -- branch whose menu and settings are copied
  -- ======================================================
  src uuid;
  dst uuid := gen_random_uuid();
  r   record;
  nid uuid;
begin
  select id into src from public.branches where slug = copy_from;
  if src is null then raise exception 'Source branch % not found', copy_from; end if;
  if new_slug !~ '^[a-z0-9-]+$' then raise exception 'Slug must be lower-case letters, numbers and dashes'; end if;
  if new_whatsapp <> '' and new_whatsapp !~ '^[0-9]{10}$' then raise exception 'WhatsApp number must be 10 digits (or empty)'; end if;
  if exists (select 1 from public.branches where slug = new_slug) then
    raise exception 'Branch % already exists - nothing was changed', new_slug;
  end if;

  create temp table cat_map  (old_id uuid, new_id uuid) on commit drop;
  create temp table item_map (old_id uuid, new_id uuid) on commit drop;
  create temp table stock_map(old_id uuid, new_id uuid) on commit drop;

  -- 1. Branch row (opening hours copied from the source; change them in Dashboard > Settings > Hours)
  insert into public.branches
  select (jsonb_populate_record(null::public.branches,
           to_jsonb(b) || jsonb_build_object(
             'id', dst, 'name', new_name, 'slug', new_slug, 'address', new_address,
             'phone', null, 'whatsapp_number', null, 'created_at', now()))).*
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
               'id', nid, 'branch_id', dst,
               'category_id', (select m.new_id from cat_map m where m.old_id = r.category_id),
               'stock_qty', 0, 'stock_updated_at', null, 'stock_updated_by', null,
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

  -- 6. Settings: delivery rules, fee, passcode and so on. Branch-specific keys are skipped and set below / later.
  insert into public.branch_settings (branch_id, key, value)
  select dst, key, value
  from public.branch_settings
  where branch_id = src
    and key not like 'shift\_report\_%'
    and key not in ('menu_url', 'otp_webhook_url', 'whatsapp_number', 'gstin');

  insert into public.branch_settings (branch_id, key, value)
  values (dst, 'menu_url', 'https://friedking.vercel.app/' || new_slug);

  if new_whatsapp <> '' then
    insert into public.branch_settings (branch_id, key, value) values (dst, 'whatsapp_number', new_whatsapp);
  end if;

  -- 7. Dine-in tables (pincodes are NOT copied: add this branch's delivery areas in Settings)
  for r in select * from public.restaurant_tables where branch_id = src loop
    insert into public.restaurant_tables
    select (jsonb_populate_record(null::public.restaurant_tables,
             to_jsonb(r) || jsonb_build_object('id', gen_random_uuid(), 'branch_id', dst, 'created_at', now()))).*;
  end loop;

  -- 8. Rewards programme
  delete from public.loyalty_programs where branch_id = dst;
  for r in select * from public.loyalty_programs where branch_id = src and is_active loop
    insert into public.loyalty_programs
    select (jsonb_populate_record(null::public.loyalty_programs,
             to_jsonb(r) || jsonb_build_object('id', gen_random_uuid(), 'branch_id', dst,
                                               'created_at', now(), 'updated_at', now()))).*;
  end loop;
end $$;

-- Check: counts should match the source branch
select b.slug,
  (select count(*) from public.menu_categories c where c.branch_id = b.id) as categories,
  (select count(*) from public.menu_items i where i.branch_id = b.id)      as items,
  (select count(*) from public.restaurant_tables t where t.branch_id = b.id) as tables_count
from public.branches b
order by b.created_at;
