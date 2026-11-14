import { audit, check, HttpError, id, num, optNum, optStr, str, type Ctx } from '@/lib/dashboard/server'
import type { Handler } from './index'
import { loadMenu } from './pos'
import { loadRecipes } from './menu'

type Entity = 'menu_item' | 'ingredient'
const entity = (v: unknown): Entity => {
  if (v !== 'menu_item' && v !== 'ingredient') throw new HttpError(400, 'Invalid stock item')
  return v
}
const UNITS = ['kg', 'g', 'l', 'ml', 'pcs']

async function move(ctx: Ctx, type: Entity, entityId: string, delta: number, reason: string, extra: Record<string, unknown> = {}, setTo: number | null = null) {
  const { data, error } = await ctx.admin.rpc('fk_stock_move', {
    p_branch_id: ctx.branch.id, p_entity_type: type, p_entity_id: entityId, p_delta: delta,
    p_reason: reason, p_staff: ctx.staff.name, p_set_to: setTo, p_extra: extra,
  })
  if (error) {
    console.error('[dashboard] stock move', error.message)
    throw new HttpError(500, 'Could not update stock')
  }
  return Number(data)
}

async function current(ctx: Ctx, type: Entity, entityId: string) {
  if (type === 'menu_item') {
    const r = check(await ctx.admin.from('menu_items').select('id, name, stock_qty, par_level, track_stock').eq('id', entityId).eq('branch_id', ctx.branch.id).maybeSingle(), 'load the dish')
    if (!r) throw new HttpError(404, 'Dish not found')
    return { name: r.name as string, qty: Number(r.stock_qty), par: r.par_level as number | null }
  }
  const r = check(await ctx.admin.from('stock_items').select('id, name, quantity, par_level, nearest_expiry').eq('id', entityId).eq('branch_id', ctx.branch.id).maybeSingle(), 'load the ingredient')
  if (!r) throw new HttpError(404, 'Ingredient not found')
  return { name: r.name as string, qty: Number(r.quantity), par: r.par_level == null ? null : Number(r.par_level), expiry: r.nearest_expiry as string | null }
}

async function restockOne(ctx: Ctx, type: Entity, entityId: string, qty: number, opts: { supplier?: string | null; costRupees?: number | null; expiry?: string | null; note?: string | null }) {
  const cur = await current(ctx, type, entityId)
  const cost = opts.costRupees != null ? Math.round(opts.costRupees * 100) : null
  const balance = await move(ctx, type, entityId, qty, 'restock', {
    supplier_name: opts.supplier ?? '', cost_per_unit_paise: cost, total_cost_paise: cost != null ? Math.round(cost * qty) : null,
    expiry_date: opts.expiry ?? null, note: opts.note ?? '',
  })
  if (type === 'ingredient') {
    const updates: Record<string, unknown> = {}
    if (cost != null) updates.cost_paise = cost
    if (opts.expiry && (!('expiry' in cur) || !cur.expiry || opts.expiry < cur.expiry)) updates.nearest_expiry = opts.expiry
    if (Object.keys(updates).length) await ctx.admin.from('stock_items').update(updates).eq('id', entityId)
  }
  return balance
}

export const stockHandler: Handler = {
  sections: ['stock', 'menu'],
  async get(ctx, params) {
    if (params.get('view') === 'movements') {
      let q = ctx.admin.from('stock_movements').select('*').eq('branch_id', ctx.branch.id)
      const since = params.get('since'); const until = params.get('until')
      if (since) q = q.gte('created_at', since)
      if (until) q = q.lt('created_at', until)
      return { movements: check(await q.order('created_at', { ascending: false }).limit(5000), 'load stock history') ?? [] }
    }
    const [menu, recipes, suppliers] = await Promise.all([
      loadMenu(ctx), loadRecipes(ctx),
      ctx.admin.from('stock_movements').select('supplier_name').eq('branch_id', ctx.branch.id).not('supplier_name', 'is', null).limit(2000),
    ])
    return { ...menu, ...recipes, suppliers: [...new Set((suppliers.data ?? []).map((r) => r.supplier_name as string))].sort() }
  },
  actions: {
    async bump(ctx, b) {
      return { balance: await move(ctx, entity(b.type), id(b.id), num(b.delta, 'change', -1e9), 'manual_adjust') }
    },
    async topUp(ctx, b) {
      const type = entity(b.type), entityId = id(b.id)
      const cur = await current(ctx, type, entityId)
      if (cur.par == null) throw new HttpError(400, 'Set a par level first')
      return { balance: await move(ctx, type, entityId, 0, 'top_up_par', {}, cur.par) }
    },
    async restock(ctx, b) {
      const qty = num(b.qty, 'quantity')
      if (qty <= 0) throw new HttpError(400, 'Enter the quantity received')
      const balance = await restockOne(ctx, entity(b.type), id(b.id), qty, {
        supplier: optStr(b.supplier, 80), costRupees: optNum(b.cost, 'cost'), expiry: optStr(b.expiry, 10), note: optStr(b.note, 200),
      })
      return { balance }
    },
    async bulkRestock(ctx, b) {
      let count = 0
      for (const r of (Array.isArray(b.rows) ? b.rows : []) as Array<Record<string, unknown>>) {
        const qty = Number(r.qty)
        if (!qty || qty <= 0) continue
        await restockOne(ctx, entity(r.type), id(r.id), qty, { costRupees: optNum(r.cost, 'cost') })
        count++
      }
      return { count }
    },
    async waste(ctx, b) {
      const qty = num(b.qty, 'quantity')
      const note = str(b.note, 200)
      if (qty <= 0) throw new HttpError(400, 'Enter the quantity')
      if (!note) throw new HttpError(400, 'A reason is required for waste')
      return { balance: await move(ctx, entity(b.type), id(b.id), -qty, 'waste', { note }) }
    },
    async history(ctx, b) {
      const type = entity(b.type), entityId = id(b.id)
      const rows = check(await ctx.admin.from('stock_movements').select('*').eq('entity_type', type).eq('entity_id', entityId)
        .order('created_at', { ascending: false }).limit(50), 'load history') ?? []
      return { movements: rows }
    },
    async stockTake(ctx, b) {
      let n = 0
      for (const r of (Array.isArray(b.counts) ? b.counts : []) as Array<Record<string, unknown>>) {
        const counted = num(r.counted, 'count')
        const type = entity(r.type)
        const cur = await current(ctx, type, id(r.id))
        await move(ctx, type, id(r.id), 0, 'stock_take', { note: counted === cur.qty ? 'Physical count matched system' : 'Physical count' }, counted)
        n++
      }
      await audit(ctx, { action: 'stock_take', detail: `${n} items counted by ${ctx.staff.name}` })
      return { count: n }
    },
    async saveIngredient(ctx, b) {
      const name = str(b.name, 80)
      if (!name) throw new HttpError(400, 'Name is required')
      const unit = UNITS.includes(String(b.unit)) ? String(b.unit) : 'kg'
      const qty = num(b.qty, 'current stock')
      const cost = optNum(b.cost, 'cost')
      const payload = {
        name, category: optStr(b.category, 60), unit,
        reorder_level: optNum(b.lowStock, 'low-stock alert'), par_level: optNum(b.parLevel, 'par level'),
        cost_paise: cost == null ? null : Math.round(cost * 100), track_stock: true,
      }
      let ingredientId: string
      if (b.id) {
        ingredientId = id(b.id, 'ingredient')
        const res = await ctx.admin.from('stock_items').update(payload).eq('id', ingredientId).eq('branch_id', ctx.branch.id)
        if (res.error) throw new HttpError(409, res.error.message.includes('duplicate') ? 'That ingredient name is already used' : 'Could not save')
        const cur = await current(ctx, 'ingredient', ingredientId)
        if (cur.qty !== qty) await move(ctx, 'ingredient', ingredientId, 0, 'manual_adjust', { note: 'Edited' }, qty)
      } else {
        const res = await ctx.admin.from('stock_items').insert({ ...payload, branch_id: ctx.branch.id, quantity: 0 }).select('id').single()
        if (res.error) throw new HttpError(409, 'Could not add the ingredient')
        ingredientId = res.data.id
        if (qty) await move(ctx, 'ingredient', ingredientId, 0, 'manual_adjust', { note: 'Opening stock' }, qty)
      }
      return { ok: true, id: ingredientId }
    },
    async cost(ctx, b) {
      const cost = optNum(b.cost, 'cost')
      check(await ctx.admin.from('stock_items').update({ cost_paise: cost == null ? null : Math.round(cost * 100) }).eq('id', id(b.id)).eq('branch_id', ctx.branch.id), 'update the cost')
      return { ok: true }
    },
    async deleteIngredient(ctx, b) {
      const ingredientId = id(b.id)
      const { count } = await ctx.admin.from('recipe_lines').select('id', { count: 'exact', head: true }).eq('stock_item_id', ingredientId)
      if (count) return { inRecipe: true }
      check(await ctx.admin.from('stock_items').delete().eq('id', ingredientId).eq('branch_id', ctx.branch.id), 'delete the ingredient')
      return { ok: true }
    },
    async archiveIngredient(ctx, b) {
      check(await ctx.admin.from('stock_items').update({ is_active: false }).eq('id', id(b.id)).eq('branch_id', ctx.branch.id), 'archive the ingredient')
      return { ok: true }
    },
    /** CSV import: rows already matched in the browser; id present = update. */
    async importCsv(ctx, b) {
      let created = 0, updated = 0
      for (const r of (Array.isArray(b.rows) ? b.rows : []) as Array<Record<string, unknown>>) {
        const name = str(r.name, 80)
        if (!name) continue
        const payload: Record<string, unknown> = {
          name, category: optStr(r.category, 60), unit: UNITS.includes(String(r.unit)) ? String(r.unit) : 'kg', track_stock: true,
          reorder_level: optNum(r.lowStock, 'low-stock alert'), par_level: optNum(r.parLevel, 'par level'),
        }
        const cost = optNum(r.cost, 'cost')
        if (cost != null) payload.cost_paise = Math.round(cost * 100)
        const qty = optNum(r.qty, 'stock')
        if (r.id) {
          const ingredientId = id(r.id)
          check(await ctx.admin.from('stock_items').update(payload).eq('id', ingredientId).eq('branch_id', ctx.branch.id), 'import')
          if (qty != null) await move(ctx, 'ingredient', ingredientId, 0, 'manual_adjust', { note: 'CSV import' }, qty)
          updated++
        } else {
          const res = await ctx.admin.from('stock_items').insert({ ...payload, branch_id: ctx.branch.id, quantity: 0 }).select('id').single()
          if (res.error) continue
          if (qty) await move(ctx, 'ingredient', res.data.id, 0, 'manual_adjust', { note: 'CSV import' }, qty)
          created++
        }
      }
      return { created, updated }
    },
  },
}
