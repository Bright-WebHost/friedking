'use client'

import { useState } from 'react'
import type { DCategory, DIngredient, DMenuItem, DRecipeLine } from '@/lib/dashboard/types'
import { Img, Loading, Modal, rs, Switch, useDash, useLoad, VegMark } from '../kit'
import { maxMakeable, refDish, StockRow, useStockActions, type StockActions } from './stockParts'

export interface MenuData { items: DMenuItem[]; categories: DCategory[]; recipes: DRecipeLine[]; ingredients: DIngredient[]; suppliers?: string[] }

export default function Menu() {
  const { api, toast, settings } = useDash()
  const { data, error, reload } = useLoad(() => api.get<MenuData>('menu'), [api])
  const [q, setQ] = useState('')
  const [modal, setModal] = useState<React.ReactNode>(null)
  const stock = useStockActions(reload, [], data ? { recipes: data.recipes, items: data.items } : undefined)
  if (!data) return <Loading error={error} onRetry={reload} />

  const defLow = Number(settings.low_stock_threshold) || 5
  const query = q.trim().toLowerCase()
  const catName = (id: string) => data.categories.find((c) => c.id === id)?.name ?? 'Uncategorised'
  const rows = query ? data.items.filter((m) => m.name.toLowerCase().includes(query) || catName(m.category_id).toLowerCase().includes(query)) : data.items
  const lowCount = data.items.filter((m) => m.track_stock && m.stock_qty <= (m.low_stock_threshold ?? defLow)).length
  const close = () => setModal(null)

  const toggle = async (m: DMenuItem, field: 'is_active' | 'featured') => {
    try {
      const r = await api.post<{ value: boolean }>('menu', 'toggle', { itemId: m.id, field })
      toast(field === 'is_active' ? `${m.name}${r.value ? ' back on the menu' : ' marked sold out'}` : `${m.name}${r.value ? ' pinned to top of customer menu' : ' unpinned'}`)
      void reload()
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not update') }
  }
  const remove = (m: DMenuItem) => setModal(<Modal onClose={close}><h3>Delete {m.name}?</h3><p>This removes it from the menu permanently. Past orders keep their copy of the name and price.</p>
    <div className="mrow"><button onClick={close}>Cancel</button><button className="x" onClick={async () => {
      close()
      try { await api.post('menu', 'remove', { itemId: m.id }); toast(`${m.name} deleted`); void reload() } catch (e) { toast(e instanceof Error ? e.message : 'Could not delete') }
    }}>Delete</button></div></Modal>)
  const edit = (m: DMenuItem | null, opts: { recipe?: boolean; track?: boolean } = {}) =>
    setModal(<ItemModal item={m} data={data} opts={opts} onClose={close} onSaved={() => { close(); void reload() }} />)

  return (
    <section>
      <div className="mhead">
        <div><h2>Menu Management</h2><p>Manage your menu items, categories, and availability.</p></div>
        <button className="btn sm" style={{ padding: '11px 18px' }} onClick={() => edit(null)}>+ Add Item</button>
      </div>
      {lowCount > 0 && <div className="stats"><div className="stat r"><span>Low / Out of Stock</span><b>{lowCount}</b></div></div>}
      <input className="srch" placeholder={`Search ${data.items.length} items…`} value={q} onChange={(e) => setQ(e.target.value)} />
      {data.categories.map((c) => {
        const items = rows.filter((m) => m.category_id === c.id)
        return items.length ? (
          <div className="mcat" key={c.id}>
            <h4>{c.name} <span className="mcatcount">{items.length}</span></h4>
            <div className="mgrid">{items.map((m) => <MenuCard key={m.id} m={m} data={data} stock={stock} defLow={defLow} onToggle={toggle} onEdit={edit} onRemove={remove} />)}</div>
          </div>
        ) : null
      })}
      {!rows.length && <div className="none">No items matched</div>}
      {modal}{stock.modal}
    </section>
  )
}

export function MenuCard({ m, data, stock, defLow, onToggle, onEdit, onRemove }: {
  m: DMenuItem; data: MenuData; stock: StockActions; defLow: number
  onToggle: (m: DMenuItem, f: 'is_active' | 'featured') => void
  onEdit: (m: DMenuItem, opts?: { recipe?: boolean; track?: boolean }) => void
  onRemove: (m: DMenuItem) => void
}) {
  const make = maxMakeable(m.id, data.recipes, data.ingredients)
  return (
    <div className={`micard ${m.is_active ? '' : 'off'} ${m.featured ? 'pinned' : ''}`}>
      <div className="mi-imgwrap">
        <Img src={m.image_url} alt={m.name} />
        <span className="mi-veg"><VegMark veg={m.is_veg} /></span>
        {m.featured && <span className="mi-pin">📌 Featured</span>}
        {!m.is_active && <div className="mi-sold">Sold out</div>}
      </div>
      <div className="mi-body2">
        <b>{m.name}</b>
        {m.description && <p>{m.description}</p>}
        <div className="mi-price2">{rs(m.price_paise)}</div>
      </div>
      {m.track_stock ? <StockRow r={refDish(m, defLow)} a={stock} /> : make != null && (
        <div className={`mi-stockrow ${make <= 0 ? 'out' : ''}`}>
          <div className="mi-stocktop"><span>{make <= 0 ? "Can't make any right now" : `Can make ${make} more`}</span></div>
          <div className="mi-stockacts"><button onClick={() => onEdit(m, { recipe: true })}>✏️ Edit Recipe</button></div>
        </div>
      )}
      <div className="mi-foot">
        <Switch on={m.is_active} onClick={() => onToggle(m, 'is_active')} label={m.is_active ? 'Mark sold out' : 'Mark available'} />
        <div className="mi-acts">
          <button className={m.featured ? 'pinon' : ''} title={m.featured ? 'Unpin' : 'Pin to top of customer menu'} onClick={() => onToggle(m, 'featured')}>📌</button>
          <button title="Edit" onClick={() => onEdit(m)}>✏️</button>
          <button className="danger" title="Delete" onClick={() => onRemove(m)}>🗑️</button>
        </div>
      </div>
    </div>
  )
}

/** Add / edit a dish: image, category, veg, price, combo builder, stock tracking and recipe. */
export function ItemModal({ item, data, opts = {}, onClose, onSaved }: { item: DMenuItem | null; data: MenuData; opts?: { recipe?: boolean; track?: boolean }; onClose: () => void; onSaved: () => void }) {
  const { api, toast } = useDash()
  const [name, setName] = useState(item?.name ?? '')
  const [categoryId, setCategoryId] = useState(item?.category_id ?? data.categories[0]?.id ?? '')
  const [newCat, setNewCat] = useState('')
  const [desc, setDesc] = useState(item?.description ?? '')
  const [price, setPrice] = useState(item ? String(item.price_paise / 100) : '')
  const [veg, setVeg] = useState(item?.is_veg ?? false)
  const [active, setActive] = useState(item?.is_active ?? true)
  const [featured, setFeatured] = useState(item?.featured ?? false)
  const [track, setTrack] = useState(opts.track || (item?.track_stock ?? false))
  const [stockQty, setStockQty] = useState(item?.track_stock ? String(item.stock_qty) : '')
  const [low, setLow] = useState(item?.low_stock_threshold != null ? String(item.low_stock_threshold) : '')
  const [par, setPar] = useState(item?.par_level != null ? String(item.par_level) : '')
  const existing = item ? data.recipes.filter((l) => l.menu_item_id === item.id) : []
  const [recipeOn, setRecipeOn] = useState(!!opts.recipe || existing.length > 0)
  const [recipe, setRecipe] = useState<Record<string, string>>(() => Object.fromEntries(existing.map((l) => [l.stock_item_id, String(l.qty_per_item)])))
  const [rq, setRq] = useState('')
  const [combo, setCombo] = useState<Record<string, number>>({})
  const [cq, setCq] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<string | null>(item?.image_url ?? null)
  const [saving, setSaving] = useState(false)

  const syncCombo = (next: Record<string, number>) => {
    setCombo(next)
    const parts = Object.entries(next).map(([id, n]) => { const m = data.items.find((x) => x.id === id); return m ? `${n > 1 ? `${n}x ` : ''}${m.name}` : null }).filter(Boolean)
    if (parts.length) setDesc(parts.join(', '))
  }

  const save = async () => {
    if (!name.trim() || !Number(price) || (!categoryId && !newCat.trim())) { toast('Name, category and price are all required'); return }
    const lines = recipeOn ? Object.entries(recipe).map(([stockItemId, qty]) => ({ stockItemId, qty: Number(qty) })) : []
    if (lines.some((l) => !l.qty || l.qty <= 0)) { toast('Enter a quantity for every selected ingredient'); return }
    if (track && !recipeOn && stockQty.trim() === '') { toast('Enter the current stock count'); return }
    const f = new FormData()
    if (item) f.set('itemId', item.id)
    f.set('name', name); f.set('price', price); f.set('description', desc)
    if (newCat.trim()) f.set('newCategory', newCat.trim()); else f.set('categoryId', categoryId)
    f.set('isVeg', String(veg)); f.set('isActive', String(active)); f.set('featured', String(featured))
    f.set('trackStock', String(track && !recipeOn)); f.set('stockQty', stockQty); f.set('lowStock', low); f.set('parLevel', par)
    f.set('recipe', JSON.stringify(lines))
    if (file) f.set('image', file)
    setSaving(true)
    try { await api.form('menu', 'save', f); toast(`${name} saved`); onSaved() } catch (e) { toast(e instanceof Error ? e.message : 'Could not save'); setSaving(false) }
  }

  const ingHits = data.ingredients.filter((i) => !rq.trim() || i.name.toLowerCase().includes(rq.trim().toLowerCase()))
  const comboHits = data.items.filter((m) => m.id !== item?.id && (!cq.trim() || m.name.toLowerCase().includes(cq.trim().toLowerCase())))

  return (
    <Modal onClose={onClose} className="wide" closeOnBackdrop={false}>
      <h3>{item ? 'Edit item' : 'Add item'}</h3>
      <div className="mimgpick">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={preview ?? '/brand/mark-red.png'} alt="" style={preview ? undefined : { objectFit: 'contain', padding: 12 }} />
        <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const x = e.target.files?.[0]; if (x) { setFile(x); setPreview(URL.createObjectURL(x)) } }} />
      </div>
      <input className="f2" placeholder="Dish name *" value={name} onChange={(e) => setName(e.target.value)} />
      <div style={{ display: 'flex', gap: 8 }}>
        <select className="f2" value={newCat ? '__new' : categoryId} onChange={(e) => { if (e.target.value === '__new') setNewCat(' '); else { setNewCat(''); setCategoryId(e.target.value) } }}>
          {data.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="__new">+ New category…</option>
        </select>
        {newCat && <input className="f2" placeholder="New category name" value={newCat.trimStart()} onChange={(e) => setNewCat(e.target.value || ' ')} />}
      </div>
      <label className="avrow"><input type="checkbox" className="cbox" checked={veg} onChange={(e) => setVeg(e.target.checked)} /> <VegMark veg /> Vegetarian</label>
      <label className="avrow"><input type="checkbox" className="cbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} /> 📌 Pin to top of customer menu (combo / offer)</label>
      {featured && <>
        <p style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', margin: '2px 0 6px' }}>What&apos;s in this combo? Pick dishes and the description fills in. You can still edit it.</p>
        <input className="f2" placeholder="Search dishes…" value={cq} onChange={(e) => setCq(e.target.value)} />
        <div className="picklist">{comboHits.slice(0, 80).map((m) => (
          <label key={m.id}>
            <input type="checkbox" className="cbox" checked={!!combo[m.id]} onChange={(e) => { const n = { ...combo }; if (e.target.checked) n[m.id] = 1; else delete n[m.id]; syncCombo(n) }} />
            <span style={{ flex: 1 }}>{m.name}</span>
            <input type="number" min={1} value={combo[m.id] ?? 1} disabled={!combo[m.id]} onChange={(e) => syncCombo({ ...combo, [m.id]: Math.max(1, Number(e.target.value) || 1) })} />
          </label>
        ))}</div>
      </>}
      <textarea className="f2" placeholder="Description (optional)" value={desc} onChange={(e) => setDesc(e.target.value)} />
      <input className="f2" inputMode="decimal" placeholder="Price in ₹ *" value={price} onChange={(e) => setPrice(e.target.value)} />
      <label className="avrow"><input type="checkbox" className="cbox" checked={active} onChange={(e) => setActive(e.target.checked)} /> Available on menu</label>
      <label className="avrow"><input type="checkbox" className="cbox" checked={track && !recipeOn} disabled={recipeOn} onChange={(e) => setTrack(e.target.checked)} /> 📦 Track stock for this item</label>
      {recipeOn && <div style={{ fontSize: 11.5, color: 'var(--muted)', margin: '-4px 0 10px' }}>Stock for this dish comes from its recipe ingredients (Stock → Ingredients).</div>}
      {track && !recipeOn && <>
        <input className="f2" inputMode="numeric" placeholder="Current stock *" value={stockQty} onChange={(e) => setStockQty(e.target.value)} />
        <input className="f2" inputMode="numeric" placeholder="Low-stock alert at (optional)" value={low} onChange={(e) => setLow(e.target.value)} />
        <input className="f2" inputMode="numeric" placeholder="Par level: daily top-up target (optional)" value={par} onChange={(e) => setPar(e.target.value)} />
      </>}
      <label className="avrow"><input type="checkbox" className="cbox" checked={recipeOn} onChange={(e) => setRecipeOn(e.target.checked)} /> 🧾 Build a recipe (deduct raw ingredients instead of a simple count)</label>
      {recipeOn && <>
        <p style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', margin: '2px 0 6px' }}>Pick the ingredients this dish uses and how much of each per order.</p>
        <input className="f2" placeholder="Search ingredients…" value={rq} onChange={(e) => setRq(e.target.value)} />
        <div className="picklist">{ingHits.length ? ingHits.map((i) => (
          <label key={i.id}>
            <input type="checkbox" className="cbox" checked={recipe[i.id] != null} onChange={(e) => { const n = { ...recipe }; if (e.target.checked) n[i.id] = '1'; else delete n[i.id]; setRecipe(n) }} />
            <span style={{ flex: 1 }}>{i.name}</span>
            <input type="number" min={0.001} step={0.001} placeholder="qty" value={recipe[i.id] ?? ''} disabled={recipe[i.id] == null} onChange={(e) => setRecipe({ ...recipe, [i.id]: e.target.value })} />
            <span style={{ width: 26, color: 'var(--muted)', fontSize: 11 }}>{i.unit}</span>
          </label>
        )) : <div style={{ padding: 8, color: 'var(--muted)', fontSize: 12 }}>No ingredients yet. Add some from Stock → Ingredients first.</div>}</div>
      </>}
      <div className="mrow"><button onClick={onClose}>Cancel</button><button className="go" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save'}</button></div>
    </Modal>
  )
}
