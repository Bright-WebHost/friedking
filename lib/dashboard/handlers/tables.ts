import { normalizePhone } from '@/lib/utils'
import { audit, check, emitOrderEvent, HttpError, id, int, optStr, type Ctx } from '@/lib/dashboard/server'
import type { Handler } from './index'
import { loadOrders } from './orders'

async function getSession(ctx: Ctx, sessionId: unknown) {
  const s = check(await ctx.admin.from('table_sessions').select('*, table:restaurant_tables(id, table_number, seats)')
    .eq('id', id(sessionId, 'tab')).eq('branch_id', ctx.branch.id).maybeSingle(), 'load the tab')
  if (!s) throw new HttpError(404, 'That tab was not found')
  if (s.status !== 'open') throw new HttpError(409, 'That tab is already closed')
  return s
}

export const tablesHandler: Handler = {
  sections: ['tables', 'orders', 'pos'],
  async get(ctx) {
    const [tables, sessions] = await Promise.all([
      ctx.admin.from('restaurant_tables').select('*').eq('branch_id', ctx.branch.id).eq('is_active', true).order('sort_order').order('table_number'),
      ctx.admin.from('table_sessions').select('*').eq('branch_id', ctx.branch.id).eq('status', 'open').order('opened_at', { ascending: false }),
    ])
    const open = check(sessions, 'load open tabs') ?? []
    const orders = await loadOrders(ctx, { sessionIds: open.map((s) => s.id), limit: 500 })
    return { tables: check(tables, 'load tables') ?? [], sessions: open, orders }
  },
  actions: {
    async add(ctx, b) {
      const tableNumber = int(b.tableNumber, 'table number', 1, 999)
      const seats = int(b.seats ?? 4, 'seats', 1, 40)
      const { count } = await ctx.admin.from('restaurant_tables').select('id', { count: 'exact', head: true }).eq('branch_id', ctx.branch.id)
      const res = await ctx.admin.from('restaurant_tables').insert({
        branch_id: ctx.branch.id, table_number: tableNumber, seats, section: optStr(b.section, 40), sort_order: (count ?? 0) + 1,
      })
      if (res.error) throw new HttpError(409, res.error.message.includes('duplicate') ? 'That table already exists' : 'Could not add the table')
      return { ok: true }
    },
    async close(ctx, b) {
      const s = await getSession(ctx, b.sessionId)
      const rounds = (check(await ctx.admin.from('orders').select('id, order_number, total_paise, status, items:order_items(name_snapshot, quantity, line_total_paise)')
        .eq('table_session_id', s.id).neq('status', 'cancelled').order('created_at'), 'load the rounds') ?? [])
      const total = rounds.reduce((sum, o) => sum + o.total_paise, 0)
      const amount = b.amountPaise != null && b.amountPaise !== '' ? int(b.amountPaise, 'amount', 0) : total
      const phone = b.phone ? normalizePhone(String(b.phone)) : null
      const now = new Date().toISOString()

      for (const [i, o] of rounds.entries()) {
        check(await ctx.admin.from('orders').update({
          status: 'delivered', delivered_at: now, cash_collected: true, cash_collected_at: now,
          cash_amount_paise: i === 0 ? amount : 0, payment_taken_by: ctx.staff.name,
        }).eq('id', o.id), 'settle the tab')
        if (o.status !== 'delivered') {
          const { error } = await ctx.admin.rpc('fk_loyalty_earn', { p_order_id: o.id })
          if (error) console.error('[dashboard] loyalty earn on close', error.message)
        }
      }
      check(await ctx.admin.from('table_sessions').update({
        status: 'closed', closed_at: now, closed_by: ctx.staff.userId, closed_by_name: ctx.staff.name,
        closed_total_paise: amount, payment_method: 'cash', phone: phone ?? s.phone,
      }).eq('id', s.id), 'close the tab')

      if (b.sendInvoice && (phone ?? s.phone) && rounds[0]) {
        await emitOrderEvent(ctx, rounds[0].id, 'table_invoice_requested', {
          orderNumber: rounds[0].order_number, sessionId: s.id, tableNumber: s.table?.table_number ?? null,
          phone: phone ?? s.phone, totalPaise: amount, staff: ctx.staff.name,
          customerNotification: { kind: 'table_closed', windowOnly: true, thankYou: true },
          rounds: rounds.map((o) => ({ orderNumber: o.order_number, totalPaise: o.total_paise, items: o.items })),
        })
      }
      await audit(ctx, { orderId: rounds[0]?.id ?? null, orderNumber: rounds[0]?.order_number ?? null, action: 'close_tab', from: 'open', to: 'closed', detail: `table ${s.table?.table_number} · ₹${(amount / 100).toFixed(2)} · ${ctx.staff.name}` })
      return { ok: true, firstOrderId: rounds[0]?.id ?? null }
    },
    async move(ctx, b) {
      const s = await getSession(ctx, b.sessionId)
      const to = check(await ctx.admin.from('restaurant_tables').select('id, table_number').eq('id', id(b.toTableId, 'table')).eq('branch_id', ctx.branch.id).maybeSingle(), 'load the table')
      if (!to) throw new HttpError(404, 'Table not found')
      const busy = await ctx.admin.from('table_sessions').select('id').eq('table_id', to.id).eq('status', 'open').maybeSingle()
      if (busy.data) throw new HttpError(409, `Table ${to.table_number} is not free`)
      check(await ctx.admin.from('table_sessions').update({ table_id: to.id, moved_from: s.table?.table_number ?? null }).eq('id', s.id), 'move the tab')
      check(await ctx.admin.from('orders').update({ table_number: to.table_number }).eq('table_session_id', s.id), 'move the rounds')
      await audit(ctx, { action: 'move_tab', from: String(s.table?.table_number), to: String(to.table_number), detail: `moved by ${ctx.staff.name}` })
      return { ok: true }
    },
    async merge(ctx, b) {
      const s = await getSession(ctx, b.sessionId)
      const target = await getSession(ctx, b.intoSessionId)
      if (target.id === s.id) throw new HttpError(400, 'Pick a different table')
      check(await ctx.admin.from('orders').update({ table_session_id: target.id, table_number: target.table?.table_number ?? null }).eq('table_session_id', s.id), 'move the rounds')
      check(await ctx.admin.from('table_sessions').update({
        status: 'closed', closed_at: new Date().toISOString(), closed_by: ctx.staff.userId, closed_by_name: ctx.staff.name, merged_into: target.id,
      }).eq('id', s.id), 'merge the tab')
      await audit(ctx, { action: 'merge_tab', from: String(s.table?.table_number), to: String(target.table?.table_number), detail: `merged by ${ctx.staff.name}` })
      return { ok: true }
    },
    async history(ctx, b) {
      const tableId = id(b.tableId, 'table')
      const rows = check(await ctx.admin.from('table_sessions').select('id, closed_at, closed_by_name, closed_total_paise, merged_into')
        .eq('branch_id', ctx.branch.id).eq('table_id', tableId).eq('status', 'closed').order('closed_at', { ascending: false }).limit(20), 'load history') ?? []
      return { history: rows }
    },
  },
}
