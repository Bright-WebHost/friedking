'use client'

import { useState } from 'react'
import type { DOrder, DSession, DTable } from '@/lib/dashboard/types'
import { ist, Loading, minsSince, Modal, phoneShort, printReceipt, printTableQR, rs, statusLabel, todayIST, useDash, useLoad, usePoll, useTick } from '../kit'
import { canEdit, LineItems, useOrderActions } from './orderParts'

type State = 'free' | 'busy' | 'ready' | 'pay'
const LABEL: Record<State, string> = { free: 'Available', busy: 'Occupied', ready: 'Food ready', pay: 'Awaiting payment' }
const RANK: Record<State, number> = { ready: 0, pay: 1, busy: 2, free: 3 }

export default function Tables() {
  const { api, go, toast, settings, branch, updated } = useDash()
  const [modal, setModal] = useState<React.ReactNode>(null)
  useTick()
  const { data, error, reload } = useLoad(async () => {
    const [t, today] = await Promise.all([
      api.get<{ tables: DTable[]; sessions: DSession[]; orders: DOrder[] }>('tables'),
      api.get<{ orders: DOrder[] }>('orders', { since: new Date(`${todayIST()}T00:00:00+05:30`).toISOString(), limit: 500 }),
    ])
    updated(new Date())
    return { ...t, todayDine: today.orders.filter((o) => o.order_type === 'dine-in' && o.status !== 'cancelled').length }
  }, [api])
  usePoll(reload)
  const act = useOrderActions(reload)
  if (!data) return <Loading error={error} onRetry={reload} />

  const sessionOf = (t: DTable) => data.sessions.find((s) => s.table_id === t.id)
  const roundsOf = (s: DSession) => data.orders.filter((o) => o.table_session_id === s.id && o.status !== 'cancelled').sort((a, b) => a.created_at.localeCompare(b.created_at))
  const totalOf = (s: DSession) => roundsOf(s).reduce((sum, o) => sum + o.total_paise, 0)
  const stateOf = (s: DSession | undefined): State => {
    if (!s) return 'free'
    const r = roundsOf(s)
    if (!r.length) return 'busy'
    if (r.every((o) => o.status === 'delivered')) return 'pay'
    if (r.some((o) => o.status === 'ready')) return 'ready'
    return 'busy'
  }
  const sorted = [...data.tables].sort((a, b) => RANK[stateOf(sessionOf(a))] - RANK[stateOf(sessionOf(b))] || a.table_number - b.table_number)
  const open = data.tables.filter((t) => sessionOf(t))
  const attention = data.tables.filter((t) => ['ready', 'pay'].includes(stateOf(sessionOf(t))))
  const close = () => setModal(null)

  const startRound = (t: DTable, s?: DSession) => go('pos', { orderType: 'dine-in', table: t.table_number, phone: s?.phone ? phoneShort(s.phone) : '', name: s?.customer_name ?? '' })

  const closeTab = (t: DTable, s: DSession) => setModal(<CloseTab t={t} s={s} total={totalOf(s)} onClose={close} onDone={async (amount, phone, inv, print) => {
    try {
      await api.post('tables', 'close', { sessionId: s.id, amountPaise: amount, phone, sendInvoice: inv })
      toast(`Table ${t.table_number} closed · ${rs(amount)}`)
      close()
      const first = roundsOf(s)[0]
      if (print && first) printReceipt({ ...first, items: roundsOf(s).flatMap((o) => o.items), total_paise: amount, subtotal_paise: roundsOf(s).reduce((x, o) => x + o.subtotal_paise, 0), gst_paise: roundsOf(s).reduce((x, o) => x + o.gst_paise, 0), cash_collected: true }, branch, settings)
      void reload()
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not close the table') }
  }} />)

  const move = (t: DTable, s: DSession) => {
    const free = data.tables.filter((x) => !sessionOf(x))
    if (!free.length) { toast('No free table to move to'); return }
    setModal(<Modal onClose={close}><h3>Move table {t.table_number} to</h3>
      <div className="rlist">{free.map((x) => <button key={x.id} onClick={async () => {
        close()
        try { await api.post('tables', 'move', { sessionId: s.id, toTableId: x.id }); toast(`Moved to table ${x.table_number}`); void reload() } catch (e) { toast(e instanceof Error ? e.message : 'Could not move') }
      }}>Table {x.table_number} · {x.seats} seats</button>)}</div>
      <button className="btn ghost" onClick={close}>Cancel</button></Modal>)
  }

  const merge = (t: DTable, s: DSession) => {
    const others = data.sessions.filter((x) => x.id !== s.id)
    if (!others.length) { toast('No other open table to merge with'); return }
    setModal(<Modal onClose={close}><h3>Merge table {t.table_number} into</h3>
      <p>All rounds move onto the table you pick, and table {t.table_number} is freed.</p>
      <div className="rlist">{others.map((x) => {
        const tt = data.tables.find((y) => y.id === x.table_id)
        return <button key={x.id} onClick={async () => {
          close()
          try { await api.post('tables', 'merge', { sessionId: s.id, intoSessionId: x.id }); toast(`Merged into table ${tt?.table_number}`); void reload() } catch (e) { toast(e instanceof Error ? e.message : 'Could not merge') }
        }}>Table {tt?.table_number} · {rs(totalOf(x))}</button>
      })}</div>
      <button className="btn ghost" onClick={close}>Cancel</button></Modal>)
  }

  const history = async (t: DTable) => {
    try {
      const { history: rows } = await api.post<{ history: Array<{ id: string; closed_at: string; closed_by_name: string | null; closed_total_paise: number | null; merged_into: string | null }> }>('tables', 'history', { tableId: t.id })
      setModal(<Modal onClose={close}><h3>Table {t.table_number} · recent tabs</h3>
        {rows.length ? <div className="ledger">{rows.map((r) => <div key={r.id}><span>{ist(r.closed_at)}{r.closed_by_name ? ` · ${r.closed_by_name}` : ''}{r.merged_into ? ' · merged' : ''}</span><b>{rs(r.closed_total_paise ?? 0)}</b></div>)}</div> : <div className="none">No closed tabs yet</div>}
        <div className="mrow"><button onClick={close}>Close</button></div></Modal>)
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not load history') }
  }

  const addTable = () => setModal(<AddTable next={Math.max(0, ...data.tables.map((t) => t.table_number)) + 1} onClose={close} onAdd={async (n, seats, section) => {
    try { await api.post('tables', 'add', { tableNumber: n, seats, section }); toast(`Table ${n} added`); close(); void reload() } catch (e) { toast(e instanceof Error ? e.message : 'Could not add') }
  }} />)

  return (
    <section>
      <div className="stats">
        <div className="stat p"><span>Tables Open</span><b>{open.length} / {data.tables.length}</b></div>
        <div className="stat o"><span>Food Ready</span><b>{data.tables.filter((t) => stateOf(sessionOf(t)) === 'ready').length}</b></div>
        <div className="stat b"><span>Dine-in today</span><b>{data.todayDine}</b></div>
        <div className="stat r"><span>Open Value</span><b>{rs(data.sessions.reduce((s, x) => s + totalOf(x), 0))}</b></div>
      </div>
      {attention.length > 0 && (
        <div className="attnbar">
          <span className="al"><span className="dot" />Needs attention</span>
          {attention.map((t) => {
            const st = stateOf(sessionOf(t))
            return <button key={t.id} className={`attnchip ${st === 'pay' ? 'pay' : ''}`} onClick={() => document.getElementById(`tbl-${t.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>Table {t.table_number} · {st === 'pay' ? 'Bill due' : 'Food ready'}</button>
          })}
        </div>
      )}
      <div className="floorbar">
        <button className="btn sm" onClick={addTable}>+ Add table</button>
        <span className="flabel">{data.tables.length} tables · tables needing you float to the top</span>
      </div>
      <div className="floor">
        {sorted.map((t) => {
          const s = sessionOf(t), st = stateOf(s)
          const rounds = s ? roundsOf(s) : []
          const m = s ? minsSince(s.opened_at) : 0
          return (
            <div key={t.id} id={`tbl-${t.id}`} className={`tbl ${st}`}>
              <div className="th">
                <div className="tn">{t.table_number}</div>
                <div><div style={{ fontWeight: 800 }}>Table {t.table_number}</div><div style={{ fontSize: 11.5, color: 'var(--muted)', fontWeight: 700 }}>{t.seats} seats{t.section ? ` · ${t.section}` : ''}</div></div>
                <span className="tstate">{LABEL[st]}</span>
              </div>
              <div className="tb">
                {s ? <>
                  <div className="guest"><span>{s.customer_name || 'Guest'}{s.phone ? ` · ${phoneShort(s.phone)}` : ''}</span><span className={`runclock ${m >= 60 ? 'bad' : m >= 40 ? 'warn' : ''}`}>⏱ {m}m</span></div>
                  {rounds.length ? rounds.map((o, i) => (
                    <div className="rnd" key={o.id}>
                      <div className="rh"><span>Round {i + 1} · {statusLabel(o)}</span><span>{rs(o.total_paise)}</span></div>
                      <LineItems o={o} />
                      <div className="mini">
                        {['preparing', 'confirmed', 'ready'].includes(o.status) && <button onClick={() => act.markDone(o)}>✓ Served</button>}
                        {canEdit(o) && <button onClick={() => act.edit(o)}>Edit round</button>}
                      </div>
                    </div>
                  )) : <div className="none" style={{ padding: '6px 0' }}>No rounds yet</div>}
                </> : <div className="none" style={{ padding: '14px 0' }}>Free · no open tab</div>}
              </div>
              {s && <div className="trun"><span style={{ fontSize: 12, fontWeight: 800, color: 'var(--muted)' }}>RUNNING TOTAL</span><b>{rs(totalOf(s))}</b></div>}
              <div className="tacts">
                {s ? <>
                  <button className="pay" onClick={() => closeTab(t, s)}>💵 Close &amp; pay · {rs(totalOf(s))}</button>
                  <button onClick={() => startRound(t, s)}>+ Round</button>
                  <button onClick={() => move(t, s)}>Move</button>
                  <button onClick={() => merge(t, s)}>Merge</button>
                </> : <button className="go" onClick={() => startRound(t)}>Start order</button>}
                <button onClick={() => {
                  if (!printTableQR(t.table_number, settings.whatsapp_number)) {
                    toast('Add a valid 10-digit WhatsApp number in Settings before printing table QR codes')
                  }
                }}>QR</button>
                <button onClick={() => void history(t)}>History</button>
              </div>
            </div>
          )
        })}
        {!data.tables.length && <div className="none">No tables yet. Tap “+ Add table”.</div>}
      </div>
      {modal}{act.modal}
    </section>
  )
}

function CloseTab({ t, s, total, onClose, onDone }: { t: DTable; s: DSession; total: number; onClose: () => void; onDone: (amountPaise: number, phone: string, invoice: boolean, print: boolean) => Promise<void> }) {
  const [amount, setAmount] = useState((total / 100).toFixed(2).replace(/\.00$/, ''))
  const [phone, setPhone] = useState(phoneShort(s.phone))
  const [inv, setInv] = useState(true)
  const [print, setPrint] = useState(true)
  const [busy, setBusy] = useState(false)
  return (
    <Modal onClose={onClose}>
      <h3>Close table {t.table_number}</h3>
      <div className="ctot"><span>Total</span><span>{rs(total)}</span></div>
      <label className="lbl">Amount received (₹)</label>
      <input className="f2" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
      <label className="lbl">WhatsApp number for the invoice</label>
      <input className="f2" inputMode="numeric" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="10-digit number" />
      <label className="mchk"><input type="checkbox" checked={inv} onChange={(e) => setInv(e.target.checked)} /> Send the invoice on WhatsApp (once connected)</label>
      <label className="mchk"><input type="checkbox" checked={print} onChange={(e) => setPrint(e.target.checked)} /> Print the bill</label>
      <div className="mrow"><button onClick={onClose}>Cancel</button><button className="go" disabled={busy} onClick={async () => { setBusy(true); await onDone(Math.round((Number(amount) || total / 100) * 100), phone, inv, print); setBusy(false) }}>Close table</button></div>
    </Modal>
  )
}

function AddTable({ next, onClose, onAdd }: { next: number; onClose: () => void; onAdd: (n: number, seats: number, section: string) => Promise<void> }) {
  const [n, setN] = useState(String(next))
  const [seats, setSeats] = useState('4')
  const [section, setSection] = useState('')
  return (
    <Modal onClose={onClose}>
      <h3>Add a table</h3>
      <label className="lbl">Table number</label><input className="f2" inputMode="numeric" value={n} onChange={(e) => setN(e.target.value)} />
      <label className="lbl">Seats</label><input className="f2" inputMode="numeric" value={seats} onChange={(e) => setSeats(e.target.value)} />
      <label className="lbl">Section (optional)</label><input className="f2" value={section} onChange={(e) => setSection(e.target.value)} placeholder="e.g. Upstairs, Outdoor" />
      <div className="mrow"><button onClick={onClose}>Cancel</button><button className="go" onClick={() => void onAdd(Number(n), Number(seats) || 4, section)}>Add</button></div>
    </Modal>
  )
}
