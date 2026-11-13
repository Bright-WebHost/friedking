-- Fried King Pandeshwar: menu item photos
-- Run in the Supabase SQL Editor. Safe to run more than once.
--
-- The photos are served by the website itself from public/menu/*.webp
-- (640x640 WebP made from the existing Fried King menu photography), so image_url is a site path.
-- Matched by item id, limited to the Pandeshwar branch. All 85 seeded items get a photo.
--
-- Please check: "Chicken Strips" photo is used for both Single Strip and Strip Bites.

begin;

update menu_items set image_url = '/menu/blueberry-mojito.webp' where id = 'd0000000-0000-0000-0000-000000000068' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Blueberry Mojito
update menu_items set image_url = '/menu/blue-lime-mojito.webp' where id = 'd0000000-0000-0000-0000-000000000067' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Blue Lime Mojito
update menu_items set image_url = '/menu/mint-mojito.webp' where id = 'd0000000-0000-0000-0000-000000000066' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Mint Mojito
update menu_items set image_url = '/menu/passion-fruit-mojito.webp' where id = 'd0000000-0000-0000-0000-000000000070' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Passion Fruit Mojito
update menu_items set image_url = '/menu/pineapple-mojito.webp' where id = 'd0000000-0000-0000-0000-000000000071' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Pineapple Mojito
update menu_items set image_url = '/menu/strawberry-mojito.webp' where id = 'd0000000-0000-0000-0000-000000000069' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Strawberry Mojito
update menu_items set image_url = '/menu/cheese-balls.webp' where id = 'd0000000-0000-0000-0000-000000000055' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Cheese Balls – 6 Pieces
update menu_items set image_url = '/menu/cheese-balls.webp' where id = 'd0000000-0000-0000-0000-000000000056' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Cheese Balls – 10 Pieces
update menu_items set image_url = '/menu/chick-pop.webp' where id = 'd0000000-0000-0000-0000-000000000049' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Chick Pop – Medium
update menu_items set image_url = '/menu/chick-pop.webp' where id = 'd0000000-0000-0000-0000-000000000050' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Chick Pop – Large
update menu_items set image_url = '/menu/chicken-nuggets.webp' where id = 'd0000000-0000-0000-0000-000000000051' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Nugget – Per Piece
update menu_items set image_url = '/menu/chicken-nuggets.webp' where id = 'd0000000-0000-0000-0000-000000000052' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Nuggets – 6 Pieces
update menu_items set image_url = '/menu/chicken-strips.webp' where id = 'd0000000-0000-0000-0000-000000000041' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Single Strip
update menu_items set image_url = '/menu/chicken-strips.webp' where id = 'd0000000-0000-0000-0000-000000000042' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Strip Bites
update menu_items set image_url = '/menu/snack-strips.webp' where id = 'd0000000-0000-0000-0000-000000000043' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Snack Strips
update menu_items set image_url = '/menu/crab-claw.webp' where id = 'd0000000-0000-0000-0000-000000000053' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Crab Claw – Per Piece
update menu_items set image_url = '/menu/lobster-bite.webp' where id = 'd0000000-0000-0000-0000-000000000054' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Lobster Bite – 6 Pieces
update menu_items set image_url = '/menu/fried-shrimps.webp' where id = 'd0000000-0000-0000-0000-000000000057' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Fried Shrimps – 10 Pieces
update menu_items set image_url = '/menu/wings.webp' where id = 'd0000000-0000-0000-0000-000000000058' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Wings – 6 Pieces
update menu_items set image_url = '/menu/french-fries.webp' where id = 'd0000000-0000-0000-0000-000000000045' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- French Fries – Medium
update menu_items set image_url = '/menu/french-fries.webp' where id = 'd0000000-0000-0000-0000-000000000046' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- French Fries – Large
update menu_items set image_url = '/menu/potato-wedges.webp' where id = 'd0000000-0000-0000-0000-000000000047' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Potato Wedges – Medium
update menu_items set image_url = '/menu/potato-wedges.webp' where id = 'd0000000-0000-0000-0000-000000000048' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Potato Wedges – Large
update menu_items set image_url = '/menu/loaded-fries.webp' where id = 'd0000000-0000-0000-0000-000000000059' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Loaded Fries
update menu_items set image_url = '/menu/dora-meal.webp' where id = 'd0000000-0000-0000-0000-000000000001' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Dora Meal
update menu_items set image_url = '/menu/honey-bunny-meal.webp' where id = 'd0000000-0000-0000-0000-000000000002' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Honey Bunny Meal
update menu_items set image_url = '/menu/lunch-meal.webp' where id = 'd0000000-0000-0000-0000-000000000005' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Lunch Meal
update menu_items set image_url = '/menu/single-fried-chicken.webp' where id = 'd0000000-0000-0000-0000-000000000012' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Single Fried Chicken
update menu_items set image_url = '/menu/kings-zinger-sandwich.webp' where id = 'd0000000-0000-0000-0000-000000000026' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Zinger Sandwich
update menu_items set image_url = '/menu/kings-veg-sandwich.webp' where id = 'd0000000-0000-0000-0000-000000000030' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Veg Sandwich
update menu_items set image_url = '/menu/kings-mix-sandwich.webp' where id = 'd0000000-0000-0000-0000-000000000025' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Mix Sandwich
update menu_items set image_url = '/menu/kings-veg-wrap-roll.webp' where id = 'd0000000-0000-0000-0000-000000000036' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Veg Wrap Roll
update menu_items set image_url = '/menu/kings-zinger-wrap-roll.webp' where id = 'd0000000-0000-0000-0000-000000000033' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Zinger Wrap Roll
update menu_items set image_url = '/menu/kings-crab-wrap-roll.webp' where id = 'd0000000-0000-0000-0000-000000000034' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Crab Wrap Roll
update menu_items set image_url = '/menu/kings-zinger-burger.webp' where id = 'd0000000-0000-0000-0000-000000000019' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Zinger Burger
update menu_items set image_url = '/menu/kings-veg-burger.webp' where id = 'd0000000-0000-0000-0000-000000000014' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Veg Burger
update menu_items set image_url = '/menu/kings-double-decker-burger.webp' where id = 'd0000000-0000-0000-0000-000000000023' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Double Decker Burger
update menu_items set image_url = '/menu/kings-crab-burger.webp' where id = 'd0000000-0000-0000-0000-000000000021' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Crab Burger
update menu_items set image_url = '/menu/kings-jr-burger.webp' where id = 'd0000000-0000-0000-0000-000000000015' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's JR Burger
update menu_items set image_url = '/menu/kings-kebab-burger.webp' where id = 'd0000000-0000-0000-0000-000000000017' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Kebab Burger
update menu_items set image_url = '/menu/kings-egg-burger.webp' where id = 'd0000000-0000-0000-0000-000000000013' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Egg Burger
update menu_items set image_url = '/menu/kings-hot-burger.webp' where id = 'd0000000-0000-0000-0000-000000000018' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Hot Burger
update menu_items set image_url = '/menu/kings-prawns-burger.webp' where id = 'd0000000-0000-0000-0000-000000000022' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Prawns Burger
update menu_items set image_url = '/menu/kings-prime-burger.webp' where id = 'd0000000-0000-0000-0000-000000000016' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Prime Burger
update menu_items set image_url = '/menu/kings-special-burger.webp' where id = 'd0000000-0000-0000-0000-000000000020' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Special Burger
update menu_items set image_url = '/menu/5-pcs-crispy-chicken.webp' where id = 'd0000000-0000-0000-0000-000000000037' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- 5 Pcs Crispy Chicken
update menu_items set image_url = '/menu/5-pcs-bucket.webp' where id = 'd0000000-0000-0000-0000-000000000078' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- 5 Pcs Bucket
update menu_items set image_url = '/menu/breakfast-meal.webp' where id = 'd0000000-0000-0000-0000-000000000004' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Breakfast Meal
update menu_items set image_url = '/menu/mayonnaise-medium.webp' where id = 'd0000000-0000-0000-0000-000000000060' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Mayonnaise - Medium
update menu_items set image_url = '/menu/kings-kebab-wrap-roll.webp' where id = 'd0000000-0000-0000-0000-000000000031' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Kebab Wrap Roll
update menu_items set image_url = '/menu/kings-prime-sandwich.webp' where id = 'd0000000-0000-0000-0000-000000000024' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Prime Sandwich
update menu_items set image_url = '/menu/3-plus-2-combo.webp' where id = 'd0000000-0000-0000-0000-000000000082' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- 3+2 Combo
update menu_items set image_url = '/menu/nano-burger.webp' where id = 'd0000000-0000-0000-0000-000000000072' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Nano Burger
update menu_items set image_url = '/menu/5-pcs-combo.webp' where id = 'd0000000-0000-0000-0000-000000000074' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- 5 Pcs Combo
update menu_items set image_url = '/menu/students-combo.webp' where id = 'd0000000-0000-0000-0000-000000000073' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Students Combo
update menu_items set image_url = '/menu/10-pcs-combo.webp' where id = 'd0000000-0000-0000-0000-000000000075' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- 10 Pcs Combo
update menu_items set image_url = '/menu/9-pcs-bucket.webp' where id = 'd0000000-0000-0000-0000-000000000079' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- 9 Pcs Bucket
update menu_items set image_url = '/menu/kings-mixed-wrap-roll.webp' where id = 'd0000000-0000-0000-0000-000000000032' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Mixed Wrap Roll
update menu_items set image_url = '/menu/9-pcs-crispy-chicken.webp' where id = 'd0000000-0000-0000-0000-000000000038' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- 9 Pcs Crispy Chicken
update menu_items set image_url = '/menu/mayonnaise-large.webp' where id = 'd0000000-0000-0000-0000-000000000061' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Mayonnaise - Large
update menu_items set image_url = '/menu/prime-combo.webp' where id = 'd0000000-0000-0000-0000-000000000083' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Prime Combo
update menu_items set image_url = '/menu/chota-bheem-meal.webp' where id = 'd0000000-0000-0000-0000-000000000003' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Chota Bheem Meal
update menu_items set image_url = '/menu/friends-meal.webp' where id = 'd0000000-0000-0000-0000-000000000006' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Friends' Meal
update menu_items set image_url = '/menu/12-pcs-crispy-chicken.webp' where id = 'd0000000-0000-0000-0000-000000000039' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- 12 Pcs Crispy Chicken
update menu_items set image_url = '/menu/coleslaw-medium.webp' where id = 'd0000000-0000-0000-0000-000000000062' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Coleslaw - Medium
update menu_items set image_url = '/menu/20-pcs-combo.webp' where id = 'd0000000-0000-0000-0000-000000000076' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- 20 Pcs Combo
update menu_items set image_url = '/menu/12-pcs-bucket.webp' where id = 'd0000000-0000-0000-0000-000000000080' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- 12 Pcs Bucket
update menu_items set image_url = '/menu/king-zinger-combo.webp' where id = 'd0000000-0000-0000-0000-000000000084' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King Zinger Combo
update menu_items set image_url = '/menu/coleslaw-large.webp' where id = 'd0000000-0000-0000-0000-000000000063' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Coleslaw - Large
update menu_items set image_url = '/menu/18-pcs-crispy-chicken.webp' where id = 'd0000000-0000-0000-0000-000000000040' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- 18 Pcs Crispy Chicken
update menu_items set image_url = '/menu/kings-meal.webp' where id = 'd0000000-0000-0000-0000-000000000007' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Meal
update menu_items set image_url = '/menu/18-pcs-bucket.webp' where id = 'd0000000-0000-0000-0000-000000000081' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- 18 Pcs Bucket
update menu_items set image_url = '/menu/30-pcs-combo.webp' where id = 'd0000000-0000-0000-0000-000000000077' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- 30 Pcs Combo
update menu_items set image_url = '/menu/kings-shrimps-sandwich.webp' where id = 'd0000000-0000-0000-0000-000000000027' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Shrimps Sandwich
update menu_items set image_url = '/menu/friends-strips.webp' where id = 'd0000000-0000-0000-0000-000000000044' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Friends Strips
update menu_items set image_url = '/menu/2-prime-combo.webp' where id = 'd0000000-0000-0000-0000-000000000085' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- 2 Prime Combo
update menu_items set image_url = '/menu/family-meal.webp' where id = 'd0000000-0000-0000-0000-000000000008' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Family Meal
update menu_items set image_url = '/menu/kings-shrimps-wrap-roll.webp' where id = 'd0000000-0000-0000-0000-000000000035' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Shrimps Wrap Roll
update menu_items set image_url = '/menu/bun.webp' where id = 'd0000000-0000-0000-0000-000000000064' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Bun
update menu_items set image_url = '/menu/kings-loaded-sandwich.webp' where id = 'd0000000-0000-0000-0000-000000000028' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Loaded Sandwich
update menu_items set image_url = '/menu/mega-family-meal.webp' where id = 'd0000000-0000-0000-0000-000000000009' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Mega Family Meal
update menu_items set image_url = '/menu/wheat-kuboos.webp' where id = 'd0000000-0000-0000-0000-000000000065' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Wheat Kuboos
update menu_items set image_url = '/menu/kings-club-sandwich.webp' where id = 'd0000000-0000-0000-0000-000000000029' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Club Sandwich
update menu_items set image_url = '/menu/kings-party-meal.webp' where id = 'd0000000-0000-0000-0000-000000000010' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- King's Party Meal
update menu_items set image_url = '/menu/kitty-party-meal.webp' where id = 'd0000000-0000-0000-0000-000000000011' and branch_id = 'a1b2c3d4-0001-0001-0001-000000000001'; -- Kitty Party Meal

commit;

-- Check: how many Pandeshwar items have a photo now (expect 85)
select count(*) filter (where image_url is not null) as with_photo, count(*) as total
from menu_items where branch_id = 'a1b2c3d4-0001-0001-0001-000000000001';
