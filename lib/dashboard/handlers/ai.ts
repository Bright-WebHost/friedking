import { getSettings, HttpError, str, type Ctx } from '@/lib/dashboard/server'
import type { Handler } from './index'
import { loadOrders } from './orders'
import { execute, prepare, type Resolved } from './aiActions'

const rs = (paise: number) => `₹${Math.round(paise / 100).toLocaleString('en-IN')}`
const istDay = (t: string | number) => new Date(new Date(t).getTime() + 19800000).toISOString().slice(0, 10)
const typeName = (t: string) => (t === 'pickup' ? 'takeaway' : t)
// the joined customer comes back as an object or a one-item list depending on the query
const cust = (o: { customer?: unknown }) => (Array.isArray(o.customer) ? o.customer[0] : o.customer) as { name?: string | null; phone?: string } | null | undefined

/** A plain-text snapshot of the branch for the model to answer from. Read-only; built fresh for every question. */
async function snapshot(ctx: Ctx) {
  const settings = await getSettings(ctx)
  const defLow = Number(settings.low_stock_threshold) || 5
  const todayKey = istDay(Date.now())
  const since = new Date(new Date(`${todayKey}T00:00:00+05:30`).getTime() - 6 * 86400000).toISOString()
  const orders = await loadOrders(ctx, { since, limit: 2000 })
  const live = orders.filter((o) => o.status !== 'cancelled')
  const today = live.filter((o) => istDay(o.created_at) === todayKey)

  const lines: string[] = []
  const sum = (rows: typeof live) => rows.reduce((s, o) => s + o.total_paise, 0)
  lines.push(`Branch: ${ctx.branch.name}. Today (IST): ${todayKey}. Hours: ${ctx.branch.opens_at ?? '?'} to ${ctx.branch.closes_at ?? '?'}.`)

  lines.push(`\nTODAY: ${today.length} orders, revenue ${rs(sum(today))}, average ${today.length ? rs(sum(today) / today.length) : '₹0'}. Cancelled today: ${orders.filter((o) => o.status === 'cancelled' && istDay(o.created_at) === todayKey).length}.`)
  for (const t of ['pickup', 'delivery', 'dine-in']) {
    const r = today.filter((o) => o.order_type === t)
    if (r.length) lines.push(`  ${typeName(t)}: ${r.length} orders, ${rs(sum(r))}`)
  }
  const by = (s: string) => live.filter((o) => o.status === s).length
  lines.push(`Right now: ${by('pending')} waiting to be accepted, ${by('preparing')} preparing, ${by('ready')} ready/out. Cash still to collect on today's orders: ${rs(today.filter((o) => !o.cash_collected && o.status !== 'pending').reduce((s, o) => s + o.total_paise, 0))}.`)

  lines.push('\nLAST 7 DAYS (revenue by day):')
  const days = new Map<string, { n: number; v: number }>()
  for (const o of live) { const k = istDay(o.created_at); const d = days.get(k) ?? { n: 0, v: 0 }; d.n++; d.v += o.total_paise; days.set(k, d) }
  for (const k of [...days.keys()].sort()) lines.push(`  ${k}: ${days.get(k)!.n} orders, ${rs(days.get(k)!.v)}`)

  const qty = new Map<string, number>()
  for (const o of live) for (const it of o.items) qty.set(it.name_snapshot, (qty.get(it.name_snapshot) ?? 0) + it.quantity)
  lines.push('\nBEST SELLERS (last 7 days, quantity): ' + ([...qty.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, q]) => `${n} ${q}`).join('; ') || 'none'))

  // customers
  const phones = new Map<string, number>()
  for (const o of live) { const p = cust(o)?.phone; if (p) phones.set(p, (phones.get(p) ?? 0) + o.total_paise) }
  lines.push('TOP CUSTOMERS (last 7 days, spend): ' + ([...phones.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p, v]) => `${cust(live.find((o) => cust(o)?.phone === p) ?? {})?.name || 'Guest'} ${rs(v)}`).join('; ') || 'none'))

  // stock
  const [dishes, ings] = await Promise.all([
    ctx.admin.from('menu_items').select('name, stock_qty, low_stock_threshold').eq('branch_id', ctx.branch.id).eq('track_stock', true),
    ctx.admin.from('stock_items').select('name, unit, quantity, reorder_level').eq('branch_id', ctx.branch.id).eq('is_active', true).eq('track_stock', true),
  ])
  const lowD = (dishes.data ?? []).filter((m) => m.stock_qty <= (m.low_stock_threshold ?? defLow)).map((m) => `${m.name} (${m.stock_qty} left)`)
  const lowI = (ings.data ?? []).filter((i) => Number(i.quantity) <= Number(i.reorder_level ?? defLow)).map((i) => `${i.name} (${Number(i.quantity)} ${i.unit} left)`)
  lines.push('\nLOW OR OUT OF STOCK: ' + ([...lowD, ...lowI].join('; ') || 'nothing is low'))

  // tables
  const { data: sessions } = await ctx.admin.from('table_sessions').select('id, customer_name, opened_at, table:restaurant_tables(table_number)').eq('branch_id', ctx.branch.id).eq('status', 'open')
  if (sessions?.length) {
    const tot = (id: string) => orders.filter((o) => o.table_session_id === id && o.status !== 'cancelled').reduce((s, o) => s + o.total_paise, 0)
    lines.push('OPEN TABLES: ' + sessions.map((s) => { const t = Array.isArray(s.table) ? s.table[0] : s.table; return `Table ${t?.table_number} (${rs(tot(s.id))} so far)` }).join('; '))
  } else lines.push('OPEN TABLES: none')

  // riders
  const [riders, paid, withRider] = await Promise.all([
    ctx.admin.from('riders').select('id, name').eq('branch_id', ctx.branch.id),
    ctx.admin.from('rider_payments').select('rider_id, amount_paise').eq('branch_id', ctx.branch.id),
    ctx.admin.from('orders').select('rider_id, total_paise, cash_collected, cash_amount_paise, status').eq('branch_id', ctx.branch.id).not('rider_id', 'is', null).limit(5000),
  ])
  const owed = (riders.data ?? []).map((r) => {
    const col = (withRider.data ?? []).filter((o) => o.rider_id === r.id && o.cash_collected).reduce((s, o) => s + (o.cash_amount_paise ?? o.total_paise), 0)
    const given = (paid.data ?? []).filter((p) => p.rider_id === r.id).reduce((s, p) => s + p.amount_paise, 0)
    return `${r.name} owes ${rs(Math.max(0, col - given))}`
  })
  lines.push('RIDER CASH: ' + (owed.join('; ') || 'no riders'))
  return lines.join('\n')
}

export const aiHandler: Handler = {
  sections: ['ai'],
  actions: {
    async ask(ctx, b) {
      const question = str(b.question, 600)
      if (!question) throw new HttpError(400, 'Type a question')
      const { data } = await ctx.admin.from('branch_settings').select('value').eq('branch_id', ctx.branch.id).eq('key', 'ai_webhook_url').maybeSingle()
      const url = data?.value
      if (!url) throw new HttpError(503, 'The AI assistant is not connected yet (webhook not set).')

      const history = (Array.isArray(b.history) ? b.history : []).slice(-6)
        .map((m: { role?: string; content?: string }) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: str(m.content, 1500) }))
        .filter((m: { content: string }) => m.content)
      const system =
        'You are the assistant for the staff of Fried King, a fried chicken restaurant in Mangaluru. You are talking to ' + ctx.staff.name + '.\n' +
        'Answer ONLY from the DATA below. Be brief: two to five short lines, exact numbers, rupees with the ₹ sign. ' +
        'If the answer is not in the data, say you do not have that information. Never invent numbers. ' +
        'You can also DO things for staff, but only by proposing an action that staff must confirm. ' +
        'When (and only when) the staff member asks you to change something, answer with one short sentence of what you are about to do, then on a NEW last line write ACTION: followed by ONE JSON object, in English, with no text after it. ' +
        'Allowed actions (use the names exactly as the staff member said them; numbers are plain numbers):\n' +
        '{"type":"stock_add","item":"<ingredient or dish>","qty":10}  add stock received\n' +
        '{"type":"stock_remove","item":"...","qty":2,"reason":"wasted"}  take stock out\n' +
        '{"type":"stock_set","item":"...","qty":25}  set the stock count\n' +
        '{"type":"dish_available","item":"<dish>","available":false}  sold out / back on the menu\n' +
        '{"type":"dish_price","item":"<dish>","price":199}\n' +
        '{"type":"order_accept","order":1023,"minutes":20}\n' +
        '{"type":"order_status","order":1023,"status":"ready|delivered|cancelled|preparing","reason":""}\n' +
        '{"type":"rider_assign","order":1023,"rider":"<rider name>"}\n' +
        '{"type":"setting","key":"free_delivery_enabled|free_delivery_above|delivery_fee|min_order","value":"true or an amount in rupees"}\n' +
        '{"type":"expense","category":"Gas","amount":1200,"note":""}\n' +
        'You may write several ACTION lines (one per line) when one request needs several changes, for example turning on free delivery AND setting its amount. ' +
        'If the request is missing something you need (which item, how much), ask one short question and write NO ACTION line. ' +
        'If it is not on that list, say staff should use that dashboard page. Never claim a change is done: the staff member confirms it after your message. ' +
        'Reply in the language the staff member writes in.\n\nDATA:\n' + await snapshot(ctx)

      let res: Response
      try {
        res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ system, history, question }), signal: AbortSignal.timeout(28000) })
      } catch {
        throw new HttpError(504, 'The assistant took too long. Please try again.')
      }
      const out = await res.json().catch(() => ({}))
      if (!res.ok || !out.reply) throw new HttpError(502, 'The assistant could not answer right now. Please try again.')
      // The model may end its reply with one or more "ACTION: {json}" lines. Resolve each against the database; staff confirm them in the UI.
      let reply = String(out.reply)
      const proposals: Resolved[] = []
      const found = [...reply.matchAll(/^[ 	]*ACTION:\s*(\{.*\})\s*$/gm)]
      if (found.length) {
        reply = reply.slice(0, found[0].index).trim()
        try {
          for (const f of found.slice(0, 5)) proposals.push(await prepare(ctx, JSON.parse(f[1])))
        } catch (e) {
          proposals.length = 0
          reply = e instanceof HttpError ? e.message : 'I could not work that out. Please say it again.'
        }
      }
      return { reply: reply || 'OK.', proposals }
    },
    /** Staff tapped Confirm on a proposed action. */
    async execute(ctx, b) {
      const list = (Array.isArray(b.actions) ? b.actions : []).slice(0, 5)
      if (!list.length) throw new HttpError(400, 'Nothing to confirm')
      const done: string[] = []
      for (const a of list) done.push(await execute(ctx, a as Record<string, unknown>, b.passcode))
      return { ok: true, summary: done.join('; ') }
    },
  },
}
