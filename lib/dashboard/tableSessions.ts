import { normalizePhone } from '@/lib/utils'
import { audit, check, emitOrderEvent, HttpError, id, int, type Ctx } from './server'

/** Both the order's Done action and Close & pay settle the same table session. */
export async function settleTable(ctx: Ctx, sessionId: string, options: {
  amountPaise?: unknown
  phone?: unknown
  paymentCollected?: boolean
  sendInvoice?: boolean
} = {}) {
  const session = check(await ctx.admin.from('table_sessions')
    .select('*, table:restaurant_tables(id, table_number)')
    .eq('id', id(sessionId, 'tab')).eq('branch_id', ctx.branch.id).maybeSingle(), 'load the tab')
  if (!session) throw new HttpError(404, 'That tab was not found')

  const rounds = check(await ctx.admin.from('orders')
    .select('id, order_number, total_paise, status, updated_at, accepted_at, delivered_at, customer:customers(phone), items:order_items(name_snapshot, quantity, line_total_paise)')
    .eq('branch_id', ctx.branch.id).eq('table_session_id', session.id)
    .in('status', ['pending', 'confirmed', 'preparing', 'ready', 'delivered'])
    .order('created_at').order('id'), 'load the rounds') ?? []
  const firstOrderId = rounds[0]?.id ?? null
  if (session.status === 'closed') return { ok: true, firstOrderId, alreadyClosed: true }

  const total = rounds.reduce((sum, order) => sum + order.total_paise, 0)
  const amount = options.amountPaise != null && options.amountPaise !== '' ? int(options.amountPaise, 'amount', 0) : total
  const customer = rounds[0]?.customer
  const firstCustomer = Array.isArray(customer) ? customer[0] : customer
  const phone = options.phone ? normalizePhone(String(options.phone)) : session.phone || firstCustomer?.phone || null
  if (options.phone && !phone) throw new HttpError(400, 'Enter a valid WhatsApp number')
  const now = new Date().toISOString()

  for (const [index, order] of rounds.entries()) {
    const updates = {
      status: 'delivered', delivered_at: order.delivered_at ?? now,
      ...(!order.accepted_at ? { accepted_at: now, accepted_by: ctx.staff.name } : {}),
      ...(options.paymentCollected !== false ? {
        cash_collected: true, cash_collected_at: now,
        cash_amount_paise: index === 0 ? amount : 0, payment_taken_by: ctx.staff.name,
      } : {}),
    }
    const changed = check(await ctx.admin.from('orders').update(updates)
      .eq('id', order.id).eq('branch_id', ctx.branch.id).eq('status', order.status)
      .eq('updated_at', order.updated_at).select('id').maybeSingle(), 'settle the tab')
    if (!changed) throw new HttpError(409, 'A table order changed on another screen. Refresh and close the table again.')

    if (!order.accepted_at) {
      const { error } = await ctx.admin.rpc('fk_order_stock', { p_order_id: order.id, p_sign: -1, p_staff: ctx.staff.name })
      if (error) console.error('[dashboard] stock on close', error.message)
    }
    // Earning is idempotent per order, including when an interrupted close is retried.
    const { error } = await ctx.admin.rpc('fk_loyalty_earn', { p_order_id: order.id })
    if (error) console.error('[dashboard] loyalty earn on close', error.message)
  }

  const closed = check(await ctx.admin.from('table_sessions').update({
    status: 'closed', closed_at: now, closed_by: ctx.staff.userId, closed_by_name: ctx.staff.name,
    closed_total_paise: amount, payment_method: 'cash', phone,
  }).eq('id', session.id).eq('branch_id', ctx.branch.id).eq('status', 'open')
    .select('id').maybeSingle(), 'close the tab')
  // Only the request that closes the open session queues its final bill.
  if (!closed) return { ok: true, firstOrderId, alreadyClosed: true }

  if (options.sendInvoice !== false && phone && rounds[0]) {
    await emitOrderEvent(ctx, rounds[0].id, 'table_invoice_requested', {
      orderNumber: rounds[0].order_number, sessionId: session.id, tableNumber: session.table?.table_number ?? null,
      phone, totalPaise: amount, staff: ctx.staff.name,
      customerNotification: { kind: 'table_closed', windowOnly: true, thankYou: true },
      rounds: rounds.map((order) => ({ orderNumber: order.order_number, totalPaise: order.total_paise, items: order.items })),
    })
  }
  await audit(ctx, {
    orderId: firstOrderId, orderNumber: rounds[0]?.order_number ?? null,
    action: 'close_tab', from: 'open', to: 'closed',
    detail: `table ${session.table?.table_number} · ₹${(amount / 100).toFixed(2)} · ${ctx.staff.name}`,
  })
  return { ok: true, firstOrderId, alreadyClosed: false }
}
