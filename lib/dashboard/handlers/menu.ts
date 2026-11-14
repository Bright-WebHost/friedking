import { audit, check, HttpError, id, int, num, optStr, str, uploadImage, type Ctx } from '@/lib/dashboard/server'
import type { Handler } from './index'
import { loadMenu } from './pos'

const bool = (v: unknown) => v === true || v === 'true' || v === 'on' || v === '1'

export async function loadRecipes(ctx: Ctx) {
  const [lines, ingredients] = await Promise.all([
    ctx.admin.from('recipe_lines').select('id, menu_item_id, stock_item_id, qty_per_item, menu_items!inner(branch_id)').eq('menu_items.branch_id', ctx.branch.id),
    ctx.admin.from('stock_items').select('*').eq('branch_id', ctx.branch.id).eq('is_active', true).order('category').order('name'),
  ])
  return {
    recipes: (check(lines, 'load recipes') ?? []).map(({ id: lineId, menu_item_id, stock_item_id, qty_per_item }) => ({ id: lineId, menu_item_id, stock_item_id, qty_per_item: Number(qty_per_item) })),
    ingredients: check(ingredients, 'load ingredients') ?? [],
  }
}

async function getItem(ctx: Ctx, itemId: unknown) {
  const item = check(await ctx.admin.from('menu_items').select('*').eq('id', id(itemId, 'dish')).eq('branch_id', ctx.branch.id).maybeSingle(), 'load the dish')
  if (!item) throw new HttpError(404, 'Dish not found')
  return item
}

export const menuHandler: Handler = {
  sections: ['menu', 'stock'],
  async get(ctx) {
    const [menu, recipes] = await Promise.all([loadMenu(ctx), loadRecipes(ctx)])
    return { ...menu, ...recipes }
  },
  actions: {
    async toggle(ctx, b) {
      const item = await getItem(ctx, b.itemId)
      const field = b.field === 'featured' ? 'featured' : 'is_active'
      const next = !item[field]
      check(await ctx.admin.from('menu_items').update({ [field]: next }).eq('id', item.id), 'update the dish')
      return { ok: true, value: next }
    },
    async save(ctx, b) {
      const existing = b.itemId ? await getItem(ctx, b.itemId) : null
      const name = str(b.name, 120)
      if (!name) throw new HttpError(400, 'Dish name is required')
      const pricePaise = Math.round(num(b.price, 'price') * 100)
      if (pricePaise <= 0) throw new HttpError(400, 'Price is required')

      let categoryId = b.categoryId ? id(b.categoryId, 'category') : null
      const newCategory = str(b.newCategory, 80)
      if (newCategory) {
        const found = check(await ctx.admin.from('menu_categories').select('id').eq('branch_id', ctx.branch.id).ilike('name', newCategory).maybeSingle(), 'find the category')
        if (found) categoryId = found.id
        else {
          const { count } = await ctx.admin.from('menu_categories').select('id', { count: 'exact', head: true }).eq('branch_id', ctx.branch.id)
          categoryId = check(await ctx.admin.from('menu_categories').insert({ branch_id: ctx.branch.id, name: newCategory, sort_order: (count ?? 0) + 1 }).select('id').single(), 'create the category').id
        }
      }
      if (!categoryId) throw new HttpError(400, 'Category is required')

      let recipe: Array<{ stockItemId: string; qty: number }> = []
      try { recipe = JSON.parse(String(b.recipe ?? '[]')) } catch { throw new HttpError(400, 'Invalid recipe') }
      recipe = recipe.map((r) => ({ stockItemId: id(r.stockItemId, 'ingredient'), qty: num(r.qty, 'recipe quantity') }))
      if (recipe.some((r) => r.qty <= 0)) throw new HttpError(400, 'Enter a quantity for every selected ingredient')

      const trackStock = recipe.length ? false : bool(b.trackStock)
      const payload: Record<string, unknown> = {
        name, category_id: categoryId, description: optStr(b.description, 500), price_paise: pricePaise,
        is_veg: bool(b.isVeg), is_active: bool(b.isActive), featured: bool(b.featured), track_stock: trackStock,
        low_stock_threshold: trackStock && b.lowStock !== '' && b.lowStock != null ? int(b.lowStock, 'low-stock alert') : null,
        par_level: trackStock && b.parLevel !== '' && b.parLevel != null ? int(b.parLevel, 'par level') : null,
      }
      if (b.image instanceof File && b.image.size > 0) payload.image_url = await uploadImage(ctx, b.image, 'items', name)

      let itemId: string
      if (existing) {
        check(await ctx.admin.from('menu_items').update(payload).eq('id', existing.id), 'save the dish')
        itemId = existing.id
      } else {
        const { count } = await ctx.admin.from('menu_items').select('id', { count: 'exact', head: true }).eq('branch_id', ctx.branch.id)
        itemId = check(await ctx.admin.from('menu_items').insert({ ...payload, branch_id: ctx.branch.id, sort_order: (count ?? 0) + 1, stock_qty: 0 }).select('id').single(), 'add the dish').id
      }

      // Stock count typed in the form goes through the ledger.
      if (trackStock && b.stockQty !== '' && b.stockQty != null) {
        const qty = int(b.stockQty, 'stock count')
        if (!existing || existing.stock_qty !== qty || !existing.track_stock) {
          const { error } = await ctx.admin.rpc('fk_stock_move', { p_branch_id: ctx.branch.id, p_entity_type: 'menu_item', p_entity_id: itemId, p_delta: 0, p_reason: 'manual_adjust', p_staff: ctx.staff.name, p_set_to: qty, p_extra: { note: 'Set from the dish form' } })
          if (error) console.error('[dashboard] dish stock', error.message)
        }
      }

      check(await ctx.admin.from('recipe_lines').delete().eq('menu_item_id', itemId), 'update the recipe')
      if (recipe.length) {
        check(await ctx.admin.from('recipe_lines').insert(recipe.map((r) => ({ menu_item_id: itemId, stock_item_id: r.stockItemId, qty_per_item: r.qty }))), 'save the recipe')
      }
      await audit(ctx, { action: existing ? 'menu_edit' : 'menu_add', to: name, detail: `₹${(pricePaise / 100).toFixed(2)}` })
      return { ok: true, itemId }
    },
    async remove(ctx, b) {
      const item = await getItem(ctx, b.itemId)
      const res = await ctx.admin.from('menu_items').delete().eq('id', item.id)
      if (res.error) throw new HttpError(409, 'Could not delete. Mark it sold out instead.')
      await audit(ctx, { action: 'menu_delete', from: item.name })
      return { ok: true }
    },
  },
}
