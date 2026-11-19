import { calcTotals, normalizePhone } from '@/lib/utils'
import { isBoss } from '@/lib/dashboard/access'
import { audit, check, emitOrderEvent, getSettings, HttpError, id, int, optStr, str, type Ctx } from '@/lib/dashboard/server'
import type { Handler } from './index'

/** Customers with order count, last order and loyalty balance (POS type-ahead, Contacts, Blast). */
export async function loadCustomers(ctx: Ctx) {
  const [customers, orders, accounts] = await Promise.all([
    ctx.admin.from('customers').select('*').eq('branch_id', ctx.branch.id).order('created_at', { ascending: false }).limit(5000),
    ctx.admin.from('orders').select('customer_id, created_at, status').eq('branch_id', ctx.branch.id).in('status', ['pending', 'confirmed', 'preparing', 'ready', 'delivered']).limit(20000),
    ctx.admin.from('loyalty_accounts').select('customer_id, points_balance, lifetime_points, tier'),
  ])
  const stats = new Map<string, { n: number; last: string }>()
  for (const o of check(orders, 'load orders') ?? []) {
    const s = stats.get(o.customer_id) ?? { n: 0, last: '' }
    s.n += 1
    if (o.created_at > s.last) s.last = o.created_at
    stats.set(o.customer_id, s)
  }
  const acct = new Map((accounts.data ?? []).map((a) => [a.customer_id, a]))
  return (check(customers, 'load customers') ?? []).map((c) => ({
    id: c.id as string,
    phone: c.phone as string,
    name: (c.name as string | null) ?? null,
    created_at: c.created_at as string,
    opted_out: !!c.opted_out,
    source: (c.source as string | undefined) ?? 'order',
    total_orders: stats.get(c.id)?.n ?? 0,
    last_order_at: stats.get(c.id)?.last || null,
    points_balance: acct.get(c.id)?.points_balance ?? 0,
    lifetime_points: acct.get(c.id)?.lifetime_points ?? 0,
    tier: acct.get(c.id)?.tier ?? null,
  }))
}

export async function loadProgram(ctx: Ctx) {
  const { data } = await ctx.admin.from('loyalty_programs').select('*').eq('branch_id', ctx.branch.id).eq('is_active', true).maybeSingle()
  return data
}

export async function loadMenu(ctx: Ctx) {
  const [items, categories] = await Promise.all([
    ctx.admin.from('menu_items').select('*').eq('branch_id', ctx.branch.id).order('sort_order'),
    ctx.admin.from('menu_categories').select('id, name, sort_order, is_active, image_url').eq('branch_id', ctx.branch.id).order('sort_order'),
  ])
  return { items: check(items, 'load the menu') ?? [], categories: check(categories, 'load categories') ?? [] }
}

/** Most sold dishes (by quantity) in the last 30 days; all-time if that is too thin. */
async function popular(ctx: Ctx) {
  const rank = async (since: string | null) => {
    let q = ctx.admin.from('order_items').select('menu_item_id, quantity, orders!inner(branch_id, created_at, status)')
      .eq('orders.branch_id', ctx.branch.id).in('orders.status', ['pending', 'confirmed', 'preparing', 'ready', 'delivered'])
    if (since) q = q.gte('orders.created_at', since)
    const rows = (await q.limit(20000)).data ?? []
    const agg = new Map<string, number>()
    for (const r of rows) if (r.menu_item_id) agg.set(r.menu_item_id, (agg.get(r.menu_item_id) ?? 0) + r.quantity)
    return [...agg.entries()].sort((a, b) => b[1] - a[1]).map(([k]) => k)
  }
  let ids = await rank(new Date(Date.now() - 30 * 86400000).toISOString())
  if (ids.length < 6) ids = await rank(null)
  return ids.slice(0, 10)
}

export const posHandler: Handler = {
  sections: ['pos'],
  async get(ctx) {
    const [menu, customers, program, popularIds] = await Promise.all([loadMenu(ctx), loadCustomers(ctx), loadProgram(ctx), popular(ctx)])
    return { ...menu, customers, program, popularIds }
  },
  actions: {
    async create(ctx, b) {
      const phone = normalizePhone(str(b.phone, 20))
      if (!phone) throw new HttpError(400, 'Enter a valid WhatsApp number')
      const name = str(b.name, 80)
      const type = b.orderType as 'pickup' | 'delivery' | 'dine-in'
      if (!['pickup', 'delivery', 'dine-in'].includes(type)) throw new HttpError(400, 'Pick takeaway, delivery or dine-in')
      const address = str(b.address, 400)
      const pincode = str(b.pincode, 6)
      const tableNumber = type === 'dine-in' ? int(b.tableNumber, 'table number', 1, 999) : null
      if (type === 'delivery' && !address) throw new HttpError(400, 'Delivery needs an address')
      if (!Array.isArray(b.lines) || !b.lines.length) throw new HttpError(400, 'Add at least one dish')

      const qty = new Map<string, number>()
      const notes = new Map<string, string>()
      for (const l of b.lines as Array<{ itemId?: string; quantity?: number; notes?: string }>) {
        const itemId = id(l.itemId, 'dish')
        qty.set(itemId, (qty.get(itemId) ?? 0) + int(l.quantity, 'quantity', 1, 50))
        if (l.notes) notes.set(itemId, str(l.notes, 200))
      }
      const dbItems = check(await ctx.admin.from('menu_items').select('id, name, price_paise, is_active')
        .eq('branch_id', ctx.branch.id).in('id', [...qty.keys()]), 'load dishes') ?? []
      if (dbItems.length !== qty.size) throw new HttpError(409, 'Some dishes are no longer on the menu')
      const off = dbItems.find((i) => !i.is_active)
      if (off) throw new HttpError(409, `${off.name} is marked sold out`)
      const lines = dbItems.map((i) => ({ id: i.id, name: i.name, pricePaise: i.price_paise, quantity: qty.get(i.id)! }))
      const totals = calcTotals(lines)

      // Staff discount (managers and owners only).
      const discountPct = b.discountPct === undefined || b.discountPct === null || b.discountPct === ''
        ? null : int(b.discountPct, 'discount percentage', 0, 100)
      const discountPaise = discountPct === null
        ? (b.discountPaise ? int(b.discountPaise, 'discount', 0, totals.totalPaise) : 0)
        : Math.round(totals.totalPaise * discountPct / 100)
      if (discountPaise && !isBoss(ctx.staff.role)) throw new HttpError(403, 'Only a manager can give a discount')
      if (discountPaise) {
        const settings = await getSettings(ctx)
        if (String(b.discountPasscode ?? '') !== settings.discount_passcode) throw new HttpError(403, 'Wrong discount passcode')
      }
      const discountReason = discountPaise ? optStr(b.discountReason, 120) : null

      // Customer
      const { data: existing } = await ctx.admin.from('customers').select('id, name').eq('branch_id', ctx.branch.id).eq('phone', phone).maybeSingle()
      let customerId = existing?.id as string | undefined
      if (!customerId) {
        customerId = check(await ctx.admin.from('customers').insert({ branch_id: ctx.branch.id, phone, name: name || null, source: 'pos' }).select('id').single(), 'save the customer').id
      } else if (name && !existing?.name) {
        await ctx.admin.from('customers').update({ name }).eq('id', customerId)
      }

      // Loyalty redemption (capped by the program's max % per order).
      let redeemPoints = b.redeemPoints ? int(b.redeemPoints, 'points', 0, 1_000_000) : 0
      let loyaltyDiscountPaise = 0
      if (redeemPoints) {
        const program = await loadProgram(ctx)
        if (!program) throw new HttpError(400, 'No loyalty program is active')
        const maxPaise = Math.floor((totals.totalPaise - discountPaise) * program.max_redeem_pct_per_order / 100)
        redeemPoints = Math.min(redeemPoints, Math.floor(maxPaise / program.redemption_paise_per_point))
        loyaltyDiscountPaise = redeemPoints * program.redemption_paise_per_point
      }

      // Dine-in: attach to the open tab for that table, or open one.
      let sessionId: string | null = null
      let tableHasPreviousRounds = false
      if (type === 'dine-in') {
        const table = check(await ctx.admin.from('restaurant_tables').select('id').eq('branch_id', ctx.branch.id)
          .eq('table_number', tableNumber).eq('is_active', true).maybeSingle(), 'load the table')
        if (!table) throw new HttpError(404, `Table ${tableNumber} does not exist. Add it on the Tables page.`)
        const open = check(await ctx.admin.from('table_sessions').select('id, customer_name, phone').eq('table_id', table.id).eq('status', 'open').maybeSingle(), 'load the table tab')
        if (open) {
          sessionId = open.id
          const { count } = await ctx.admin.from('orders').select('id', { count: 'exact', head: true }).eq('table_session_id', open.id)
          tableHasPreviousRounds = (count ?? 0) > 0
          if (!open.phone || !open.customer_name) {
            await ctx.admin.from('table_sessions').update({ phone: open.phone ?? phone, customer_name: open.customer_name ?? (name || null) }).eq('id', open.id)
          }
        } else {
          sessionId = check(await ctx.admin.from('table_sessions').insert({
            branch_id: ctx.branch.id, table_id: table.id, status: 'open', opened_by: ctx.staff.userId,
            opened_by_name: ctx.staff.name, customer_name: name || null, phone,
          }).select('id').single(), 'open the table').id
        }
      }

      const now = new Date().toISOString()
      const total = Math.max(0, Math.round((totals.totalPaise - discountPaise - loyaltyDiscountPaise) / 100) * 100)
      const order = check(await ctx.admin.from('orders').insert({
        branch_id: ctx.branch.id, customer_id: customerId, status: 'preparing', source: 'pos',
        subtotal_paise: totals.subtotalPaise, gst_paise: totals.gstPaise, total_paise: total,
        discount_paise: discountPaise, discount_reason: discountReason,
        loyalty_points_redeemed: redeemPoints, loyalty_discount_paise: loyaltyDiscountPaise,
        order_type: type, payment_method: 'cash', delivery_address: type === 'delivery' ? address : null,
        delivery_pincode: type === 'delivery' ? pincode || null : null,
        table_session_id: sessionId, table_number: tableNumber,
        accepted_at: now, accepted_by: ctx.staff.name, taken_by: ctx.staff.name,
        idempotency_key: `pos-${crypto.randomUUID()}`,
      }).select('id, order_number').single(), 'create the order')

      check(await ctx.admin.from('order_items').insert(lines.map((l) => ({
        order_id: order.id, menu_item_id: l.id, name_snapshot: l.name, unit_price_paise: l.pricePaise,
        quantity: l.quantity, line_total_paise: l.pricePaise * l.quantity, notes: notes.get(l.id) ?? null,
      }))), 'save the order items')

      if (redeemPoints) {
        const { data: r } = await ctx.admin.rpc('fk_loyalty_redeem', { p_customer_id: customerId, p_points: redeemPoints, p_order_id: order.id, p_note: `POS order #${order.order_number}`, p_staff: ctx.staff.name })
        if (!r?.ok) {
          // Points could not be taken: charge the full amount instead of giving a free discount.
          await ctx.admin.from('orders').update({ loyalty_points_redeemed: 0, loyalty_discount_paise: 0, total_paise: total + loyaltyDiscountPaise }).eq('id', order.id)
        }
      }

      const { error: stockError } = await ctx.admin.rpc('fk_order_stock', { p_order_id: order.id, p_sign: -1, p_staff: ctx.staff.name })
      if (stockError) console.error('[dashboard] POS stock', stockError.message)

      let tableRunningTotalPaise: number | null = null
      if (sessionId) {
        const { data: tableOrders, error: tableTotalError } = await ctx.admin.from('orders')
          .select('total_paise').eq('table_session_id', sessionId).neq('status', 'cancelled')
        if (tableTotalError) console.error('[dashboard] POS table total', tableTotalError.message)
        else tableRunningTotalPaise = (tableOrders ?? []).reduce((sum, row) => sum + Number(row.total_paise ?? 0), 0)
      }

      await emitOrderEvent(ctx, order.id, 'order_created', {
        orderNumber: order.order_number, branchName: ctx.branch.name, customerName: name || null, customerPhone: phone,
        orderType: type, paymentMethod: 'cash', deliveryAddress: type === 'delivery' ? address : null,
        specialInstructions: null, source: 'pos', tableNumber,
        items: lines.map((l) => ({ name: l.name, quantity: l.quantity, unitPricePaise: l.pricePaise })),
        subtotalPaise: totals.subtotalPaise, gstPaise: totals.gstPaise, totalPaise: total,
        ...(sessionId && tableHasPreviousRounds ? { customerNotification: { kind: 'table_round_added', windowOnly: true, tableNumber, roundTotalPaise: total, tableRunningTotalPaise } } : {}),
      })
      await audit(ctx, { orderId: order.id, orderNumber: order.order_number, action: 'pos_order', to: 'preparing', detail: `${type}${tableNumber ? ` · table ${tableNumber}` : ''} · by ${ctx.staff.name}` })
      return { orderId: order.id, orderNumber: order.order_number, totalPaise: total }
    },
  },
}
