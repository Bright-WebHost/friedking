import { calcTotals } from '@/lib/utils'
import { isBoss } from '@/lib/dashboard/access'
import { settleTable } from '@/lib/dashboard/tableSessions'
import { audit, check, emitOrderEvent, getSettings, HttpError, id, int, optStr, str, type Ctx } from '@/lib/dashboard/server'
import type { Handler } from './index'

export const ORDER_SELECT = `id, order_number, token_number, status, order_type, source, payment_method, subtotal_paise, gst_paise, total_paise,
  discount_paise, discount_reason, loyalty_points_redeemed, loyalty_discount_paise, delivery_address, delivery_pincode,
  special_instructions, created_at, updated_at, accepted_at, accepted_by, prep_minutes, ready_at, delivered_at, cancelled_at,
  cancelled_by, cancel_reason, taken_by, rider_id, rider_assigned_at, cash_collected, cash_amount_paise, cash_collected_at,
  payment_taken_by, printed_at, amendment_count, amended_at, table_session_id, table_number, customer_id,
  customer:customers(id, name, phone),
  items:order_items(id, menu_item_id, name_snapshot, unit_price_paise, quantity, line_total_paise, notes, menu_item:menu_items(description))`

type Status = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'delivered' | 'cancelled'
const FLOW: Status[] = ['pending', 'preparing', 'ready', 'delivered']

interface OrderRow {
  id: string
  order_number: number
  status: Status
  order_type: string
  accepted_at: string | null
  total_paise: number
  subtotal_paise: number
  discount_paise: number
  loyalty_discount_paise: number
  cash_collected: boolean
  rider_id: string | null
  customer_id: string
  table_session_id: string | null
}

export async function getOrder(ctx: Ctx, orderId: string): Promise<OrderRow> {
  const row = check(await ctx.admin.from('orders')
    .select('id, order_number, status, order_type, accepted_at, total_paise, subtotal_paise, discount_paise, loyalty_discount_paise, cash_collected, rider_id, customer_id, table_session_id')
    .eq('id', id(orderId, 'order')).eq('branch_id', ctx.branch.id).maybeSingle(), 'load the order')
  if (!row) throw new HttpError(404, 'Order not found')
  return row as OrderRow
}

const stockActive = (status: Status, accepted: boolean) => accepted && status !== 'pending' && status !== 'cancelled'

export function isBackward(from: Status, to: Status) {
  if (from === 'cancelled') return to !== 'cancelled'
  const a = FLOW.indexOf(from === 'confirmed' ? 'preparing' : from)
  const b = FLOW.indexOf(to === 'confirmed' ? 'preparing' : to)
  return a >= 0 && b >= 0 && b < a
}

/** Cancelling needs the passcode too (any role that can open the order; undoing a cancel also needs a manager). */
async function checkCancelCode(ctx: Ctx, passcode: unknown) {
  const settings = await getSettings(ctx)
  if (String(passcode ?? '') !== settings.undo_passcode) throw new HttpError(403, 'Wrong passcode')
}

async function checkPasscode(ctx: Ctx, passcode: unknown) {
  if (!isBoss(ctx.staff.role)) throw new HttpError(403, 'Only a manager can undo')
  const settings = await getSettings(ctx)
  if (String(passcode ?? '') !== settings.undo_passcode) throw new HttpError(403, 'Wrong passcode')
}

/** Every status move goes through here: timestamps, stock, loyalty, outbox, audit. */
export async function moveOrder(ctx: Ctx, order: OrderRow, to: Status, opts: {
  passcode?: unknown; reason?: string | null; prepMinutes?: number | null; extra?: Record<string, unknown>; action?: string; detail?: string
  paymentCollected?: boolean; sendInvoice?: boolean
  expectedRiderId?: string
} = {}) {
  const from = order.status
  if (isBackward(from, to)) await checkPasscode(ctx, opts.passcode)
  else if (to === 'cancelled' && from !== 'cancelled' && opts.action !== 'decline') await checkCancelCode(ctx, opts.passcode)
  if (to === 'delivered' && order.order_type === 'dine-in' && order.table_session_id && from !== 'cancelled') {
    await settleTable(ctx, order.table_session_id, { paymentCollected: opts.paymentCollected, sendInvoice: opts.sendInvoice })
    return { ...order, status: to }
  }
  if (from === to && !opts.extra) return order

  let sendAcceptanceReceipt = !order.accepted_at && (from === 'pending' || from === 'confirmed')
  if (sendAcceptanceReceipt && to === 'preparing' && order.table_session_id) {
    const rounds = check(await ctx.admin.from('orders').select('id')
      .eq('branch_id', ctx.branch.id).eq('table_session_id', order.table_session_id)
      .in('status', ['pending', 'confirmed', 'preparing', 'ready', 'delivered'])
      .order('created_at').order('id').limit(1), 'load the first table round') ?? []
    sendAcceptanceReceipt = sendAcceptanceReceipt && rounds[0]?.id === order.id
  }

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = { status: to, ...(opts.extra ?? {}) }
  let accepted = !!order.accepted_at
  if (to === 'preparing' && !order.accepted_at) {
    updates.accepted_at = now
    updates.accepted_by = ctx.staff.name
    if (opts.prepMinutes) updates.prep_minutes = opts.prepMinutes
    accepted = true
  }
  if (to === 'ready') updates.ready_at = now
  if (to === 'delivered') updates.delivered_at = now
  if (to === 'cancelled') {
    updates.cancelled_at = now
    updates.cancelled_by = ctx.staff.name
    updates.cancel_reason = opts.reason ?? null
  }

  let update = ctx.admin.from('orders').update(updates).eq('id', order.id).eq('status', from)
  if (opts.expectedRiderId) update = update.eq('rider_id', opts.expectedRiderId)
  const res = await update.select('id').maybeSingle()
  check(res, 'update the order')
  if (!res.data) throw new HttpError(409, `Order #${order.order_number} changed on another screen. Refresh and try again.`)

  const before = stockActive(from, !!order.accepted_at)
  const after = stockActive(to, accepted)
  if (before !== after) {
    const { error } = await ctx.admin.rpc('fk_order_stock', { p_order_id: order.id, p_sign: after ? -1 : 1, p_staff: ctx.staff.name })
    if (error) console.error('[dashboard] stock for order', order.order_number, error.message)
  }
  if (to === 'delivered' && from !== 'delivered') {
    const { error } = await ctx.admin.rpc('fk_loyalty_earn', { p_order_id: order.id })
    if (error) console.error('[dashboard] loyalty earn', order.order_number, error.message)
  }

  if (from !== to) {
    const customerNotification = to === 'cancelled'
      ? { kind: 'cancelled', windowOnly: true, reason: opts.reason ?? null }
      : to === 'preparing'
        ? { kind: 'accepted', receipt: sendAcceptanceReceipt, windowOnly: true }
        : to === 'ready' && order.order_type === 'pickup'
          ? { kind: 'ready_for_pickup', windowOnly: true }
          : to === 'delivered' && order.order_type !== 'dine-in'
            ? { kind: 'thank_you', windowOnly: true }
            : null
    await emitOrderEvent(ctx, order.id, 'order_status_changed', {
      orderNumber: order.order_number,
      status: to,
      previousStatus: from,
      orderType: order.order_type,
      customerNotification,
      ...(opts.prepMinutes ? { prepMinutes: opts.prepMinutes } : {}),
      ...(opts.reason ? { reason: opts.reason } : {}),
    })
  }
  await audit(ctx, {
    orderId: order.id, orderNumber: order.order_number,
    action: opts.action ?? (isBackward(from, to) ? 'undo' : 'status_change'),
    from, to, detail: opts.detail ?? opts.reason ?? null,
  })
  return { ...order, status: to }
}

const STATUSES: Status[] = ['pending', 'preparing', 'ready', 'delivered', 'cancelled']
const REAL_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled']
const DECLINE_REASONS = ['Item unavailable', 'Kitchen full', 'Outside delivery area', 'Closing soon']

export async function loadOrders(ctx: Ctx, opts: { since?: string | null; until?: string | null; limit?: number; sessionIds?: string[]; orderId?: string | null }) {
  // Drafts (WhatsApp orders the customer has not confirmed) are not orders yet.
  let q = ctx.admin.from('orders').select(ORDER_SELECT).eq('branch_id', ctx.branch.id).in('status', REAL_STATUSES)
  if (opts.since) q = q.gte('created_at', opts.since)
  if (opts.until) q = q.lt('created_at', opts.until)
  if (opts.orderId) q = q.eq('id', id(opts.orderId, 'order'))
  if (opts.sessionIds) q = q.in('table_session_id', opts.sessionIds.length ? opts.sessionIds : ['00000000-0000-0000-0000-000000000000'])
  return check(await q.order('created_at', { ascending: false }).limit(opts.limit ?? 1500), 'load orders') ?? []
}

export const ordersHandler: Handler = {
  sections: ['orders', 'tables', 'pos', 'analytics', 'pnl', 'riders', 'stock', 'contacts'],
  async get(ctx, params) {
    // Dish list for the Edit order modal (every role can edit an open order).
    if (params.get('view') === 'menu') {
      const items = check(await ctx.admin.from('menu_items').select('id, name, price_paise, is_active, category_id').eq('branch_id', ctx.branch.id).order('sort_order'), 'load the menu') ?? []
      return { items }
    }
    // Light query for the new-order popup: only orders waiting to be accepted.
    if (params.get('pending') === '1') {
      const rows = check(await ctx.admin.from('orders').select(ORDER_SELECT).eq('branch_id', ctx.branch.id).eq('status', 'pending').order('created_at').limit(50), 'load new orders') ?? []
      return { orders: rows, serverTime: new Date().toISOString() }
    }
    const since = params.get('since')
    const until = params.get('until')
    const limit = Math.min(2000, Number(params.get('limit')) || 1500)
    const orders = await loadOrders(ctx, { since, until, limit, orderId: params.get('orderId') })
    return { orders, serverTime: new Date().toISOString() }
  },
  actions: {
    async accept(ctx, b) {
      const order = await getOrder(ctx, b.orderId)
      if (order.status !== 'pending') throw new HttpError(409, `Order #${order.order_number} is already ${order.status}`)
      const prep = int(b.prepMinutes ?? 20, 'prep time', 1, 240)
      await moveOrder(ctx, order, 'preparing', { prepMinutes: prep, action: 'accept', detail: `ready in ${prep} min` })
      return { ok: true }
    },
    async decline(ctx, b) {
      const order = await getOrder(ctx, b.orderId)
      if (order.status !== 'pending') throw new HttpError(409, `Order #${order.order_number} is already ${order.status}`)
      const reason = str(b.reason, 120)
      if (!DECLINE_REASONS.includes(reason) && !reason) throw new HttpError(400, 'Pick a reason first')
      await moveOrder(ctx, order, 'cancelled', { reason, action: 'decline' })
      return { ok: true }
    },
    async status(ctx, b) {
      const order = await getOrder(ctx, b.orderId)
      const to = b.status as Status
      if (!STATUSES.includes(to)) throw new HttpError(400, 'Invalid status')
      await moveOrder(ctx, order, to, { passcode: b.passcode, reason: optStr(b.reason, 120) })
      return { ok: true }
    },
    /** Mark done popup: payment collected + optional invoice. */
    async done(ctx, b) {
      const order = await getOrder(ctx, b.orderId)
      if (b.expectedRiderId && order.rider_id !== b.expectedRiderId) throw new HttpError(409, 'The rider assignment changed')
      const extra: Record<string, unknown> = {}
      if (b.paymentCollected && !order.cash_collected) {
        const now = new Date().toISOString()
        Object.assign(extra, { cash_collected: true, cash_amount_paise: order.total_paise, cash_collected_at: now, payment_taken_by: ctx.staff.name })
      }
      await moveOrder(ctx, order, 'delivered', {
        passcode: b.passcode, extra, paymentCollected: !!b.paymentCollected,
        expectedRiderId: b.expectedRiderId,
        sendInvoice: b.sendInvoice !== false, detail: b.paymentCollected ? 'marked done + payment collected' : 'marked done',
      })
      if (b.sendInvoice && order.order_type !== 'dine-in') {
        await emitOrderEvent(ctx, order.id, 'invoice_requested', { orderNumber: order.order_number, requestedBy: ctx.staff.name })
      }
      return { ok: true }
    },
    async cash(ctx, b) {
      const order = await getOrder(ctx, b.orderId)
      if (order.cash_collected) return { ok: true }
      const now = new Date().toISOString()
      check(await ctx.admin.from('orders').update({
        cash_collected: true, cash_amount_paise: order.total_paise, cash_collected_at: now, payment_taken_by: ctx.staff.name,
      }).eq('id', order.id), 'record the payment')
      await audit(ctx, { orderId: order.id, orderNumber: order.order_number, action: 'payment', to: String(order.total_paise), detail: `collected by ${ctx.staff.name}` })
      return { ok: true }
    },
    async rider(ctx, b) {
      const order = await getOrder(ctx, b.orderId)
      const rider = check(await ctx.admin.from('riders').select('id, name, phone').eq('id', id(b.riderId, 'rider')).eq('branch_id', ctx.branch.id).maybeSingle(), 'load the rider')
      if (!rider) throw new HttpError(404, 'Rider not found')
      check(await ctx.admin.from('orders').update({ rider_id: rider.id, rider_assigned_at: new Date().toISOString() }).eq('id', order.id), 'assign the rider')
      await emitOrderEvent(ctx, order.id, 'rider_assigned', {
        orderNumber: order.order_number, riderName: rider.name, riderPhone: rider.phone,
        amountPaise: order.cash_collected ? 0 : order.total_paise,
      })
      await emitOrderEvent(ctx, order.id, 'customer_rider_assigned', {
        orderNumber: order.order_number, riderName: rider.name, riderPhone: rider.phone,
        customerNotification: { kind: 'rider_assigned', windowOnly: true, riderName: rider.name, riderPhone: rider.phone },
      })
      await audit(ctx, { orderId: order.id, orderNumber: order.order_number, action: 'assign_rider', to: rider.name })
      return { ok: true, riderName: rider.name }
    },
    async printed(ctx, b) {
      const order = await getOrder(ctx, b.orderId)
      await ctx.admin.from('orders').update({ printed_at: new Date().toISOString() }).eq('id', order.id)
      return { ok: true }
    },
    /** Edit items on an order that the kitchen has not finished (pending / preparing). */
    async edit(ctx, b) {
      const order = await getOrder(ctx, b.orderId)
      if (order.status !== 'pending' && order.status !== 'preparing' && order.status !== 'confirmed') {
        throw new HttpError(409, `Can't edit #${order.order_number}: already ${order.status}`)
      }
      if (!Array.isArray(b.lines) || !b.lines.length) throw new HttpError(400, 'An order needs at least one item. Cancel it instead.')

      const original = check(await ctx.admin.from('order_items')
        .select('menu_item_id, name_snapshot, unit_price_paise, quantity, notes').eq('order_id', order.id), 'load order items') ?? []
      const keyOf = (l: { menu_item_id: string | null; name_snapshot: string }) => l.menu_item_id ?? `name:${l.name_snapshot}`
      const known = new Map(original.map((l) => [keyOf(l), l]))

      const wanted = new Map<string, number>()
      for (const line of b.lines as Array<{ key?: string; quantity?: number }>) {
        const qty = int(line.quantity, 'quantity', 1, 50)
        const key = str(line.key, 120)
        wanted.set(key, (wanted.get(key) ?? 0) + qty)
      }
      const newIds = [...wanted.keys()].filter((k) => !known.has(k))
      const fresh = newIds.length
        ? check(await ctx.admin.from('menu_items').select('id, name, price_paise').eq('branch_id', ctx.branch.id).in('id', newIds.map((k) => id(k, 'menu item'))), 'load menu items') ?? []
        : []
      if (fresh.length !== newIds.length) throw new HttpError(409, 'Some dishes are no longer on the menu')
      const freshById = new Map(fresh.map((m) => [m.id, m]))

      const lines = [...wanted.entries()].map(([key, quantity]) => {
        const old = known.get(key)
        if (old) return { menu_item_id: old.menu_item_id, name_snapshot: old.name_snapshot, unit_price_paise: old.unit_price_paise, quantity, notes: old.notes }
        const m = freshById.get(key)!
        return { menu_item_id: m.id, name_snapshot: m.name, unit_price_paise: m.price_paise, quantity, notes: null }
      })

      const before = new Map(original.map((l) => [l.name_snapshot, l.quantity]))
      const after = new Map(lines.map((l) => [l.name_snapshot, l.quantity]))
      const diff = [...new Set([...before.keys(), ...after.keys()])].flatMap((n) => {
        const x = before.get(n) ?? 0, y = after.get(n) ?? 0
        if (x === y) return []
        if (!x) return [`+${n} x${y}`]
        if (!y) return [`−${n}`]
        return [`${n} x${x}→x${y}`]
      }).join('; ') || 'no change'

      const active = stockActive(order.status, !!order.accepted_at)
      if (active) await ctx.admin.rpc('fk_order_stock', { p_order_id: order.id, p_sign: 1, p_staff: ctx.staff.name })

      check(await ctx.admin.from('order_items').delete().eq('order_id', order.id), 'update order items')
      check(await ctx.admin.from('order_items').insert(lines.map((l) => ({ ...l, order_id: order.id, line_total_paise: l.unit_price_paise * l.quantity }))), 'save order items')

      const totals = calcTotals(lines.map((l) => ({ pricePaise: l.unit_price_paise, quantity: l.quantity })))
      const total = Math.max(0, totals.totalPaise - (order.discount_paise ?? 0) - (order.loyalty_discount_paise ?? 0))
      const { data: cur } = await ctx.admin.from('orders').select('amendment_count').eq('id', order.id).single()
      check(await ctx.admin.from('orders').update({
        subtotal_paise: totals.subtotalPaise, gst_paise: totals.gstPaise, total_paise: total,
        amendment_count: (cur?.amendment_count ?? 0) + 1, amended_at: new Date().toISOString(),
      }).eq('id', order.id), 'save the new total')

      if (active) await ctx.admin.rpc('fk_order_stock', { p_order_id: order.id, p_sign: -1, p_staff: ctx.staff.name })
      await audit(ctx, { orderId: order.id, orderNumber: order.order_number, action: 'edit_items', from: String(order.total_paise), to: String(total), detail: diff })
      return { ok: true, totalPaise: total }
    },
  },
}
