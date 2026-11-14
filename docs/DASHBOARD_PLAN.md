# Fried King staff dashboard: Oceana parity plan

The dashboard copies the Oceana staff dashboard (`dashboard-index-FINAL.html`, a single-file app by the same team) feature for feature, in Fried King colours, with three changes:

1. **Branches.** Oceana is one restaurant. Fried King has branches, so every page lives under `/dashboard/[branch]/[section]` and every query is scoped to that branch. Owners (`staff.branch_id is null`) get a branch switcher.
2. **Tables is its own page** (Oceana shows tables inside "Floor & Orders").
3. **WhatsApp goes through the outbox.** Oceana calls n8n webhooks directly. Fried King writes rows that n8n will read later (decided with Maithri, 2026-11-14):
   - order-related messages (status changes, rider assigned, invoice) -> `order_events`
   - chat replies -> `chat_messages` with `direction = 'outbound'` and `delivery_status = 'pending'`
   - blasts -> `outbound_messages` (one row per recipient)
   Nothing is ever shown as "sent" by the dashboard itself.

The AI Assistant is built last, after a provider is chosen (decided 2026-11-14).

**Status (2026-11-14):** every section below except the AI Assistant is built and type-checks. The boxes are not ticked because nothing has been tested yet against the live database: that needs `friedking_dashboard_oceana.sql` to be run and a staff login. Tick each one after trying it.

Money stays in integer paise everywhere (Oceana uses rupees). Order statuses keep the existing enum; Oceana's names map as:

| Oceana | Fried King |
|---|---|
| new (awaiting accept) | `pending` |
| preparing | `preparing` |
| ready_for_pickup / out_for_delivery | `ready` (label depends on `order_type`) |
| delivered / completed | `delivered` |
| declined | `cancelled` with `cancel_reason` and no `accepted_at` |
| cancelled | `cancelled` |

Roles map as: Oceana admin = `owner`, manager = `manager`, waiter = `staff`.

| Section | owner | manager | staff |
|---|---|---|---|
| POS, Orders, Tables | yes | yes | yes |
| Chat, Menu, Stock, P&L, Riders, Analytics, AI, Loyalty | yes | yes | no |
| Contacts, Blast, Settings | yes | no | no |

## Database

All new schema is in `supabase/friedking_dashboard_oceana.sql` (run after the phase 1, phase 1 tables, phase 2, promotions and storage files). It reuses tables that already exist: `stock_items` is the ingredients table, `menu_promotions` is the banner carousel, `loyalty_accounts` / `loyalty_transactions`, `broadcast_campaigns`, `restaurant_tables` / `table_sessions`.

## Feature checklist (Oceana -> Fried King)

### Shell
- [ ] Sidebar with role-filtered nav, mobile drawer, Refresh now, Enable sound, Sign out, name + role tag
- [ ] Header: title, Live pill, "Updated hh:mm:ss", branch switcher (owners)
- [ ] Shift-start gate on phone/tablet (arms sound, keeps screen awake), remembered in localStorage
- [ ] Sound: chime on new order, repeating siren while the accept popup is open, browser notification
- [ ] Screen wake lock
- [ ] Poll every 3 s while on Orders/Tables (skipped while dragging a slider or a popup is open)

### Orders (Oceana "Floor & Orders")
- [ ] Range chips: Today, Yesterday, This Week, This Month, All Time
- [ ] Stats: Revenue, Total orders, Awaiting accept, In the kitchen, Cash to collect
- [ ] Kanban: Dine-in (active rounds), Preparing, Ready, Done; Declined & cancelled drawer
- [ ] Order card: number, customer, phone, time, items with prices, address, tags (type, source, amended), running age clock (15 m warn, 30 m bad), frozen "took N m" when done
- [ ] Slide-to-advance (Preparing -> Ready -> Done); "out for delivery" asks for a rider
- [ ] Buttons: Assign rider, Collect cash, Ready for pickup, Cancel, Edit, Print
- [ ] New-order popup: queue count, details, prep time chips (10/15/20/30/45), slide to accept, decline with reasons (Item unavailable, Kitchen full, Outside delivery area, Closing soon)
- [ ] Mark done popup: payment collected checkbox, send invoice checkbox (not for dine-in)
- [ ] Undo (moving an order backwards or restoring a cancelled one) needs the manager passcode
- [ ] Edit order (pending/preparing only): change quantities, remove, add dishes by search, saves new totals, amendment count, audit diff
- [ ] Order details modal (click a card)
- [ ] 80 mm thermal receipt print, auto-print on accept (setting)
- [ ] Audit log of every action (`order_audit`)
- [ ] Mobile: pill tabs New / Preparing / Ready / Done with big buttons

### Tables (separate page)
- [ ] Stats: Tables open, Food ready, Dine-in in range, Open value
- [ ] "Needs attention" bar (food ready / bill due) that jumps to the table
- [ ] Table cards sorted by urgency: number, seats, section, state, guest, running clock, rounds with status and items, running total
- [ ] Actions: Start order / + Round (opens POS in dine-in mode), Close & pay (amount, invoice, print), Move, Merge, QR (wa.me link), History, Edit round, + Add table

### POS
- [ ] Category rail with counts, search by name/category, Popular shelf (top sellers last 30 days), 8 per category with "All N"
- [ ] Item tiles with image, price, qty badge, stock badge (low/out), sold-out greyed
- [ ] Cart: Takeaway / Delivery / Dine-in, table round banner, steppers, Clear
- [ ] Phone with customer type-ahead, customer card with loyalty points, name, address, pincode, table
- [ ] Redeem loyalty points slider (capped by program), staff discount with reason (manager+)
- [ ] Place order / Send to kitchen; goes straight to Preparing; auto-print

### Live Chat
- [ ] Session list (unread badge, last message, AI off tag), thread, reply as staff, AI on/off switch, back button on mobile

### Menu
- [ ] Grid by category with search, image, sold-out overlay, price, featured pin
- [ ] Switch available, pin to top, edit, delete
- [ ] Add/edit modal: image upload, name, category, description, price, available, featured + combo builder (pick dishes -> description), track stock (qty, low alert, par), build recipe (ingredients + qty)
- [ ] Low / out of stock count

### Stock
- [ ] Tabs: Dishes, Ingredients, Reports; card / list view toggle
- [ ] Stats: tracked, low, out; filter All / Low / Out
- [ ] Per-item: -/+ stepper, Top up to par, Restock (qty, supplier with suggestions, cost, expiry, note), Waste (qty, reason), History
- [ ] Recipe dishes: "Can make N more"
- [ ] Reorder banner (needs restocking, Restock All with suggested qty), Expiring soon
- [ ] Stock take: count everything, review variance, commit
- [ ] Ingredients: add/edit/delete (archive if used in a recipe), quick cost edit, CSV export/import with duplicate detection
- [ ] Reports: stock valuation, consumption by reason for the range, dish profit margins (details per ingredient, margin alert), recipe coverage with "Build a recipe"
- [ ] Every change writes `stock_movements`; sales deduct, cancellations restore

### P&L
- [ ] Range chips incl. custom dates; stats: revenue, gross profit, net margin, net profit/loss
- [ ] Revenue vs net profit trend line, "where the money went" waterfall, statement with deltas vs previous period, recipe coverage warning
- [ ] Expenses by category (donut + table), ledger with delete, Add expense, Export CSV

### Riders
- [ ] Add rider, totals (done, cancelled, collected, still to collect, handed over, riders owe)
- [ ] Per rider: done, cancelled, collected, pending, handed over, owes (with "check" warning), on-duty switch, Collect cash (handover ledger), Delete (blocked while they owe)

### Analytics
- [ ] Range chips incl. custom; Shift close report (printable)
- [ ] Overview pills, order types donut, most ordered items, sales by day with trend + CSV export, hourly heatmap, cancelled orders, sources, new vs returning, loyalty stats (avg days between visits, top customers), riders

### AI Assistant
- [ ] Later (provider not chosen)

### Contacts
- [ ] Stats, CSV drop / paste import, search, segment filter (recent 30 d, inactive 30-59, inactive 60+, repeat, one-time, opted out), sort, select all / clear, "Blast to N selected"

### Loyalty
- [ ] Performance (enrolled, active this month, redemption rate, lifetime issued, redeemed, times redeemed, liability, monthly earned vs redeemed)
- [ ] Program type cards (Points, Visit-based, Cashback) and shared settings, tiers editor, leaderboard with manual redeem
- [ ] Points are earned when an order is marked delivered

### Blast
- [ ] Eligible / selected / sent-this-month with 1000/month cap bar and warnings
- [ ] Audience (selection, everyone, ordered in 30 days, repeat), template name, header image (upload or URL, saved), send queues rows in `outbound_messages`

### Settings
- [ ] Restaurant profile (logo, name, tagline, address, phone), category images, banners (carousel, dates, active)
- [ ] GST % and GSTIN (display on bills only), hours, order types accepted, minimum order, delivery fee, delivery note, delivery pincodes, payment methods text
- [ ] Auto-print, undo passcode, AI unknown policy, Google review link, stock alert defaults (low threshold, expiry warn days, margin alert %)
- [ ] Staff & roles: add (creates the Supabase login), change role, on-duty, remove

Not wired into the customer checkout yet (client rules unknown): minimum order, delivery fee, pincodes, order types. They are stored per branch and shown in Settings.
