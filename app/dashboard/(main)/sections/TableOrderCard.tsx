'use client'

import { useState } from 'react'
import type { BoardOrder } from '@/lib/dashboard/orderCards'
import { customerName, ist, rs, Slide, statusLabel, useDash } from '../kit'
import { Age, canEdit, LineItems, type useOrderActions } from './orderParts'

export default function TableOrderCard({ order, act, mobile = false, onOpen }: {
  order: BoardOrder; act: ReturnType<typeof useOrderActions>; mobile?: boolean; onOpen: () => void
}) {
  const { api, toast } = useDash()
  const [working, setWorking] = useState(false)
  const rounds = order.rounds!
  const first = rounds[0]
  const update = async (fn: () => Promise<unknown>) => {
    setWorking(true)
    try { await fn(); window.dispatchEvent(new Event('fk-orders-changed')); return true }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not update the table'); window.dispatchEvent(new Event('fk-orders-changed')); return false }
    finally { setWorking(false) }
  }
  const ready = () => update(() => api.post('tables', 'ready', { sessionId: order.table_session_id }))
  const done = async () => { await act.markDone(first); return false }
  return (
    <div className={`${mobile ? 'mocard' : 'o'} ch-dine-in table-order-card`} data-session-id={order.table_session_id} onClick={(e) => {
      if (!(e.target as HTMLElement).closest('button,.slide,.mini')) onOpen()
    }}>
      <div className="orow">
        <div><div className="onum">Table {order.table_number ?? '?'}</div>
          <div className="osub">{customerName(order)} · {rounds.length} {rounds.length === 1 ? 'round' : 'rounds'}</div>
          <div className="osub">{ist(order.created_at)} · <Age o={order} /></div>
        </div>
        <div className="oamt">{rs(order.total_paise)}</div>
      </div>
      <div className="table-rounds">
        {rounds.map((round, index) => <div className="table-round" key={round.id}>
          <div className="rh"><span>Round {index + 1} · #{round.order_number}</span><span className={`round-state ${round.status}`}>{statusLabel(round)}</span></div>
          <div className="oitems"><LineItems o={round} /></div>
          {round.special_instructions && <div className="ordnote">ORDER NOTE: {round.special_instructions}</div>}
          <div className="mini">
            {round.status === 'pending' && <>
              <button disabled={working} onClick={() => void update(() => api.post('orders', 'accept', { orderId: round.id, prepMinutes: 20 }))}>Accept round {index + 1}</button>
              <button disabled={working} onClick={() => void update(() => api.post('orders', 'decline', { orderId: round.id, reason: 'Kitchen full' }))}>Reject round {index + 1}</button>
            </>}
            {canEdit(round) && <button onClick={() => act.edit(round)}>Edit round {index + 1}</button>}
            {!['delivered', 'cancelled'].includes(round.status) && <button className="x" onClick={() => act.cancel(round)}>Cancel round {index + 1}</button>}
          </div>
        </div>)}
      </div>
      {order.status === 'pending' && <div className="money due">Accept the new round to continue</div>}
      {order.status === 'preparing' && (mobile
        ? <button className="mobtn go" disabled={working} onClick={() => void ready()}>Mark all rounds served</button>
        : <Slide label="Slide to ready" color="#1a5fa8" onDone={ready} />)}
      {order.status === 'ready' && (mobile
        ? <button className="mobtn go" onClick={() => void done()}>Close table &amp; mark done</button>
        : <Slide label="Slide to done" color="#5b3fbf" onDone={done} />)}
      {order.cash_collected && <div className="money">✓ {rs(order.cash_amount_paise || order.total_paise)} collected</div>}
      <div className="mini table-card-actions">
        <button onClick={onOpen}>{order.status === 'delivered' ? 'View bill' : 'Manage table'}</button>
        <button onClick={() => act.print(order)}>Print table bill</button>
        <button onClick={() => act.printKOT(order)}>KOT</button>
      </div>
    </div>
  )
}
