'use client'

import { useCallback, useState } from 'react'
import type { DIngredient, DMenuItem, DMovement, DRecipeLine } from '@/lib/dashboard/types'
import { ist, Modal, rs, useDash } from '../kit'

export type EType = 'menu_item' | 'ingredient'
export interface StockRef { type: EType; id: string; name: string; unit: string; qty: number; low: number | null; par: number | null }

export const refDish = (m: DMenuItem, defLow: number): StockRef => ({ type: 'menu_item', id: m.id, name: m.name, unit: 'pcs', qty: m.stock_qty, low: m.low_stock_threshold ?? defLow, par: m.par_level })
export const refIng = (i: DIngredient, defLow: number): StockRef => ({ type: 'ingredient', id: i.id, name: i.name, unit: i.unit, qty: Number(i.quantity), low: i.reorder_level == null ? defLow : Number(i.reorder_level), par: i.par_level == null ? null : Number(i.par_level) })

export const fmtQty = (q: number) => String(Math.round(q * 1000) / 1000)
const REASON: Record<string, string> = { sale: 'Sale', restock: 'Restock', manual_adjust: 'Manual adjustment', cancel_restore: 'Order cancelled', waste: 'Waste', top_up_par: 'Top up to par', stock_take: 'Stock take' }

/** How many more of a recipe dish can be made from current ingredient stock (null = no recipe). */
export function maxMakeable(menuItemId: string, recipes: DRecipeLine[], ingredients: DIngredient[]): number | null {
  const lines = recipes.filter((l) => l.menu_item_id === menuItemId)
  if (!lines.length) return null
  let max = Infinity
  for (const l of lines) {
    const ing = ingredients.find((i) => i.id === l.stock_item_id)
    if (!ing) return 0
    max = Math.min(max, Math.floor(Number(ing.quantity) / Number(l.qty_per_item)))
  }
  return max === Infinity ? 0 : Math.max(0, max)
}

export function useStockActions(reload: () => unknown, suppliers: string[] = [], ingredientsForHistory?: { recipes: DRecipeLine[]; items: DMenuItem[] }) {
  const { api, toast } = useDash()
  const [modal, setModal] = useState<React.ReactNode>(null)
  const close = useCallback(() => setModal(null), [])
  const done = useCallback((msg: string) => { toast(msg); close(); void reload() }, [toast, close, reload])
  const fail = useCallback((e: unknown) => toast(e instanceof Error ? e.message : 'Could not update stock'), [toast])

  const bump = useCallback(async (r: StockRef, delta: number) => {
    try { await api.post('stock', 'bump', { type: r.type, id: r.id, delta }); void reload() } catch (e) { fail(e) }
  }, [api, reload, fail])
  const topUp = useCallback(async (r: StockRef) => {
    try { await api.post('stock', 'topUp', { type: r.type, id: r.id }); toast(`${r.name} topped up to ${r.par}`); void reload() } catch (e) { fail(e) }
  }, [api, reload, toast, fail])

  const restock = useCallback((r: StockRef) => setModal(<Restock r={r} suppliers={suppliers} onClose={close} onSave={async (body) => {
    try { await api.post('stock', 'restock', { type: r.type, id: r.id, ...body }); done(`Restocked ${r.name} +${body.qty} ${r.unit}`) } catch (e) { fail(e) }
  }} />), [api, suppliers, close, done, fail])

  const waste = useCallback((r: StockRef) => setModal(<Waste r={r} onClose={close} onSave={async (qty, note) => {
    try { await api.post('stock', 'waste', { type: r.type, id: r.id, qty, note }); done(`Logged waste: ${r.name} −${qty} ${r.unit}`) } catch (e) { fail(e) }
  }} />), [api, close, done, fail])

  const history = useCallback(async (r: StockRef) => {
    try {
      const { movements } = await api.post<{ movements: DMovement[] }>('stock', 'history', { type: r.type, id: r.id })
      const usedIn = r.type === 'ingredient' && ingredientsForHistory
        ? ingredientsForHistory.items.filter((m) => ingredientsForHistory.recipes.some((l) => l.stock_item_id === r.id && l.menu_item_id === m.id)) : null
      setModal(<Modal onClose={close} className="wide">
        <h3>History · {r.name}</h3>
        {usedIn && <p style={{ fontWeight: 700 }}>{usedIn.length ? `Used in ${usedIn.length} dish${usedIn.length === 1 ? '' : 'es'}: ${usedIn.map((m) => m.name).join(', ')}` : 'Not used in any recipe'}</p>}
        {movements.length ? <div className="ledger">{movements.map((m) => (
          <div key={m.id}><span>{ist(m.created_at)} · {REASON[m.reason] ?? m.reason}{m.note ? ` · ${m.note}` : ''}{m.supplier_name ? ` · ${m.supplier_name}` : ''}{m.cost_per_unit_paise != null ? ` · ${rs(m.cost_per_unit_paise)}/${m.unit}` : ''} · {m.staff}</span>
            <b>{Number(m.qty_change) > 0 ? '+' : ''}{fmtQty(Number(m.qty_change))} → {fmtQty(Number(m.balance_after))}</b></div>
        ))}</div> : <div className="none">No stock movements recorded yet</div>}
        <div className="mrow"><button className="go" onClick={close}>Close</button></div>
      </Modal>)
    } catch (e) { fail(e) }
  }, [api, close, fail, ingredientsForHistory])

  return { modal, setModal, close, bump, topUp, restock, waste, history }
}
export type StockActions = ReturnType<typeof useStockActions>

export function StockRow({ r, a }: { r: StockRef; a: StockActions }) {
  const warn = r.qty <= 0 ? 'out' : r.low != null && r.qty <= r.low ? 'low' : ''
  const qn = r.unit === 'pcs' ? fmtQty(r.qty) : `${fmtQty(r.qty)} ${r.unit}`
  return (
    <div className={`mi-stockrow ${warn}`}>
      <div className="mi-stocktop">
        <span>{warn === 'out' ? 'Out of stock' : warn === 'low' ? `${qn} left` : `${qn} in stock`}</span>
        <div className="stp"><button onClick={() => void a.bump(r, -1)}>−</button><b>{fmtQty(r.qty)}</b><button onClick={() => void a.bump(r, 1)}>+</button></div>
      </div>
      {r.par != null && r.qty < r.par && <button className="chip" onClick={() => void a.topUp(r)}>Top up to {fmtQty(r.par)}</button>}
      <div className="mi-stockacts">
        <button onClick={() => a.restock(r)}>📥 Restock</button>
        <button onClick={() => a.waste(r)}>🗑️ Waste</button>
        <button onClick={() => void a.history(r)}>📜 History</button>
      </div>
    </div>
  )
}

function Restock({ r, suppliers, onClose, onSave }: { r: StockRef; suppliers: string[]; onClose: () => void; onSave: (b: { qty: number; supplier: string; cost: string; expiry: string; note: string }) => Promise<void> }) {
  const [qty, setQty] = useState('')
  const [supplier, setSupplier] = useState('')
  const [cost, setCost] = useState('')
  const [expiry, setExpiry] = useState('')
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)
  return (
    <Modal onClose={onClose}>
      <h3>Restock {r.name}</h3>
      <input className="f2" inputMode="decimal" placeholder={`Quantity received (${r.unit}) *`} value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
      <input className="f2" list="fk-suppliers" placeholder="Supplier (optional)" value={supplier} onChange={(e) => setSupplier(e.target.value)} />
      <datalist id="fk-suppliers">{suppliers.map((s) => <option key={s} value={s} />)}</datalist>
      <input className="f2" inputMode="decimal" placeholder={`Cost per ${r.unit} in ₹ (optional)`} value={cost} onChange={(e) => setCost(e.target.value)} />
      {r.type === 'ingredient' && <><label className="lbl">Expiry date (optional)</label><input className="f2" type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} /></>}
      <input className="f2" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mrow"><button onClick={onClose}>Cancel</button><button className="go" disabled={busy} onClick={async () => {
        const n = Number(qty)
        if (!n || n <= 0) return
        setBusy(true); await onSave({ qty: n, supplier, cost, expiry, note }); setBusy(false)
      }}>Record</button></div>
    </Modal>
  )
}

function Waste({ r, onClose, onSave }: { r: StockRef; onClose: () => void; onSave: (qty: number, note: string) => Promise<void> }) {
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')
  return (
    <Modal onClose={onClose}>
      <h3>Log waste · {r.name}</h3>
      <input className="f2" inputMode="decimal" placeholder={`Quantity (${r.unit}) *`} value={qty} onChange={(e) => setQty(e.target.value)} autoFocus />
      <input className="f2" placeholder="Reason (required), e.g. spoiled, dropped" value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="mrow"><button onClick={onClose}>Cancel</button><button className="x" onClick={() => { const n = Number(qty); if (n > 0 && note.trim()) void onSave(n, note) }}>Log waste</button></div>
    </Modal>
  )
}
