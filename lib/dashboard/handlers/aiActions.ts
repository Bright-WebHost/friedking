import { audit, check, clearBranchCache, HttpError, str, type Ctx } from '@/lib/dashboard/server'
import { isBoss } from '@/lib/dashboard/access'
import { ordersHandler } from './orders'
import { stockHandler } from './stock'
import { expensesHandler } from './expenses'

/**
 * Things the AI assistant may do for staff. The model only PROPOSES an action (a small JSON object); the server resolves the names
 * to real rows, checks the role, shows staff a summary, and runs it only after they tap Confirm. Every action goes through the same
 * handler code as the dashboard buttons, so stock ledger, audit log and WhatsApp events behave exactly the same.
 */
export type Resolved = { type: string; summary: string; needsPasscode?: boolean; [k: string]: unknown }

const rs = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const SETTINGS_ALLOWED: Record<string, { label: string; kind: 'bool' | 'rupees' }> = {
  free_delivery_enabled: { label: 'Free delivery offer', kind: 'bool' },
  free_delivery_above: { label: 'Free delivery above (₹)', kind: 'rupees' },
  delivery_fee: { label: 'Delivery fee (₹)', kind: 'rupees' },
  min_order: { label: 'Minimum delivery order (₹)', kind: 'rupees' },
}

function pick<T extends { name: string }>(rows: T[], text: string, what: string): T {
  const q = text.trim().toLowerCase()
  if (!q) throw new HttpError(400, `Which ${what}?`)
  const exact = rows.filter((r) => r.name.toLowerCase() === q)
  if (exact.length === 1) return exact[0]
  const part = rows.filter((r) => r.name.toLowerCase().includes(q) || q.includes(r.name.toLowerCase()))
  if (part.length === 1) return part[0]
  if (part.length > 1) throw new HttpError(400, `Which ${what} do you mean: ${part.slice(0, 6).map((r) => r.name).join(', ')}?`)
  throw new HttpError(404, `I could not find a ${what} called "${text}".`)
}

const qtyOf = (v: unknown) => {
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) throw new HttpError(400, 'I need a quantity above zero.')
  return n
}

async function findOrder(ctx: Ctx, v: unknown) {
  const n = Number(String(v ?? '').replace(/\D/g, ''))
  if (!n) throw new HttpError(400, 'Which order number?')
  const { data } = await ctx.admin.from('orders').select('id, order_number, status, order_type').eq('branch_id', ctx.branch.id).eq('order_number', n).maybeSingle()
  if (!data) throw new HttpError(404, `I could not find order #${n}.`)
  return data as { id: string; order_number: number; status: string; order_type: string }
}

async function findStock(ctx: Ctx, name: string) {
  const [ings, dishes] = await Promise.all([
    ctx.admin.from('stock_items').select('id, name, unit, quantity').eq('branch_id', ctx.branch.id).eq('is_active', true),
    ctx.admin.from('menu_items').select('id, name, stock_qty').eq('branch_id', ctx.branch.id).eq('track_stock', true),
  ])
  const all = [
    ...(ings.data ?? []).map((r) => ({ type: 'ingredient' as const, id: r.id as string, name: r.name as string, unit: (r.unit as string) ?? '', qty: Number(r.quantity) })),
    ...(dishes.data ?? []).map((r) => ({ type: 'menu_item' as const, id: r.id as string, name: r.name as string, unit: 'pcs', qty: Number(r.stock_qty) })),
  ]
  return pick(all, name, 'stock item')
}

/** Check an action the model proposed and turn it into something staff can confirm. Throws HttpError with a readable message. */
export async function prepare(ctx: Ctx, raw: Record<string, unknown>): Promise<Resolved> {
  const type = String(raw.type ?? '')
  switch (type) {
    case 'stock_add': case 'stock_remove': case 'stock_set': {
      const it = await findStock(ctx, String(raw.item ?? ''))
      const qty = type === 'stock_set' ? Number(raw.qty) : qtyOf(raw.qty)
      if (type === 'stock_set' && (!Number.isFinite(qty) || qty < 0)) throw new HttpError(400, 'I need the new quantity.')
      const verb = type === 'stock_add' ? `Add ${qty} ${it.unit}` : type === 'stock_remove' ? `Remove ${qty} ${it.unit}` : `Set to ${qty} ${it.unit}`
      return { type, entity: it.type, id: it.id, qty, reason: str(raw.reason, 120), summary: `${verb} · ${it.name} (now ${it.qty} ${it.unit})` }
    }
    case 'dish_available': {
      const { data } = await ctx.admin.from('menu_items').select('id, name, is_active').eq('branch_id', ctx.branch.id)
      const d = pick((data ?? []) as Array<{ id: string; name: string; is_active: boolean }>, String(raw.item ?? ''), 'dish')
      const on = raw.available === true || raw.available === 'true'
      return { type, id: d.id, available: on, summary: `${d.name}: ${on ? 'put back on the menu' : 'mark as sold out'}` }
    }
    case 'dish_price': {
      const { data } = await ctx.admin.from('menu_items').select('id, name, price_paise').eq('branch_id', ctx.branch.id)
      const d = pick((data ?? []) as Array<{ id: string; name: string; price_paise: number }>, String(raw.item ?? ''), 'dish')
      const price = Number(raw.price)
      if (!Number.isFinite(price) || price <= 0) throw new HttpError(400, 'I need the new price.')
      return { type, id: d.id, pricePaise: Math.round(price * 100), summary: `${d.name}: price ${rs(d.price_paise)} → ${rs(Math.round(price * 100))}` }
    }
    case 'order_accept': {
      const o = await findOrder(ctx, raw.order)
      if (o.status !== 'pending') throw new HttpError(409, `Order #${o.order_number} is already ${o.status}.`)
      const minutes = Math.min(240, Math.max(1, Math.round(Number(raw.minutes) || 20)))
      return { type, id: o.id, minutes, summary: `Accept order #${o.order_number} (ready in ${minutes} min)` }
    }
    case 'order_status': {
      const o = await findOrder(ctx, raw.order)
      const status = String(raw.status ?? '')
      if (!['preparing', 'ready', 'delivered', 'cancelled'].includes(status)) throw new HttpError(400, 'Status must be preparing, ready, delivered or cancelled.')
      return {
        type, id: o.id, status, reason: str(raw.reason, 120), needsPasscode: status === 'cancelled' || o.status === 'cancelled',
        summary: `Order #${o.order_number}: ${o.status} → ${status}${status === 'cancelled' ? ' (needs the passcode)' : ''}`,
      }
    }
    case 'rider_assign': {
      const o = await findOrder(ctx, raw.order)
      const { data } = await ctx.admin.from('riders').select('id, name').eq('branch_id', ctx.branch.id).eq('is_active', true)
      const r = pick((data ?? []) as Array<{ id: string; name: string }>, String(raw.rider ?? ''), 'rider')
      return { type, id: o.id, riderId: r.id, summary: `Assign ${r.name} to order #${o.order_number}` }
    }
    case 'setting': {
      if (!isBoss(ctx.staff.role)) throw new HttpError(403, 'Only a manager or owner can change settings.')
      const key = String(raw.key ?? '')
      const def = SETTINGS_ALLOWED[key]
      if (!def) throw new HttpError(400, `I can change: ${Object.values(SETTINGS_ALLOWED).map((d) => d.label).join(', ')}.`)
      let value: string
      if (def.kind === 'bool') value = raw.value === true || raw.value === 'true' ? 'true' : 'false'
      else {
        const n = Number(raw.value)
        if (!Number.isFinite(n) || n < 0) throw new HttpError(400, 'I need a valid amount.')
        value = String(n)
      }
      return { type, key, value, summary: `${def.label} → ${def.kind === 'bool' ? (value === 'true' ? 'ON' : 'OFF') : `₹${value}`}` }
    }
    case 'expense': {
      if (!isBoss(ctx.staff.role)) throw new HttpError(403, 'Only a manager or owner can add expenses.')
      const amount = Number(raw.amount)
      const category = str(raw.category, 60)
      if (!category || !Number.isFinite(amount) || amount <= 0) throw new HttpError(400, 'I need an expense category and amount.')
      return { type, category, amount, note: str(raw.note, 200), summary: `Add expense: ${category} ₹${amount}${raw.note ? ` (${str(raw.note, 60)})` : ''}` }
    }
    default:
      throw new HttpError(400, 'I cannot do that from here yet. Please use the dashboard page for it.')
  }
}

/** Run a prepared action. Everything is re-checked: the browser only sends it back after the staff member tapped Confirm. */
export async function execute(ctx: Ctx, a: Record<string, unknown>, passcode: unknown): Promise<string> {
  const p = await prepare(ctx, await restore(ctx, a))
  const h = (hh: { actions?: Record<string, (c: Ctx, b: Record<string, unknown>) => Promise<unknown>> }, name: string, body: Record<string, unknown>) => hh.actions![name](ctx, body)
  switch (p.type) {
    case 'stock_add':
      await h(stockHandler, 'restock', { type: p.entity, id: p.id, qty: p.qty, note: p.reason || 'Added by AI assistant' })
      break
    case 'stock_remove':
      await h(stockHandler, 'bump', { type: p.entity, id: p.id, delta: -(p.qty as number) })
      break
    case 'stock_set': {
      const cur = await currentQty(ctx, p.entity as string, p.id as string)
      const delta = (p.qty as number) - cur
      if (delta > 0) await h(stockHandler, 'restock', { type: p.entity, id: p.id, qty: delta, note: 'Stock set by AI assistant' })
      else if (delta < 0) await h(stockHandler, 'bump', { type: p.entity, id: p.id, delta })
      break
    }
    case 'dish_available':
      check(await ctx.admin.from('menu_items').update({ is_active: p.available }).eq('id', p.id as string).eq('branch_id', ctx.branch.id), 'update the dish')
      await audit(ctx, { action: 'menu_edit', to: String(p.summary), detail: `via AI assistant · ${ctx.staff.name}` })
      break
    case 'dish_price':
      check(await ctx.admin.from('menu_items').update({ price_paise: p.pricePaise }).eq('id', p.id as string).eq('branch_id', ctx.branch.id), 'update the price')
      await audit(ctx, { action: 'menu_edit', to: String(p.summary), detail: `via AI assistant · ${ctx.staff.name}` })
      break
    case 'order_accept':
      await h(ordersHandler, 'accept', { orderId: p.id, prepMinutes: p.minutes })
      break
    case 'order_status':
      await h(ordersHandler, 'status', { orderId: p.id, status: p.status, reason: p.reason, passcode })
      break
    case 'rider_assign':
      await h(ordersHandler, 'rider', { orderId: p.id, riderId: p.riderId })
      break
    case 'setting': {
      check(await ctx.admin.from('branch_settings').upsert({ branch_id: ctx.branch.id, key: p.key as string, value: p.value as string, updated_at: new Date().toISOString() }, { onConflict: 'branch_id,key' }), 'save the setting')
      clearBranchCache()
      await audit(ctx, { action: 'settings_update', detail: `${p.key}=${p.value} via AI assistant · ${ctx.staff.name}` })
      break
    }
    case 'expense': {
      const today = new Date(Date.now() + 19800000).toISOString().slice(0, 10)
      await h(expensesHandler, 'add', { date: today, category: p.category, amount: p.amount, note: p.note })
      break
    }
  }
  return p.summary
}

async function currentQty(ctx: Ctx, entity: string, id: string) {
  if (entity === 'menu_item') {
    const { data } = await ctx.admin.from('menu_items').select('stock_qty').eq('id', id).eq('branch_id', ctx.branch.id).maybeSingle()
    return Number(data?.stock_qty ?? 0)
  }
  const { data } = await ctx.admin.from('stock_items').select('quantity').eq('id', id).eq('branch_id', ctx.branch.id).maybeSingle()
  return Number(data?.quantity ?? 0)
}

/**
 * The browser sends back the resolved action. To keep it honest, rebuild the model-style request from the ids so prepare() re-validates
 * against the database (a tampered id or quantity cannot reach another branch or skip a check).
 */
async function restore(ctx: Ctx, a: Record<string, unknown>): Promise<Record<string, unknown>> {
  const type = String(a.type ?? '')
  const nameOf = async (table: string, id: unknown) => {
    const { data } = await ctx.admin.from(table).select('name').eq('id', String(id ?? '')).eq('branch_id', ctx.branch.id).maybeSingle()
    if (!data) throw new HttpError(404, 'That item no longer exists.')
    return data.name as string
  }
  const orderNo = async (id: unknown) => {
    const { data } = await ctx.admin.from('orders').select('order_number').eq('id', String(id ?? '')).eq('branch_id', ctx.branch.id).maybeSingle()
    if (!data) throw new HttpError(404, 'That order no longer exists.')
    return data.order_number as number
  }
  if (type.startsWith('stock_')) {
    const table = a.entity === 'menu_item' ? 'menu_items' : 'stock_items'
    return { type, item: await nameOf(table, a.id), qty: a.qty, reason: a.reason }
  }
  if (type === 'dish_available') return { type, item: await nameOf('menu_items', a.id), available: a.available }
  if (type === 'dish_price') return { type, item: await nameOf('menu_items', a.id), price: Number(a.pricePaise) / 100 }
  if (type === 'order_accept') return { type, order: await orderNo(a.id), minutes: a.minutes }
  if (type === 'order_status') return { type, order: await orderNo(a.id), status: a.status, reason: a.reason }
  if (type === 'rider_assign') return { type, order: await orderNo(a.id), rider: await nameOf('riders', a.riderId) }
  return a
}

