'use client'

/* Oceana's acceptance popup: rings until a new order is accepted (prep time + slide) or declined (reason + slide). */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { DOrder } from '@/lib/dashboard/types'
import { customerName, ist, phoneShort, printReceipt, rs, Slide, typeLabel, useDash } from './kit'

const PREP = [10, 15, 20, 30, 45]
const REASONS = ['Item unavailable', 'Kitchen full', 'Outside delivery area', 'Closing soon']

export default function NewOrderAlert({ onNew, sirenBeat }: { onNew: (o: DOrder) => void; sirenBeat: () => void }) {
  const { api, busy, toast, branch, settings } = useDash()
  const [queue, setQueue] = useState<DOrder[]>([])
  const [prep, setPrep] = useState(20)
  const [pane, setPane] = useState<'accept' | 'decline'>('accept')
  const [reason, setReason] = useState('')
  const seen = useRef<Set<string> | null>(null)
  const lastIds = useRef<string | null>(null)
  const onNewRef = useRef(onNew)
  onNewRef.current = onNew

  const poll = useCallback(async () => {
    if (document.hidden) return
    try {
      const { orders } = await api.get<{ orders: DOrder[] }>('orders', { pending: 1 })
      const pending = orders.filter((o) => o.status === 'pending').sort((a, b) => a.created_at.localeCompare(b.created_at))
      const first = seen.current === null
      seen.current ??= new Set()
      let arrived = false
      for (const o of pending) if (!seen.current.has(o.id)) { seen.current.add(o.id); if (!first) { arrived = true; onNewRef.current(o) } }
      // The board and tables refresh only every 30 s; a new order (or one accepted on another screen) refreshes them now.
      const ids = pending.map((o) => o.id).join(',')
      const changed = lastIds.current !== null && lastIds.current !== ids
      lastIds.current = ids
      setQueue(pending)
      if (arrived || changed) window.dispatchEvent(new Event('fk-orders-changed'))
    } catch { /* next poll retries */ }
  }, [api])

  useEffect(() => {
    void poll()
    const t = window.setInterval(() => { if (busy.current === 0 || queue.length) void poll() }, 4000)
    const r = () => void poll()
    window.addEventListener('fk-refresh', r)
    window.addEventListener('fk-orders-changed', r)
    return () => { window.clearInterval(t); window.removeEventListener('fk-refresh', r); window.removeEventListener('fk-orders-changed', r) }
  }, [poll, busy, queue.length])

  const current = queue[0]
  // Siren while the popup is open.
  useEffect(() => {
    if (!current) return
    sirenBeat()
    const t = window.setInterval(sirenBeat, 1600)
    return () => window.clearInterval(t)
  }, [current?.id, sirenBeat]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { setPrep(20); setPane('accept'); setReason('') }, [current?.id])

  if (!current) return null
  const o = current

  const done = () => {
    setQueue((q) => q.filter((x) => x.id !== o.id))
    window.dispatchEvent(new Event('fk-orders-changed'))
  }
  const accept = async () => {
    try {
      await api.post('orders', 'accept', { orderId: o.id, prepMinutes: prep })
      toast(`#${o.order_number} accepted · ready in ${prep} min`)
      if (settings.auto_print === 'true' && !o.printed_at) {
        if (printReceipt({ ...o, status: 'preparing' }, branch, settings)) void api.post('orders', 'printed', { orderId: o.id })
      }
      done()
    } catch (e) {
      toast(e instanceof Error ? e.message : `Could not accept #${o.order_number}`)
      void poll()
      return false
    }
  }
  const decline = async () => {
    if (!reason) { toast('Pick a reason first'); return false }
    try {
      await api.post('orders', 'decline', { orderId: o.id, reason })
      toast(`#${o.order_number} declined · ${reason}`)
      done()
    } catch (e) {
      toast(e instanceof Error ? e.message : `Could not decline #${o.order_number}`)
      return false
    }
  }

  return (
    <div className="alertwrap">
      <div className="acard" role="alertdialog" aria-label={`New order ${o.order_number}`}>
        <div className="ahead">
          <b>🔔 New {typeLabel(o.order_type)} order</b>
          {queue.length > 1 && <span className="queue">+{queue.length - 1} waiting</span>}
        </div>
        <div className="abody">
          <div className="aline"><span>#{o.order_number}</span><span>{ist(o.created_at)}</span></div>
          <div className="aline"><span>{customerName(o)}</span><b>{phoneShort(o.customer?.phone)}</b></div>
          {o.table_number && <div className="aline"><span>Table</span><b>{o.table_number}</b></div>}
          {o.delivery_address && <div className="aline"><span>📍</span><b style={{ textAlign: 'right' }}>{o.delivery_address}{o.delivery_pincode ? ` — ${o.delivery_pincode}` : ''}</b></div>}
          <div className="aitems">
            {o.items.map((l) => <div key={l.id}>{l.quantity} × {l.name_snapshot}{l.notes ? <div className="linote">📝 NOTE: {l.notes}</div> : null}</div>)}
            {o.special_instructions && <div className="ordnote">📝 ORDER NOTE: {o.special_instructions}</div>}
          </div>
          <div className="aline"><span>Payment</span><b>{o.payment_method === 'upi' ? 'UPI' : 'Cash'} {o.order_type === 'delivery' ? 'on delivery' : 'at counter'}</b></div>
          <div className="aline" style={{ alignItems: 'flex-end' }}><span>Total</span><span className="atot">{rs(o.total_paise)}</span></div>

          {pane === 'accept' ? (
            <>
              <div className="aq">Ready in</div>
              <div className="prep">
                {PREP.map((m) => <button key={m} aria-pressed={prep === m} onClick={() => setPrep(m)}>{m} min</button>)}
              </div>
              <Slide big pulse label="Slide right to ACCEPT →" color="#3ab757" onDone={accept} />
              <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setPane('decline')}>Decline this order</button>
            </>
          ) : (
            <>
              <div className="aq">Why are you declining?</div>
              <div className="reason">
                {REASONS.map((r) => <button key={r} aria-pressed={reason === r} onClick={() => setReason(r)}>{r}</button>)}
              </div>
              <Slide big label={reason ? 'Slide right to DECLINE →' : 'Pick a reason first'} color="#6b6f78" onDone={decline} />
              <button className="btn ghost" style={{ marginTop: 10 }} onClick={() => setPane('accept')}>← Back</button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
