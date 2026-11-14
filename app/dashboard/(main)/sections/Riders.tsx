'use client'

import { useState } from 'react'
import type { DOrder, DRider, DRiderPayment } from '@/lib/dashboard/types'
import { inBounds, ist, Loading, Modal, phoneShort, RangeChips, rangeBounds, rs, Switch, useDash, useIsMobile, useLoad, type Range } from '../kit'

export default function Riders() {
  const { api, toast, reloadMeta } = useDash()
  const [range, setRange] = useState<Range>('today')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [modal, setModal] = useState<React.ReactNode>(null)
  const mobile = useIsMobile()
  const { data, error, reload } = useLoad(async () => {
    const [r, o] = await Promise.all([api.get<{ riders: DRider[]; payments: DRiderPayment[] }>('riders'), api.get<{ orders: DOrder[] }>('orders', { limit: 2000 })])
    return { ...r, orders: o.orders.filter((x) => x.rider_id) }
  }, [api])
  if (!data) return <Loading error={error} onRetry={reload} />

  const b = rangeBounds(range)
  const close = () => setModal(null)
  const refresh = () => { void reload(); void reloadMeta() }
  const stat = (r: DRider) => {
    const rows = data.orders.filter((o) => o.rider_id === r.id && inBounds(o.created_at, b))
    // Cash in hand is a running balance: not limited by the date filter.
    const held = data.orders.filter((o) => o.rider_id === r.id)
    const cash = held.filter((o) => o.cash_collected).reduce((s, o) => s + (o.cash_amount_paise ?? o.total_paise), 0)
    const due = held.filter((o) => !o.cash_collected && o.status !== 'cancelled').reduce((s, o) => s + o.total_paise, 0)
    const given = data.payments.filter((p) => p.rider_id === r.id).reduce((s, p) => s + p.amount_paise, 0)
    return { done: rows.filter((o) => o.status === 'delivered').length, lost: rows.filter((o) => o.status === 'cancelled').length, cash, due, given, owes: Math.max(0, cash - given), over: given > cash }
  }
  const all = data.riders.map(stat)
  const T = (k: 'done' | 'lost' | 'cash' | 'due' | 'given' | 'owes') => all.reduce((s, x) => s + x[k], 0)

  const add = async () => {
    try { await api.post('riders', 'add', { name, phone }); toast(`${name} added`); setName(''); setPhone(''); refresh() } catch (e) { toast(e instanceof Error ? e.message : 'Could not add') }
  }
  const toggle = async (r: DRider) => {
    try { const x = await api.post<{ active: boolean }>('riders', 'toggle', { id: r.id }); toast(`${r.name}${x.active ? ' is back on' : ' is off duty'}`); refresh() } catch (e) { toast(e instanceof Error ? e.message : 'Could not update') }
  }
  const remove = (r: DRider) => {
    const s = stat(r)
    if (s.owes > 0) { toast(`${r.name} still owes ${rs(s.owes)}. Settle before deleting.`); return }
    setModal(<Modal onClose={close}><h3>Delete {r.name}?</h3><p>Past deliveries stay on record.</p><div className="mrow"><button onClick={close}>Cancel</button><button className="x" onClick={async () => {
      close(); try { await api.post('riders', 'remove', { id: r.id }); toast(`${r.name} removed`); refresh() } catch (e) { toast(e instanceof Error ? e.message : 'Could not delete') }
    }}>Delete</button></div></Modal>)
  }
  const handover = (r: DRider) => setModal(<Handover r={r} payments={data.payments.filter((p) => p.rider_id === r.id)} onClose={close} onSaved={(amt) => { close(); toast(`${amt} recorded from ${r.name}`); void reload() }} />)

  return (
    <section>
      <RangeChips range={range} setRange={setRange} />
      <div className="tcard"><h3>Add a rider</h3>
        <div className="pickbar">
          <input className="f grow" style={{ margin: 0 }} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="f grow" style={{ margin: 0 }} placeholder="WhatsApp number" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <button className="btn sm" onClick={() => void add()}>Add</button>
        </div>
      </div>
      <div className="riderhdr">
        <div className="rstat"><span>Deliveries done</span><b>{T('done')}</b></div>
        <div className="rstat"><span>Cancelled</span><b>{T('lost')}</b></div>
        <div className="rstat"><span>Cash collected</span><b>{rs(T('cash'))}</b></div>
        <div className="rstat"><span>Still to collect</span><b style={{ color: 'var(--red)' }}>{rs(T('due'))}</b></div>
        <div className="rstat"><span>Handed over</span><b>{rs(T('given'))}</b></div>
        <div className="rstat"><span>Riders owe</span><b style={{ color: 'var(--red)' }}>{rs(T('owes'))}</b></div>
      </div>
      {mobile ? <div className="molist">{data.riders.length ? data.riders.map((r) => { const s = stat(r); return (
        <div className="mocard" key={r.id}>
          <div className="morow"><b>{r.name}</b><span>{phoneShort(r.phone)}</span></div>
          <div className="oitems">Done <b>{s.done}</b>{s.lost ? <> · Cancelled <b style={{ color: 'var(--red)' }}>{s.lost}</b></> : null}<br />
            Collected <b>{rs(s.cash)}</b>{s.due ? <> · Pending <b style={{ color: 'var(--red)' }}>{rs(s.due)}</b></> : null}<br />
            Handed over <b>{rs(s.given)}</b>{s.owes ? <> · Owes <b style={{ color: 'var(--red)' }}>{rs(s.owes)}</b></> : null}</div>
          {s.over && <div className="money bad">⚠ Handed over more than recorded: some delivered orders may be missing “Collect cash”</div>}
          <div className="moacts" style={{ marginTop: 10 }}>
            <button className={`mobtn ${r.is_active ? 'go' : ''}`} onClick={() => void toggle(r)}>{r.is_active ? '🟢 On duty' : '⚪ Off duty'}</button>
            <button className="mobtn" onClick={() => handover(r)}>Collect cash</button>
            <button className="mobtn bad" onClick={() => remove(r)}>Delete</button>
          </div>
        </div>) }) : <div className="none">No riders yet</div>}</div>
        : <div className="tblwrap"><table><thead><tr><th>Rider</th><th>Number</th><th>Done</th><th>Cancelled</th><th>Collected</th><th>Pending</th><th>Handed over</th><th>Owes</th><th>On duty</th><th /></tr></thead><tbody>
          {data.riders.length ? data.riders.map((r) => { const s = stat(r); return (
            <tr key={r.id}><td><b>{r.name}</b></td><td>{phoneShort(r.phone)}</td><td>{s.done}</td><td>{s.lost ? <b style={{ color: 'var(--red)' }}>{s.lost}</b> : 0}</td>
              <td><b>{rs(s.cash)}</b></td><td>{s.due ? <b style={{ color: 'var(--red)' }}>{rs(s.due)}</b> : '—'}</td><td>{rs(s.given)}</td>
              <td>{s.owes ? <b style={{ color: 'var(--red)' }}>{rs(s.owes)}</b> : s.over ? <b style={{ color: 'var(--red)' }} title="Handed over more than recorded collected: some delivered orders may be missing Collect cash">⚠ check</b> : '—'}</td>
              <td><Switch on={r.is_active} onClick={() => void toggle(r)} label="On duty" /></td>
              <td style={{ whiteSpace: 'nowrap' }}><button className="btn sm ghost" style={{ marginRight: 5 }} onClick={() => handover(r)}>Collect cash</button><button className="btn sm ghost danger" onClick={() => remove(r)}>Delete</button></td></tr>) })
            : <tr><td colSpan={10}><div className="none">No riders yet</div></td></tr>}
        </tbody></table></div>}
      {modal}
    </section>
  )
}

function Handover({ r, payments, onClose, onSaved }: { r: DRider; payments: DRiderPayment[]; onClose: () => void; onSaved: (amt: string) => void }) {
  const { api, toast } = useDash()
  const [amt, setAmt] = useState('')
  const [note, setNote] = useState('')
  return <Modal onClose={onClose}><h3>Cash from {r.name}</h3>
    <input className="f2" inputMode="decimal" placeholder="Amount received (₹) *" value={amt} onChange={(e) => setAmt(e.target.value)} autoFocus />
    <input className="f2" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
    <div className="mrow"><button onClick={onClose}>Cancel</button><button className="go" onClick={async () => {
      if (!(Number(amt) > 0)) { toast('Enter the amount received'); return }
      try { await api.post('riders', 'handover', { id: r.id, amount: amt, note }); onSaved(rs(Number(amt) * 100)) } catch (e) { toast(e instanceof Error ? e.message : 'Could not record') }
    }}>Record</button></div>
    {payments.length > 0 && <div className="ledger">{payments.slice(0, 12).map((p) => <div key={p.id}><span>{ist(p.created_at)}{p.note ? ` · ${p.note}` : ''}</span><b>{rs(p.amount_paise)}</b></div>)}</div>}
  </Modal>
}
