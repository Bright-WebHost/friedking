'use client'

import { useCallback, useState } from 'react'
import type { DOrder, OrderStatus } from '@/lib/dashboard/types'
import { isBoss } from '@/lib/dashboard/access'
import {
  customerName, fmtMins, ist, minsSince, Modal, PasscodeModal, phoneShort, printReceipt, rs, statusLabel, typeLabel, useDash,
} from '../kit'

const FLOW: OrderStatus[] = ['pending', 'preparing', 'ready', 'delivered']
export function isBackward(from: OrderStatus, to: OrderStatus) {
  if (from === 'cancelled') return to !== 'cancelled'
  const a = FLOW.indexOf(from === 'confirmed' ? 'preparing' : from), b = FLOW.indexOf(to)
  return a >= 0 && b >= 0 && b < a
}
export const canEdit = (o: DOrder) => ['pending', 'confirmed', 'preparing'].includes(o.status)
const fire = () => window.dispatchEvent(new Event('fk-orders-changed'))

export function LineItems({ o }: { o: DOrder }) {
  return (
    <>
      {o.items.map((l) => (
        <div key={l.id}>
          <div className="li"><span>{l.name_snapshot} ×{l.quantity}</span><span>{rs(l.line_total_paise)}</span></div>
          {l.notes && <div className="linote">📝 NOTE: {l.notes}</div>}
        </div>
      ))}
    </>
  )
}

/** Running clock while live (15 m warn, 30 m bad); frozen "✓ took N m" once done. */
export function Age({ o }: { o: DOrder }) {
  if (o.status === 'cancelled') return null
  if (o.status === 'delivered') {
    const end = new Date(o.delivered_at ?? o.cash_collected_at ?? o.updated_at).getTime()
    const took = Math.max(0, Math.floor((end - new Date(o.created_at).getTime()) / 60000))
    return <span className="runclock done">✓ {fmtMins(took)}</span>
  }
  const m = minsSince(o.created_at)
  return <span className={`age ${m >= 30 ? 'bad' : m >= 15 ? 'warn' : ''}`}>⏱ {fmtMins(m)}</span>
}

export function TypeTag({ o }: { o: DOrder }) {
  const cls = o.order_type === 'delivery' ? 'dl' : o.order_type === 'dine-in' ? 'din' : 'tk'
  return <span className={`tag ${cls}`}>{typeLabel(o.order_type)}{o.table_number ? ` · T${o.table_number}` : ''}</span>
}

/** Everything you can do to an order, plus the modal currently open. */
export function useOrderActions(reload: () => unknown) {
  const { api, toast, settings, branch, riders, staff } = useDash()
  const [modal, setModal] = useState<React.ReactNode>(null)
  const close = useCallback(() => setModal(null), [])
  const after = useCallback(() => { fire(); void reload() }, [reload])

  const run = useCallback(async (fn: () => Promise<unknown>, ok: string) => {
    try { await fn(); toast(ok); after(); return true } catch (e) { toast(e instanceof Error ? e.message : 'Could not update'); return false }
  }, [toast, after])

  const setStatus = useCallback((o: DOrder, to: OrderStatus, extraBody: Record<string, unknown> = {}) => {
    const cancelling = to === 'cancelled' && o.status !== 'cancelled'
    if (isBackward(o.status, to) || cancelling) {
      if (!cancelling && !isBoss(staff.role)) { toast('Only a manager can do that'); return Promise.resolve(false) }
      setModal(<PasscodeModal title={cancelling ? 'Cancel needs the passcode' : 'Undo needs the passcode'} onClose={close}
        detail={cancelling ? `Cancelling #${o.order_number} (${statusLabel(o)}). Enter the passcode.` : `Moving #${o.order_number} from ${statusLabel(o)} back to ${statusLabel({ ...o, status: to })}. Enter the passcode.`}
        onOk={async (code) => {
          try { await api.post('orders', 'status', { orderId: o.id, status: to, passcode: code, ...extraBody }); toast(`#${o.order_number} → ${statusLabel({ ...o, status: to })}`); after(); return true }
          catch (e) { toast(e instanceof Error ? e.message : 'Could not undo'); return false }
        }} />)
      return Promise.resolve(false)
    }
    return run(() => api.post('orders', 'status', { orderId: o.id, status: to, ...extraBody }), `#${o.order_number} → ${statusLabel({ ...o, status: to })}`)
  }, [api, run, staff.role, toast, close, after])

  const assignRider = useCallback((o: DOrder, then?: () => void) => {
    const active = riders.filter((r) => r.is_active)
    setModal(
      <Modal onClose={() => { close(); then?.() }}>
        <h3>Who is delivering #{o.order_number}?</h3>
        <div className="rlist">
          {active.length ? active.map((r) => (
            <button key={r.id} onClick={async () => {
              close()
              await run(() => api.post('orders', 'rider', { orderId: o.id, riderId: r.id }), `Assigned to ${r.name}`)
              then?.()
            }}>{r.name} · {phoneShort(r.phone)}</button>
          )) : <div className="none">No riders on duty. Add them on the Riders page.</div>}
        </div>
        <button className="btn ghost" onClick={() => { close(); then?.() }}>Skip for now</button>
      </Modal>,
    )
  }, [riders, close, run, api])

  const markDone = useCallback((o: DOrder) => {
    const dine = o.order_type === 'dine-in'
    setModal(<MarkDone o={o} dine={dine} onClose={close} onOk={(pay, inv) => {
      close()
      void run(() => api.post('orders', 'done', { orderId: o.id, paymentCollected: pay, sendInvoice: inv }), `#${o.order_number} marked done${pay ? ' · payment collected' : ''}`)
    }} />)
  }, [api, close, run])

  const cash = useCallback((o: DOrder) => run(() => api.post('orders', 'cash', { orderId: o.id }), `${rs(o.total_paise)} recorded for #${o.order_number}`), [api, run])

  const cancel = useCallback((o: DOrder) => {
    setModal(
      <Modal onClose={close}>
        <h3>Cancel #{o.order_number}?</h3>
        <p>{customerName(o)} · {rs(o.total_paise)}. Stock used for it goes back.</p>
        <div className="rlist">
          {['Customer cancelled', 'Item unavailable', 'Duplicate order', 'Could not deliver'].map((r) => (
            <button key={r} onClick={() => { close(); void setStatus(o, 'cancelled', { reason: r }) }}>{r}</button>
          ))}
        </div>
        <button className="btn ghost" onClick={close}>Keep the order</button>
      </Modal>,
    )
  }, [close, setStatus])

  const print = useCallback((o: DOrder) => {
    if (printReceipt(o, branch, settings)) void api.post('orders', 'printed', { orderId: o.id }).catch(() => undefined)
    else toast('Allow pop-ups to print')
  }, [api, branch, settings, toast])

  const edit = useCallback((o: DOrder) => {
    if (!canEdit(o)) { toast(`Can't edit #${o.order_number}: already ${statusLabel(o)}`); return }
    setModal(<EditOrder o={o} onClose={close} onSaved={(total) => { close(); toast(`#${o.order_number} updated · ${rs(total)}`); after() }} />)
  }, [close, toast, after])

  const details = useCallback((o: DOrder, rounds?: DOrder[]) => {
    setModal(<OrderDetails o={o} rounds={rounds} onClose={close} />)
  }, [close])

  return { modal, setModal, close, setStatus, assignRider, markDone, cash, cancel, print, edit, details }
}

function MarkDone({ o, dine, onClose, onOk }: { o: DOrder; dine: boolean; onClose: () => void; onOk: (pay: boolean, inv: boolean) => void }) {
  const [pay, setPay] = useState(true)
  const [inv, setInv] = useState(true)
  return (
    <Modal onClose={onClose}>
      <h3>Mark #{o.order_number} done</h3>
      <p>{customerName(o)} · {rs(o.total_paise)}</p>
      <label className="mchk"><input type="checkbox" checked={o.cash_collected || pay} disabled={o.cash_collected} onChange={(e) => setPay(e.target.checked)} /> Payment collected</label>
      {dine
        ? <p className="mnote">The full-tab invoice goes out when this table is closed &amp; paid.</p>
        : <label className="mchk"><input type="checkbox" checked={inv} onChange={(e) => setInv(e.target.checked)} /> Send invoice to customer (WhatsApp, once connected)</label>}
      <div className="mrow"><button onClick={onClose}>Cancel</button><button className="go" onClick={() => onOk(pay && !o.cash_collected, !dine && inv)}>Confirm</button></div>
    </Modal>
  )
}

function OrderDetails({ o, rounds, onClose }: { o: DOrder; rounds?: DOrder[]; onClose: () => void }) {
  const { riders } = useDash()
  const rider = riders.find((r) => r.id === o.rider_id)
  return (
    <Modal onClose={onClose} className="wide">
      <h3 style={{ display: 'flex', justifyContent: 'space-between', gap: 10 }}><span>#{o.order_number}</span><span style={{ fontSize: 14, color: 'var(--muted)', textTransform: 'capitalize' }}>{statusLabel(o)}</span></h3>
      <div className="tags" style={{ marginBottom: 10 }}>
        <TypeTag o={o} /><span className="tag">{o.source}</span>
        {o.amendment_count > 0 && <span className="tag am">Amended ×{o.amendment_count}</span>}
        {o.discount_paise > 0 && <span className="tag disc">Discount {rs(o.discount_paise)}</span>}
      </div>
      <div className="osub"><b style={{ color: 'var(--ink)' }}>{customerName(o)}</b>{o.customer?.phone ? ` · ${phoneShort(o.customer.phone)}` : ''}</div>
      <div className="osub" style={{ marginBottom: 10 }}>{ist(o.created_at)}{o.taken_by ? ` · Order by ${o.taken_by}` : ''}{o.accepted_by ? ` · Accepted by ${o.accepted_by}` : ''}</div>
      {o.delivery_address && <div className="addr" style={{ marginBottom: 10 }}>📍 {o.delivery_address}{o.delivery_pincode ? ` — ${o.delivery_pincode}` : ''}</div>}
      <div className="oitems" style={{ marginBottom: 10 }}><LineItems o={o} /></div>
      {o.special_instructions && <div className="ordnote">📝 ORDER NOTE: {o.special_instructions}</div>}
      <div className="li"><span>Subtotal</span><span>{rs(o.subtotal_paise)}</span></div>
      <div className="li"><span>GST</span><span>{rs(o.gst_paise)}</span></div>
      {o.discount_paise > 0 && <div className="li"><span>Discount{o.discount_reason ? ` (${o.discount_reason})` : ''}</span><span>−{rs(o.discount_paise)}</span></div>}
      {o.loyalty_discount_paise > 0 && <div className="li"><span>Points ({o.loyalty_points_redeemed})</span><span>−{rs(o.loyalty_discount_paise)}</span></div>}
      <div className="ctot" style={{ marginTop: 8 }}><span>{rounds && rounds.length > 1 ? 'This round' : 'Total'}</span><span>{rs(o.total_paise)}</span></div>
      {rounds && rounds.length > 1 && (
        <div>
          {rounds.map((r, i) => <div key={r.id} className="rh"><span>Round {i + 1}{r.id === o.id ? ' (this)' : ''} · {statusLabel(r)}</span><span>{rs(r.total_paise)}</span></div>)}
          <div className="ctot" style={{ marginTop: 6 }}><span>Table running total</span><span>{rs(rounds.reduce((s, r) => s + r.total_paise, 0))}</span></div>
        </div>
      )}
      {rider && <div className="addr">🛵 {rider.name}</div>}
      {o.cash_collected && <div className="money">✓ {rs(o.cash_amount_paise ?? o.total_paise)} collected{o.payment_taken_by ? ` · ${o.payment_taken_by}` : ''}</div>}
      {o.cancel_reason && <div className="money bad">✕ {o.cancel_reason}{o.cancelled_by ? ` · ${o.cancelled_by}` : ''}</div>}
      <button className="btn ghost" style={{ marginTop: 14 }} onClick={onClose}>Close</button>
    </Modal>
  )
}

type EditLine = { key: string; name: string; price: number; quantity: number }

function EditOrder({ o, onClose, onSaved }: { o: DOrder; onClose: () => void; onSaved: (total: number) => void }) {
  const { api, toast } = useDash()
  const [lines, setLines] = useState<EditLine[]>(() => o.items.map((l) => ({ key: l.menu_item_id ?? `name:${l.name_snapshot}`, name: l.name_snapshot, price: l.unit_price_paise, quantity: l.quantity })))
  const [q, setQ] = useState('')
  const [menu, setMenu] = useState<Array<{ id: string; name: string; price_paise: number; is_active: boolean }> | null>(null)
  const [saving, setSaving] = useState(false)
  const loadMenu = async () => { if (!menu) setMenu((await api.get('orders', { view: 'menu' })).items) }
  const hits = q.trim() && menu ? menu.filter((m) => m.is_active && m.name.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 6) : []
  const subtotal = lines.reduce((s, l) => s + l.price * l.quantity, 0)
  const bump = (i: number, d: number) => setLines((ls) => ls.flatMap((l, j) => j !== i ? [l] : l.quantity + d <= 0 ? [] : [{ ...l, quantity: Math.min(50, l.quantity + d) }]))
  const add = (m: { id: string; name: string; price_paise: number }) => {
    setLines((ls) => ls.some((l) => l.key === m.id) ? ls.map((l) => l.key === m.id ? { ...l, quantity: l.quantity + 1 } : l) : [...ls, { key: m.id, name: m.name, price: m.price_paise, quantity: 1 }])
    setQ('')
  }
  const save = async () => {
    setSaving(true)
    try {
      const r = await api.post('orders', 'edit', { orderId: o.id, lines: lines.map((l) => ({ key: l.key, quantity: l.quantity })) })
      onSaved(r.totalPaise)
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save changes')
      setSaving(false)
    }
  }
  return (
    <Modal onClose={onClose} className="wide">
      <h3>Edit #{o.order_number}</h3>
      <div className="clines" style={{ maxHeight: '40dvh', margin: '0 -18px 8px' }}>
        {lines.length ? lines.map((l, i) => (
          <div className="cline" key={l.key}>
            <div className="nm">{l.name}<small>{rs(l.price)} each</small></div>
            <div className="stp"><button onClick={() => bump(i, -1)}>−</button><b>{l.quantity}</b><button onClick={() => bump(i, 1)}>+</button></div>
            <button className="elx" title="Remove" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}>✕</button>
          </div>
        )) : <div className="none">No items. Add one below.</div>}
      </div>
      <input className="f2" placeholder="Add a dish: search by name…" value={q} onFocus={() => void loadMenu()} onChange={(e) => { setQ(e.target.value); void loadMenu() }} autoComplete="off" />
      {hits.length > 0 && <div className="rlist">{hits.map((m) => <button key={m.id} onClick={() => add(m)}>{m.name} · {rs(m.price_paise)}</button>)}</div>}
      <div className="ctot"><span>New subtotal (before GST)</span><span>{rs(subtotal)}</span></div>
      <div className="mrow"><button onClick={onClose}>Cancel</button><button className="go" disabled={!lines.length || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</button></div>
    </Modal>
  )
}
