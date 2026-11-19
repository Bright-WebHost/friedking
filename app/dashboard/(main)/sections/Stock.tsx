'use client'

import { useEffect, useState } from 'react'
import type { DIngredient, DMenuItem, DMovement } from '@/lib/dashboard/types'
import { downloadCsv, ist, Loading, Modal, pct, RangeChips, rangeBounds, rs, useDash, useIsMobile, useLoad, type Range } from '../kit'
import { ItemModal, MenuCard, type MenuData } from './Menu'
import { fmtQty, maxMakeable, refDish, refIng, StockRow, useStockActions, type StockRef } from './stockParts'

type Tab = 'dishes' | 'ingredients' | 'reports'
type Filter = 'all' | 'low' | 'out'
const viewKey = 'fk_stock_view'
const getView = () => { try { return localStorage.getItem(viewKey) === 'list' ? 'list' : 'cards' } catch { return 'cards' } }

export default function Stock() {
  const { api, toast, settings } = useDash()
  const { data, error, reload } = useLoad(() => api.get<MenuData & { suppliers: string[] }>('stock'), [api])
  const [tab, setTab] = useState<Tab>('dishes')
  const [q, setQ] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [viewPref, setView] = useState<'cards' | 'list'>(getView)
  // Phones always get cards: wide tables are hard to use on a small screen.
  const mobile = useIsMobile()
  const view = mobile ? 'cards' : viewPref
  const [modal, setModal] = useState<React.ReactNode>(null)
  const stock = useStockActions(reload, data?.suppliers ?? [], data ? { recipes: data.recipes, items: data.items } : undefined)
  if (!data) return <Loading error={error} onRetry={reload} />

  const defLow = Number(settings.low_stock_threshold) || 5
  const close = () => setModal(null)
  const toggleView = () => { const v = viewPref === 'cards' ? 'list' : 'cards'; setView(v); try { localStorage.setItem(viewKey, v) } catch { /* ignore */ } }
  const editDish = (m: DMenuItem | null, opts: { recipe?: boolean; track?: boolean } = {}) => setModal(<ItemModal item={m} data={data} opts={opts} onClose={close} onSaved={() => { close(); void reload() }} />)
  const refs: StockRef[] = [
    ...data.items.filter((m) => m.track_stock).map((m) => refDish(m, defLow)),
    ...data.ingredients.filter((i) => i.track_stock).map((i) => refIng(i, defLow)),
  ]
  const tabBar = (
    <div className="catbar">
      <button aria-pressed={tab === 'dishes'} onClick={() => { setTab('dishes'); setQ(''); setFilter('all') }}>🍽️ Dishes</button>
      <button aria-pressed={tab === 'ingredients'} onClick={() => { setTab('ingredients'); setQ(''); setFilter('all') }}>🥕 Ingredients</button>
      <button aria-pressed={tab === 'reports'} onClick={() => setTab('reports')}>📊 Reports</button>
    </div>
  )
  const headBtns = (extra?: React.ReactNode) => (
    <div className="headbtns">
      {!mobile && <button className="btn sm ghost" onClick={toggleView}>{view === 'cards' ? '☰ List view' : '▦ Card view'}</button>}
      {extra}
      <button className="btn sm ghost" onClick={() => refs.length ? setModal(<StockTake refs={refs} onClose={close} onDone={() => { close(); void reload() }} />) : toast('No tracked items to count')}>📋 Start Stock Take</button>
    </div>
  )
  const reorder = (list: StockRef[], expiring: DIngredient[] = []) => {
    const cands = list.filter((r) => r.low != null && r.qty <= r.low)
    if (!cands.length && !expiring.length) return null
    return (
      <div className="reorder-banner">
        {cands.length > 0 && <div className="rb-section"><h4>⚠ Needs restocking ({cands.length})</h4>
          {cands.map((c) => <div className="rb-row" key={c.id}><span>{c.name} · {fmtQty(c.qty)} {c.unit} {c.par != null ? <i>(suggest +{fmtQty(Math.max(0, c.par - c.qty))} {c.unit})</i> : <i>(set a par level for a suggestion)</i>}</span><button className="btn sm" onClick={() => stock.restock(c)}>Restock</button></div>)}
          <button className="btn sm go" style={{ marginTop: 8 }} onClick={() => setModal(<BulkRestock cands={cands} onClose={close} onDone={() => { close(); void reload() }} />)}>Restock All ({cands.length})</button>
        </div>}
        {expiring.length > 0 && <div className="rb-section"><h4>⏰ Expiring soon</h4>
          {expiring.map((i) => <div className="rb-row" key={i.id}><span>{i.name} · expires {ist(`${i.nearest_expiry}T00:00:00+05:30`).slice(0, 6)}</span></div>)}
        </div>}
      </div>
    )
  }
  const filtered = <T extends StockRef>(list: T[]) => list.filter((r) => filter === 'all' ? true : filter === 'out' ? r.qty <= 0 : r.qty > 0 && r.low != null && r.qty <= r.low)
  const filterBar = (list: StockRef[]) => (
    <div className="catbar">
      <button aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All ({list.length})</button>
      <button aria-pressed={filter === 'low'} onClick={() => setFilter('low')}>Low ({list.filter((r) => r.qty > 0 && r.low != null && r.qty <= r.low).length})</button>
      <button aria-pressed={filter === 'out'} onClick={() => setFilter('out')}>Out ({list.filter((r) => r.qty <= 0).length})</button>
    </div>
  )

  if (tab === 'reports') return <section><div className="mhead"><div><h2>Stock Management</h2><p>Valuation, consumption, and dish profitability.</p></div></div>{tabBar}<Reports data={data} stockActions={stock} onBuild={(m) => editDish(m, { recipe: true })} />{modal}{stock.modal}</section>

  if (tab === 'ingredients') {
    const query = q.trim().toLowerCase()
    const list = data.ingredients.filter((i) => !query || i.name.toLowerCase().includes(query) || (i.category ?? '').toLowerCase().includes(query))
    const ingRefs = data.ingredients.map((i) => refIng(i, defLow))
    const shown = filtered(list.map((i) => refIng(i, defLow)))
    const shownIds = new Set(shown.map((r) => r.id))
    const cats = [...new Set(list.filter((i) => shownIds.has(i.id)).map((i) => i.category || 'Uncategorised'))]
    const warnDays = Number(settings.expiry_warn_days) || 7
    const expiring = data.ingredients.filter((i) => i.nearest_expiry && new Date(`${i.nearest_expiry}T00:00:00+05:30`).getTime() <= Date.now() + warnDays * 86400000)
    const ingModal = (i: DIngredient | null) => setModal(<IngredientModal i={i} cats={[...new Set(data.ingredients.map((x) => x.category).filter((x): x is string => !!x))]} onClose={close} onSaved={() => { close(); void reload() }} />)
    const del = async (i: DIngredient) => {
      try {
        const r = await api.post<{ inRecipe?: boolean }>('stock', 'deleteIngredient', { id: i.id })
        if (r.inRecipe) {
          setModal(<Modal onClose={close}><h3>{i.name} is in a recipe</h3><p>It can&apos;t be deleted. Archive it instead? That hides it from Stock and keeps the recipe intact.</p>
            <div className="mrow"><button onClick={close}>Cancel</button><button className="go" onClick={async () => { close(); await api.post('stock', 'archiveIngredient', { id: i.id }); toast(`${i.name} archived`); void reload() }}>Archive</button></div></Modal>)
        } else { toast(`${i.name} deleted`); void reload() }
      } catch (e) { toast(e instanceof Error ? e.message : 'Could not delete') }
    }
    const cost = (i: DIngredient) => setModal(<CostModal i={i} onClose={close} onSaved={() => { close(); void reload() }} />)
    const card = (i: DIngredient) => (
      <div className="micard" key={i.id}>
        <div className="mi-body2">
          <b>{i.name}</b>
          {i.category && <p>{i.category}</p>}
          <p className="icostline">{i.cost_paise != null ? `${rs(i.cost_paise)} / ${i.unit}` : 'No cost set'} <button className="icostbtn" title="Update cost" onClick={() => cost(i)}>✏️</button></p>
        </div>
        <StockRow r={refIng(i, defLow)} a={stock} />
        <div className="mi-foot" style={{ justifyContent: 'flex-end' }}><div className="mi-stockacts">
          <button onClick={() => ingModal(i)}>✏️ Edit</button>
          <button style={{ color: 'var(--red2)' }} onClick={() => void del(i)}>🗑️ Delete</button>
        </div></div>
      </div>
    )
    return (
      <section>
        <div className="mhead">
          <div><h2>Stock Management</h2><p>Track quantities for raw ingredients that can run out.</p></div>
          {headBtns(<>
            <button className="btn sm ghost" onClick={() => downloadCsv('friedking-ingredients.csv', [['Name', 'Category', 'Unit', 'Stock Qty', 'Low Stock Threshold', 'Par Level', 'Cost Per Unit'], ...data.ingredients.map((i) => [i.name, i.category, i.unit, fmtQty(Number(i.quantity)), i.reorder_level, i.par_level, i.cost_paise != null ? i.cost_paise / 100 : ''])])}>⬇ Export CSV</button>
            <button className="btn sm ghost" onClick={() => setModal(<ImportCsv existing={data.ingredients} onClose={close} onDone={() => { close(); void reload() }} />)}>⬆ Import CSV</button>
            <button className="btn sm" style={{ padding: '11px 18px' }} onClick={() => ingModal(null)}>+ Add Ingredient</button>
          </>)}
        </div>
        {tabBar}
        <div className="stats">
          <div className="stat b"><span>Ingredients</span><b>{data.ingredients.length}</b></div>
          <div className="stat o"><span>Low Stock</span><b>{ingRefs.filter((r) => r.qty > 0 && r.low != null && r.qty <= r.low).length}</b></div>
          <div className="stat r"><span>Out of Stock</span><b>{ingRefs.filter((r) => r.qty <= 0).length}</b></div>
        </div>
        {reorder(ingRefs, expiring)}
        {data.ingredients.length ? <>
          <input className="srch" placeholder={`Search ${data.ingredients.length} ingredients…`} value={q} onChange={(e) => setQ(e.target.value)} />
          {filterBar(ingRefs)}
          {view === 'list'
            ? <IngredientTable rows={list.filter((i) => shownIds.has(i.id))} defLow={defLow} stock={stock} onEdit={ingModal} onDelete={(i) => void del(i)} onCost={cost} />
            : cats.map((c) => { const rows = list.filter((i) => shownIds.has(i.id) && (i.category || 'Uncategorised') === c); return <div className="mcat" key={c}><h4>{c} <span className="mcatcount">{rows.length}</span></h4><div className="mgrid">{rows.map(card)}</div></div> })}
          {!shown.length && <div className="none">No ingredients matched</div>}
        </> : <div className="none">No ingredients yet. Tap “+ Add Ingredient” to start tracking raw materials.</div>}
        {modal}{stock.modal}
      </section>
    )
  }

  // ---- Dishes tab
  const query = q.trim().toLowerCase()
  const catName = (id: string) => data.categories.find((c) => c.id === id)?.name ?? ''
  const match = (m: DMenuItem) => !query || m.name.toLowerCase().includes(query) || catName(m.category_id).toLowerCase().includes(query)
  const recipeIds = new Set(data.recipes.map((l) => l.menu_item_id))
  const tracked = data.items.filter((m) => m.track_stock)
  const byRecipe = data.items.filter((m) => !m.track_stock && recipeIds.has(m.id))
  const untracked = data.items.filter((m) => !m.track_stock && !recipeIds.has(m.id))
  const trackedRefs = tracked.map((m) => refDish(m, defLow))
  const shownIds = new Set(filtered(trackedRefs).map((r) => r.id))
  const shownTracked = tracked.filter((m) => shownIds.has(m.id) && match(m))
  const noop = () => undefined
  const cardFor = (m: DMenuItem) => <MenuCard key={m.id} m={m} data={data} stock={stock} defLow={defLow} onToggle={noop} onEdit={editDish} onRemove={noop} />
  const grouped = (rows: DMenuItem[]) => data.categories.map((c) => { const r = rows.filter((m) => m.category_id === c.id); return r.length ? <div className="mcat" key={c.id}><h4>{c.name} <span className="mcatcount">{r.length}</span></h4><div className="mgrid">{r.map(cardFor)}</div></div> : null })

  return (
    <section>
      <div className="mhead"><div><h2>Stock Management</h2><p>Track quantities for items that can run out, and see what needs restocking.</p></div>{headBtns()}</div>
      {tabBar}
      <div className="stats">
        <div className="stat b"><span>Tracked Items</span><b>{tracked.length + byRecipe.length}</b></div>
        <div className="stat o"><span>Low Stock</span><b>{trackedRefs.filter((r) => r.qty > 0 && r.low != null && r.qty <= r.low).length}</b></div>
        <div className="stat r"><span>Out of Stock</span><b>{trackedRefs.filter((r) => r.qty <= 0).length + byRecipe.filter((m) => (maxMakeable(m.id, data.recipes, data.ingredients) ?? 1) <= 0).length}</b></div>
      </div>
      {reorder(trackedRefs)}
      <input className="srch" placeholder="Search dishes…" value={q} onChange={(e) => setQ(e.target.value)} />
      {tracked.length > 0 && <div className="mcat" style={{ marginTop: 14 }}>
        <h4>TRACKED BY SIMPLE COUNT <span className="mcatcount">{tracked.length}</span></h4>
        {filterBar(trackedRefs)}
        {view === 'list' ? <DishTable rows={shownTracked} defLow={defLow} stock={stock} onEdit={editDish} /> : grouped(shownTracked)}
        {!shownTracked.length && <div className="none">No tracked items matched</div>}
      </div>}
      {byRecipe.length > 0 && <div className="mcat" style={{ marginTop: 30 }}>
        <h4>TRACKED BY RECIPE <span className="mcatcount">{byRecipe.length}</span></h4>
        <p className="asub" style={{ margin: '-4px 0 10px' }}>Stock for these comes from their recipe&apos;s ingredients, not a count on the dish. Availability is how many you can still make with what&apos;s in stock.</p>
        {grouped(byRecipe.filter(match))}
      </div>}
      {untracked.length > 0 && <div className="mcat" style={{ marginTop: 30 }}>
        <h4>NOT TRACKED <span className="mcatcount">{untracked.length}</span></h4>
        <div>{untracked.filter(match).map((m) => <div className="histrow" key={m.id}><span>{m.name}</span><button className="btn sm ghost" onClick={() => editDish(m, { track: true })}>Track stock</button></div>)}</div>
      </div>}
      {modal}{stock.modal}
    </section>
  )
}

function DishTable({ rows, defLow, stock, onEdit }: { rows: DMenuItem[]; defLow: number; stock: ReturnType<typeof useStockActions>; onEdit: (m: DMenuItem) => void }) {
  return <div className="tblwrap"><table><thead><tr><th>Dish</th><th>Stock</th><th>Last updated</th><th></th></tr></thead><tbody>
    {rows.map((m) => { const r = refDish(m, defLow); const warn = r.qty <= 0 ? 'var(--red2)' : r.low != null && r.qty <= r.low ? '#b8860b' : undefined
      return <tr key={m.id}><td><b>{m.name}</b></td><td style={{ color: warn, fontWeight: warn ? 800 : undefined }}>{m.stock_qty} pcs</td><td>{m.stock_updated_at ? ist(m.stock_updated_at) : '—'}</td>
        <td><div className="mi-stockacts"><button onClick={() => stock.restock(r)}>📥 Restock</button><button onClick={() => stock.waste(r)}>🗑️ Waste</button><button onClick={() => void stock.history(r)}>📜 History</button><button onClick={() => onEdit(m)}>✏️ Edit</button></div></td></tr> })}
  </tbody></table></div>
}

function IngredientTable({ rows, defLow, stock, onEdit, onDelete, onCost }: { rows: DIngredient[]; defLow: number; stock: ReturnType<typeof useStockActions>; onEdit: (i: DIngredient) => void; onDelete: (i: DIngredient) => void; onCost: (i: DIngredient) => void }) {
  const [sort, setSort] = useState<{ k: 'name' | 'category' | 'qty' | 'cost'; d: 1 | -1 }>({ k: 'name', d: 1 })
  const val = (i: DIngredient) => sort.k === 'qty' ? Number(i.quantity) : sort.k === 'cost' ? (i.cost_paise ?? 0) : String(i[sort.k] ?? '').toLowerCase()
  const sorted = [...rows].sort((a, b) => (val(a) < val(b) ? -1 : val(a) > val(b) ? 1 : 0) * sort.d)
  const th = (k: typeof sort.k, l: string) => <th style={{ cursor: 'pointer' }} onClick={() => setSort((s) => ({ k, d: s.k === k ? (s.d === 1 ? -1 : 1) : 1 }))}>{l}{sort.k === k ? (sort.d === 1 ? ' ▲' : ' ▼') : ''}</th>
  return <div className="tblwrap"><table><thead><tr>{th('name', 'Name')}{th('category', 'Category')}{th('qty', 'Stock')}<th>Threshold</th><th>Par</th>{th('cost', 'Cost/Unit')}<th>Last updated</th><th></th></tr></thead><tbody>
    {sorted.map((i) => { const r = refIng(i, defLow); const warn = r.qty <= 0 ? 'var(--red2)' : r.low != null && r.qty <= r.low ? '#b8860b' : undefined
      return <tr key={i.id}><td><b>{i.name}</b></td><td>{i.category || '—'}</td><td style={{ color: warn, fontWeight: warn ? 800 : undefined }}>{fmtQty(r.qty)} {i.unit}</td><td>{i.reorder_level ?? '—'}</td><td>{i.par_level ?? '—'}</td>
        <td>{i.cost_paise != null ? rs(i.cost_paise) : '—'} <button className="icostbtn" onClick={() => onCost(i)}>✏️</button></td><td>{ist(i.updated_at)}</td>
        <td><div className="mi-stockacts"><button onClick={() => stock.restock(r)}>📥 Restock</button><button onClick={() => stock.waste(r)}>🗑️ Waste</button><button onClick={() => void stock.history(r)}>📜 History</button><button onClick={() => onEdit(i)}>✏️ Edit</button><button style={{ color: 'var(--red2)' }} onClick={() => onDelete(i)}>🗑️ Delete</button></div></td></tr> })}
  </tbody></table></div>
}

function IngredientModal({ i, cats, onClose, onSaved }: { i: DIngredient | null; cats: string[]; onClose: () => void; onSaved: () => void }) {
  const { api, toast } = useDash()
  const [f, setF] = useState({ name: i?.name ?? '', category: i?.category ?? '', unit: i?.unit ?? 'kg', qty: i ? fmtQty(Number(i.quantity)) : '', lowStock: i?.reorder_level != null ? String(i.reorder_level) : '', parLevel: i?.par_level != null ? String(i.par_level) : '', cost: i?.cost_paise != null ? String(i.cost_paise / 100) : '' })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value })
  const save = async () => {
    if (!f.name.trim() || f.qty.trim() === '') { toast('Name and current stock are required'); return }
    try { await api.post('stock', 'saveIngredient', { id: i?.id, ...f }); toast(`${f.name} saved`); onSaved() } catch (e) { toast(e instanceof Error ? e.message : 'Could not save') }
  }
  return (
    <Modal onClose={onClose} className="wide">
      <h3>{i ? `Edit ingredient · ${i.name}` : 'Add ingredient'}</h3>
      <label className="lbl">Ingredient name *</label><input className="f2" value={f.name} onChange={set('name')} placeholder="e.g. Chicken, Oil, Bun" />
      <label className="lbl">Category (optional)</label><input className="f2" list="fk-icats" value={f.category} onChange={set('category')} placeholder="e.g. Meat, Packaging" />
      <datalist id="fk-icats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
      <label className="lbl">Unit of measure</label><select className="f2" value={f.unit} onChange={set('unit')}>{['kg', 'g', 'l', 'ml', 'pcs'].map((u) => <option key={u}>{u}</option>)}</select>
      <label className="lbl">Current stock *</label><input className="f2" inputMode="decimal" value={f.qty} onChange={set('qty')} />
      <label className="lbl">Low-stock alert at (optional)</label><input className="f2" inputMode="decimal" value={f.lowStock} onChange={set('lowStock')} />
      <label className="lbl">Par level (optional)</label><input className="f2" inputMode="decimal" value={f.parLevel} onChange={set('parLevel')} placeholder="Target amount to top up to" />
      <label className="lbl">Cost per unit, ₹ (optional)</label><input className="f2" inputMode="decimal" value={f.cost} onChange={set('cost')} />
      <div style={{ fontSize: 11.5, color: 'var(--muted)', margin: '-4px 0 10px' }}>Used for stock valuation and dish profit margins. It also updates whenever you log a Restock with a cost.</div>
      <div className="mrow"><button onClick={onClose}>Cancel</button><button className="go" onClick={() => void save()}>Save</button></div>
    </Modal>
  )
}

function CostModal({ i, onClose, onSaved }: { i: DIngredient; onClose: () => void; onSaved: () => void }) {
  const { api, toast } = useDash()
  const [v, setV] = useState(i.cost_paise != null ? String(i.cost_paise / 100) : '')
  return <Modal onClose={onClose}><h3>Update cost · {i.name}</h3>
    <input className="f2" inputMode="decimal" placeholder={`Cost per ${i.unit} (₹)`} value={v} onChange={(e) => setV(e.target.value)} autoFocus />
    <div className="mrow"><button onClick={onClose}>Cancel</button><button className="go" onClick={async () => { try { await api.post('stock', 'cost', { id: i.id, cost: v }); toast(`${i.name} cost updated`); onSaved() } catch (e) { toast(e instanceof Error ? e.message : 'Could not update') } }}>Save</button></div>
  </Modal>
}

function BulkRestock({ cands, onClose, onDone }: { cands: StockRef[]; onClose: () => void; onDone: () => void }) {
  const { api, toast } = useDash()
  const [rows, setRows] = useState(cands.map((c) => ({ qty: c.par != null ? fmtQty(Math.max(0, c.par - c.qty)) : '', cost: '' })))
  const [busy, setBusy] = useState(false)
  return <Modal onClose={onClose} className="wide"><h3>Restock All ({cands.length})</h3>
    <div style={{ maxHeight: '50dvh', overflow: 'auto' }}>{cands.map((c, i) => (
      <div key={c.id} style={{ padding: '8px 0', borderBottom: '1px solid var(--line)' }}><b style={{ display: 'block', marginBottom: 6 }}>{c.name}</b>
        <input className="f2" inputMode="decimal" placeholder={`Qty (${c.unit})`} value={rows[i].qty} onChange={(e) => setRows(rows.map((r, j) => j === i ? { ...r, qty: e.target.value } : r))} />
        <input className="f2" inputMode="decimal" placeholder={`Cost per ${c.unit} (optional)`} value={rows[i].cost} onChange={(e) => setRows(rows.map((r, j) => j === i ? { ...r, cost: e.target.value } : r))} style={{ marginBottom: 0 }} />
      </div>))}</div>
    <div className="mrow"><button onClick={onClose}>Cancel</button><button className="go" disabled={busy} onClick={async () => {
      setBusy(true)
      try { const r = await api.post<{ count: number }>('stock', 'bulkRestock', { rows: cands.map((c, i) => ({ type: c.type, id: c.id, qty: rows[i].qty, cost: rows[i].cost })) }); toast(`Restocked ${r.count} item${r.count === 1 ? '' : 's'}`); onDone() }
      catch (e) { toast(e instanceof Error ? e.message : 'Could not restock'); setBusy(false) }
    }}>{busy ? 'Recording…' : 'Confirm & Log All'}</button></div>
  </Modal>
}

function StockTake({ refs, onClose, onDone }: { refs: StockRef[]; onClose: () => void; onDone: () => void }) {
  const { api, toast, busy } = useDash()
  const [counts, setCounts] = useState<Record<string, string>>({})
  const [review, setReview] = useState(false)
  const [saving, setSaving] = useState(false)
  // Pause background refresh while counting.
  useEffect(() => { busy.current += 1; return () => { busy.current -= 1 } }, [busy])
  const rows = refs.filter((r) => counts[r.type + r.id] != null && counts[r.type + r.id] !== '' && !isNaN(Number(counts[r.type + r.id]))).map((r) => ({ r, counted: Number(counts[r.type + r.id]), variance: Math.round((Number(counts[r.type + r.id]) - r.qty) * 1000) / 1000 }))
  return (
    <div className="stocktake">
      <div className="st-head"><h2>📋 Stock Take · {review ? 'Review' : 'Count'}</h2><button className="btn sm ghost" onClick={() => review ? setReview(false) : onClose()}>{review ? '← Back' : '✕ Cancel'}</button></div>
      <p className="st-sub">{review ? `${rows.length} item${rows.length === 1 ? '' : 's'} counted. Review before committing: this writes to the stock ledger.` : 'Enter what you physically count for each item. Leave blank to skip it.'}</p>
      <div className="st-list">
        {review ? rows.map(({ r, counted, variance }) => (
          <div className="st-row" key={r.type + r.id}><span className="st-name">{r.name}</span><span className="st-sys">System {fmtQty(r.qty)} → Counted {fmtQty(counted)} {r.unit}</span>
            <span className={`st-variance ${variance > 0 ? 'pos' : variance < 0 ? 'neg' : ''}`}>{variance === 0 ? 'No change' : `${variance > 0 ? '+' : ''}${variance}`}</span></div>
        )) : refs.map((r) => (
          <div className="st-row" key={r.type + r.id}><span className="st-name">{r.name}</span><span className="st-sys">System: {fmtQty(r.qty)} {r.unit}</span>
            <input className="f2 st-input" inputMode="decimal" placeholder="Counted" value={counts[r.type + r.id] ?? ''} onChange={(e) => setCounts({ ...counts, [r.type + r.id]: e.target.value })} /></div>
        ))}
      </div>
      <div className="st-foot">
        {review
          ? <button className="btn go" disabled={saving} onClick={async () => {
            setSaving(true)
            try { const r = await api.post<{ count: number }>('stock', 'stockTake', { counts: rows.map(({ r: x, counted }) => ({ type: x.type, id: x.id, counted })) }); toast(`Stock take committed · ${r.count} item${r.count === 1 ? '' : 's'} updated`); onDone() }
            catch (e) { toast(e instanceof Error ? e.message : 'Could not commit'); setSaving(false) }
          }}>{saving ? 'Committing…' : `Commit ${rows.length} count${rows.length === 1 ? '' : 's'}`}</button>
          : <button className="btn" onClick={() => rows.length ? setReview(true) : toast('Count at least one item')}>Review →</button>}
      </div>
    </div>
  )
}

function ImportCsv({ existing, onClose, onDone }: { existing: DIngredient[]; onClose: () => void; onDone: () => void }) {
  const { api, toast } = useDash()
  type Row = { name: string; category: string; unit: string; qty: string; lowStock: string; parLevel: string; cost: string; match: DIngredient | null; dupe: boolean; include: boolean }
  const [rows, setRows] = useState<Row[] | null>(null)
  const [busy, setBusy] = useState(false)
  const parse = (text: string) => {
    const lines = text.split(/\r?\n/).filter((l) => l.trim())
    const split = (l: string) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '').replace(/""/g, '"'))
    const head = split(lines[0] ?? '').map((h) => h.toLowerCase())
    const at = (c: string[], k: string) => c[head.indexOf(k)] ?? ''
    setRows(lines.slice(1).map(split).map((c) => {
      const name = at(c, 'name')
      const lower = name.toLowerCase()
      const exact = existing.find((i) => i.name.trim().toLowerCase() === lower) ?? null
      const close = exact ? null : existing.find((i) => { const a = i.name.trim().toLowerCase(); return a.includes(lower) || lower.includes(a) }) ?? null
      return { name, category: at(c, 'category'), unit: at(c, 'unit') || 'kg', qty: at(c, 'stock qty'), lowStock: at(c, 'low stock threshold'), parLevel: at(c, 'par level'), cost: at(c, 'cost per unit'), match: exact ?? close, dupe: !!close, include: !close }
    }).filter((r) => r.name))
  }
  return <Modal onClose={onClose} className="xwide"><h3>Import Ingredients CSV</h3>
    <p>Columns: Name, Category, Unit, Stock Qty, Low Stock Threshold, Par Level, Cost Per Unit. Plain comma-separated: fields with commas or quotes inside them aren&apos;t supported.</p>
    <input type="file" accept=".csv,.txt" onChange={(e) => { const f = e.target.files?.[0]; if (f) void f.text().then(parse) }} />
    {rows && (rows.length ? <div style={{ maxHeight: '40dvh', overflow: 'auto', marginTop: 12 }}><table><thead><tr><th>Row</th><th>Status</th><th>Include?</th></tr></thead><tbody>
      {rows.map((r, i) => <tr key={i}><td><b>{r.name}</b></td><td>{r.match ? (r.dupe ? `Possible duplicate: ${r.match.name}?` : `Update: ${r.match.name}`) : 'New'}</td>
        <td><input type="checkbox" className="cbox" checked={r.include} onChange={(e) => setRows(rows.map((x, j) => j === i ? { ...x, include: e.target.checked } : x))} /></td></tr>)}
    </tbody></table></div> : <div className="none" style={{ marginTop: 12 }}>No rows found in this file</div>)}
    <div className="mrow"><button onClick={onClose}>Cancel</button>{rows?.length ? <button className="go" disabled={busy} onClick={async () => {
      setBusy(true)
      try {
        const r = await api.post<{ created: number; updated: number }>('stock', 'importCsv', { rows: rows.filter((x) => x.include).map((x) => ({ id: x.match?.id, name: x.name, category: x.category, unit: x.unit, qty: x.qty, lowStock: x.lowStock, parLevel: x.parLevel, cost: x.cost })) })
        toast(`Imported: ${r.created} new, ${r.updated} updated`); onDone()
      } catch (e) { toast(e instanceof Error ? e.message : 'Could not import'); setBusy(false) }
    }}>Confirm Import</button> : null}</div>
  </Modal>
}

/** Valuation, consumption by reason, dish margins with ingredient detail, recipe coverage. */
function Reports({ data, stockActions, onBuild }: { data: MenuData; stockActions: ReturnType<typeof useStockActions>; onBuild: (m: DMenuItem) => void }) {
  const { api, settings } = useDash()
  const [range, setRange] = useState<Range>('week')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [cov, setCov] = useState(false)
  const b = rangeBounds(range, custom.from, custom.to)
  const mv = useLoad(() => api.get<{ movements: DMovement[] }>('stock', { view: 'movements', since: range === 'all' ? null : new Date(b.start).toISOString(), until: new Date(b.end).toISOString() }), [api, range, custom.from, custom.to])

  const withCost = data.ingredients.filter((i) => i.track_stock && i.cost_paise != null)
  const valuation = withCost.reduce((s, i) => s + Number(i.quantity) * (i.cost_paise ?? 0), 0)
  const missing = data.ingredients.filter((i) => i.track_stock).length - withCost.length
  const marginThr = Number(settings.margin_alert_pct) || 20
  const recipeIds = new Set(data.recipes.map((l) => l.menu_item_id))
  const margins = dishMargins(data)
  const uncovered = data.items.filter((m) => !recipeIds.has(m.id))

  const cons = new Map<string, { name: string; unit: string; by: Record<string, number> }>()
  for (const m of mv.data?.movements ?? []) {
    const k = m.entity_type + m.entity_id
    const row = cons.get(k) ?? { name: m.entity_name, unit: m.unit ?? '', by: {} }
    row.by[m.reason] = (row.by[m.reason] ?? 0) + Math.abs(Number(m.qty_change))
    cons.set(k, row)
  }
  const cell = (r: { unit: string; by: Record<string, number> }, k: string) => r.by[k] ? `${fmtQty(r.by[k])} ${r.unit}` : '—'

  return (
    <>
      <RangeChips range={range} setRange={setRange} custom from={custom.from} to={custom.to} setCustom={(from, to) => setCustom({ from, to })} />
      <div className="anacard">
        <h4>Stock Valuation</h4>
        <p className="asub" style={{ marginTop: 0 }}>What all your ingredient stock is worth right now, at the last price you paid for each.</p>
        <div className="ov-pills"><div className="ovpill teal"><b>{rs(valuation)}</b><span>Total ingredient stock value</span></div></div>
        {missing > 0 && <p className="asub" style={{ marginTop: 12 }}>Excludes {missing} ingredient{missing === 1 ? '' : 's'} with no recorded cost yet. Restock with a cost, or set one in Stock → Ingredients, to include {missing === 1 ? 'it' : 'them'}.</p>}
      </div>
      <div className="anacard">
        <h4>Consumption{range !== 'all' ? ' this period' : ' (all time)'}</h4>
        <p className="asub" style={{ marginTop: 0 }}>How much of each item moved in the range, by reason: sold, wasted, adjusted or counted in a stock take.</p>
        {cons.size ? <div className="tblwrap"><table><thead><tr><th>Item</th><th>Sale</th><th>Waste</th><th>Adjust</th><th>Stock take</th><th>Restock</th></tr></thead><tbody>
          {[...cons.values()].map((r) => <tr key={r.name}><td><b>{r.name}</b></td><td>{cell(r, 'sale')}</td><td>{cell(r, 'waste')}</td><td>{cell(r, 'manual_adjust')}</td><td>{cell(r, 'stock_take')}</td><td>{cell(r, 'restock')}</td></tr>)}
        </tbody></table></div> : <div className="none">{mv.loading ? 'Loading…' : 'No stock movements in this period'}</div>}
      </div>
      <div className="anacard">
        <h4>Dish Profit Margins</h4>
        <p className="asub" style={{ marginTop: 0 }}>For every dish with a recipe: what it costs you in ingredients, and what you keep. Tap Details to see each ingredient&apos;s share. Dishes without a recipe aren&apos;t listed.</p>
        {margins.length ? <div className="tblwrap"><table><thead><tr><th>Dish</th><th>Price</th><th>Recipe cost</th><th>Margin</th><th>Margin %</th><th></th></tr></thead><tbody>
          {margins.map((x) => x.missing ? (
            <tr key={x.item.id}><td><b>{x.item.name}</b></td><td>{rs(x.item.price_paise)}</td><td colSpan={4}>
              Can&apos;t calculate yet: “{x.missing.name}” has no cost recorded{' '}
              <button className="btn sm" style={{ padding: '5px 10px', fontSize: 11 }} onClick={() => stockActions.restock(refIng(x.missing!, 0))}>Add cost for {x.missing.name}</button>
            </td></tr>
          ) : [
            <tr key={x.item.id} style={x.pct! < marginThr ? { background: 'var(--tint)' } : undefined}>
              <td><b>{x.item.name}</b></td><td>{rs(x.item.price_paise)}</td><td>{rs(x.cost)}</td>
              <td style={x.margin! < 0 ? { color: 'var(--red2)', fontWeight: 800 } : undefined}>{x.margin! < 0 ? 'Selling at a loss · ' : ''}{rs(x.margin)}</td>
              <td style={x.pct! < marginThr ? { color: '#c0392b', fontWeight: 800 } : undefined}>{pct(x.pct!)}{x.pct! < marginThr ? ' ⚠' : ''}</td>
              <td><button className="btn sm ghost" style={{ padding: '5px 10px', fontSize: 11 }} onClick={() => setOpen({ ...open, [x.item.id]: !open[x.item.id] })}>{open[x.item.id] ? '▾ Hide' : '▸ Details'}</button></td>
            </tr>,
            open[x.item.id] && <tr key={`${x.item.id}-d`}><td colSpan={6} style={{ background: '#faf8f8' }}>
              <table><thead><tr><th>Ingredient</th><th>Qty per order</th><th>Cost/unit</th><th>Line cost</th></tr></thead><tbody>
                {x.lines.map((l) => <tr key={l.name}><td>{l.name}</td><td>{l.qty} {l.unit}</td><td>{l.costPerUnit != null ? rs(l.costPerUnit) : 'Not set'}</td><td>{l.lineCost != null ? rs(l.lineCost) : '—'}</td></tr>)}
              </tbody></table>
            </td></tr>,
          ])}
        </tbody></table></div> : <div className="none">No dishes have a recipe yet. Build one from Menu (edit a dish → “Build a recipe”).</div>}
      </div>
      <div className="anacard">
        <h4>Recipe Coverage <span className="countpill">{margins.length} of {data.items.length} dishes</span></h4>
        <p className="asub" style={{ marginTop: 0 }}>Every dish without a recipe is missing from Dish Profit Margins and from P&amp;L cost of goods. This is what&apos;s left to build.</p>
        {uncovered.length ? <>
          <button className="btn sm ghost" style={{ alignSelf: 'flex-start' }} onClick={() => setCov(!cov)}>{cov ? '▾ Hide' : `▸ Show ${uncovered.length} dish${uncovered.length === 1 ? '' : 'es'} without a recipe`}</button>
          {cov && <div style={{ marginTop: 12 }}>{data.categories.map((c) => {
            const rows = uncovered.filter((m) => m.category_id === c.id)
            return rows.length ? <div key={c.id} style={{ marginBottom: 10 }}><div style={{ fontSize: 11, fontWeight: 800, color: 'var(--muted)', textTransform: 'uppercase' }}>{c.name}</div>
              {rows.map((m) => <div className="arow" key={m.id}><div className="at"><b>{m.name}</b><span>{rs(m.price_paise)}</span></div><div className="as"><button className="btn sm" style={{ padding: '5px 10px', fontSize: 11 }} onClick={() => onBuild(m)}>🧾 Build a recipe</button></div></div>)}
            </div> : null
          })}</div>}
        </> : <div className="none">Every dish has a recipe. Coverage is complete.</div>}
      </div>
    </>
  )
}

/** Recipe cost per dish (null when an ingredient has no cost). Used by Stock reports and P&L COGS. */
export function dishMargins(data: Pick<MenuData, 'items' | 'recipes' | 'ingredients'>) {
  const ids = new Set(data.recipes.map((l) => l.menu_item_id))
  return data.items.filter((m) => ids.has(m.id)).map((m) => {
    let cost = 0
    let missing: DIngredient | null = null
    const lines = data.recipes.filter((l) => l.menu_item_id === m.id).map((l) => {
      const ing = data.ingredients.find((i) => i.id === l.stock_item_id)
      const has = !!ing && ing.cost_paise != null
      const lineCost = has ? Number(l.qty_per_item) * (ing!.cost_paise ?? 0) : null
      if (!has && !missing && ing) missing = ing
      if (lineCost != null) cost += lineCost
      return { name: ing?.name ?? 'Unknown ingredient', qty: Number(l.qty_per_item), unit: ing?.unit ?? '', costPerUnit: has ? ing!.cost_paise : null, lineCost }
    })
    const margin = missing ? null : m.price_paise - cost
    return { item: m, cost: missing ? null : cost, margin, pct: margin != null && m.price_paise > 0 ? (margin / m.price_paise) * 100 : null, missing: missing as DIngredient | null, lines }
  })
}
