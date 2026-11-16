'use client'

import { useMemo, useState } from 'react'
import type { DOrder } from '@/lib/dashboard/types'
import { isBoss } from '@/lib/dashboard/access'
import {
  customerName, ist, Loading, phoneShort, RangeChips, rangeBounds, rs, Slide, statusLabel, useDash, useIsMobile, useLoad, usePoll, useTick, type Range,
} from '../kit'
import { Age, canEdit, LineItems, TypeTag, useOrderActions } from './orderParts'
import { TableRail, useFloor } from './Tables'

const ACTIVE_DINE = ['pending', 'confirmed', 'preparing', 'ready']

export default function Orders() {
  const { api, updated, riders, staff } = useDash()
  const [range, setRange] = useState<Range>('today')
  const [drawer, setDrawer] = useState(false)
  const [flash] = useState<string | null>(null)
  const mobile = useIsMobile()
  useTick()

  const { data, error, loading, reload } = useLoad(async () => {
    const b = rangeBounds(range)
    const r = await api.get<{ orders: DOrder[]; serverTime: string }>('orders', { since: range === 'all' ? null : new Date(b.start).toISOString(), until: range === 'yesterday' ? new Date(b.end).toISOString() : null })
    updated(new Date())
    return r.orders
  }, [range, api])
  usePoll(reload)
  const floor = useFloor()
  const reloadAll = () => { void reload(); void floor.reload() }
  const act = useOrderActions(reloadAll)

  const orders = useMemo(() => data ?? [], [data])
  const live = orders
  const cancelled = live.filter((o) => o.status === 'cancelled')
  const valid = live.filter((o) => o.status !== 'cancelled')
  const revenue = valid.reduce((s, o) => s + o.total_paise, 0)
  const cashDue = valid.filter((o) => !o.cash_collected && ['preparing', 'ready', 'delivered'].includes(o.status)).reduce((s, o) => s + o.total_paise, 0)

  if (loading && !data) return <Loading />
  if (error && !data) return <Loading error={error} onRetry={reload} />

  const fd = floor.data
  const openTabs = fd ? fd.sessions.reduce((sum, x) => sum + floor.totalOf(x), 0) : 0
  const stats = (
    <div className="ministats floorstats">
      <div className="mstat c-blue"><span>Tables</span><b>{fd ? `${fd.sessions.length}/${fd.tables.length}` : '–'}</b></div>
      <div className="mstat c-purple"><span>Food ready</span><b>{fd ? fd.tables.filter((t) => floor.stateOf(floor.sessionOf(t)) === 'ready').length : 0}</b></div>
      <div className="mstat c-green"><span>Open tabs</span><b>{rs(openTabs)}</b></div>
      <div className="mstat c-red"><span>Revenue</span><b>{rs(revenue)}</b></div>
      <div className="mstat c-blue"><span>Orders</span><b>{valid.length}</b></div>
      <div className="mstat c-amber"><span>Awaiting</span><b>{valid.filter((o) => o.status === 'pending').length}</b></div>
      <div className="mstat c-purple"><span>Kitchen</span><b>{valid.filter((o) => ['preparing', 'confirmed'].includes(o.status)).length}</b></div>
      <div className="mstat c-amber"><span>Cash due</span><b>{rs(cashDue)}</b></div>
    </div>
  )

  if (mobile) {
    return (
      <>
        {stats}
        <TableRail floor={floor} mobile />
        <MobileOrders orders={orders} act={act} revenue={revenue} range={range} setRange={setRange} />
        {floor.popup(act)}{floor.modal}
      </>
    )
  }

  // New dine-in rounds have a dedicated table column; accepted rounds follow the normal kitchen flow.
  const dineActive = valid.filter((o) => o.order_type === 'dine-in' && ACTIVE_DINE.includes(o.status) && o.status === 'pending')
  const prep = valid.filter((o) => ['preparing', 'confirmed'].includes(o.status))
  const ready = valid.filter((o) => o.order_type !== 'dine-in' && o.status === 'ready')
  const done = valid.filter((o) => o.status === 'delivered')

  const card = (o: DOrder, col: 'prep' | 'ready' | 'done' | 'dine' | 'drawer') => {
    const rider = riders.find((r) => r.id === o.rider_id)
    const paidUp = o.cash_collected
    return (
      <div key={o.id} className={`o ch-${o.order_type} ${o.id === flash ? 'flash' : ''}`} onClick={(e) => {
        if ((e.target as HTMLElement).closest('button,.slide,.mini')) return
        act.details(o, o.table_session_id ? valid.filter((x) => x.table_session_id === o.table_session_id).sort((a, b) => a.created_at.localeCompare(b.created_at)) : undefined)
      }}>
        <div className="orow">
          <div>
            <div className="onum">#{o.order_number}</div>
            <div className="osub">{o.order_type === 'dine-in' ? `Table ${o.table_number ?? '?'}${o.customer?.name ? ` · ${o.customer.name}` : ''}` : `${customerName(o)} · ${phoneShort(o.customer?.phone)}`}</div>
            <div className="osub">{ist(o.created_at)}</div>
          </div>
          <div className="oamt">{rs(o.total_paise)}</div>
        </div>
        <div className="oitems"><LineItems o={o} /></div>
        {o.special_instructions && <div className="ordnote">📝 ORDER NOTE: {o.special_instructions}</div>}
        {o.delivery_address && <div className="addr">📍 {o.delivery_address}{o.delivery_pincode ? ` — ${o.delivery_pincode}` : ''}</div>}
        <div className="tags">
          <TypeTag o={o} /><span className="tag">{o.source}</span>
          {o.amendment_count > 0 && <span className="tag am">Amended ×{o.amendment_count}</span>}
          {o.discount_paise > 0 && <span className="tag disc">Disc {rs(o.discount_paise)}</span>}
          <Age o={o} />
        </div>
        {col === 'prep' && <Slide label={o.order_type === 'delivery' ? 'Slide to out for delivery' : 'Slide to ready'} color="#1a5fa8" onDone={() =>
          o.order_type === 'delivery' && !o.rider_id
            ? new Promise((res) => act.assignRider(o, () => void act.setStatus(o, 'ready').then(res)))
            : act.setStatus(o, 'ready')} />}
        {col === 'ready' && <Slide label="Slide to done" color="#5b3fbf" onDone={() => act.setStatus(o, 'delivered')} />}
        {col === 'dine' && (o.status === 'pending'
          ? <div className="money due">Waiting for accept</div>
          : <button className="donebtn" onClick={() => act.markDone(o)}>✓ Mark done</button>)}
        {rider && <div className="addr">🛵 {rider.name}</div>}
        {o.order_type !== 'dine-in' && ['ready'].includes(o.status) && !paidUp &&
          <div className="money due">💵 Collect {rs(o.total_paise)} {o.order_type === 'delivery' ? 'on delivery' : 'at the counter'}</div>}
        {paidUp && <div className="money">✓ {rs(o.cash_amount_paise ?? o.total_paise)} collected</div>}
        {o.cancel_reason && <div className="money bad">✕ {o.cancel_reason}{o.cancelled_by ? ` · ${o.cancelled_by}` : ''}</div>}
        {o.taken_by && <div className="whotook">Order by {o.taken_by}</div>}
        {paidUp && o.payment_taken_by && <div className="whotook">Taken by {o.payment_taken_by}</div>}
        <div className="mini">
          {['ready', 'delivered'].includes(o.status) && o.order_type === 'delivery' && !o.rider_id && <button onClick={() => act.assignRider(o)}>Assign rider</button>}
          {['ready', 'delivered'].includes(o.status) && o.order_type !== 'dine-in' && (paidUp
            ? <button className="cashdone" disabled>✓ Cash {rs(o.cash_amount_paise ?? o.total_paise)}</button>
            : <button className="cashbtn" onClick={() => void act.cash(o)}>💵 Collect {rs(o.total_paise)}</button>)}
          {col === 'prep' && o.order_type === 'delivery' && <button onClick={() => void act.setStatus(o, 'ready')}>Ready (no rider)</button>}
          {col === 'done' && isBoss(staff.role) && <button onClick={() => void act.setStatus(o, 'ready')}>Undo</button>}
          {col === 'drawer' && isBoss(staff.role) && <button onClick={() => void act.setStatus(o, o.accepted_at ? 'preparing' : 'pending')}>Restore</button>}
          {!['delivered', 'cancelled'].includes(o.status) && <button className="x" onClick={() => act.cancel(o)}>Cancel</button>}
          {canEdit(o) && <button onClick={() => act.edit(o)}>Edit</button>}
          <button onClick={() => act.print(o)}>Print</button>
        </div>
      </div>
    )
  }

  return (
    <section>
      {stats}
      <div className="floorwrap">
        <TableRail floor={floor} />
        <div className="floorboard">
      <RangeChips range={range} setRange={setRange} />
      <div className="board">
        {dineActive.length > 0 && <div className="col dinein">
          <div className="colbar"><span>🍽️ Table orders · new</span><span className="cnt">{dineActive.length}</span></div>
          {dineActive.map((o) => card(o, 'dine'))}
        </div>}
        <div className="col preparing">
          <div className="colbar"><span>Preparing</span><span className="cnt">{prep.length}</span></div>
          {prep.length ? prep.map((o) => card(o, 'prep')) : <div className="none">Nothing here</div>}
        </div>
        <div className="col ready">
          <div className="colbar"><span>Ready / Out</span><span className="cnt">{ready.length}</span></div>
          {ready.length ? ready.map((o) => card(o, 'ready')) : <div className="none">Nothing here</div>}
        </div>
        <div className="col delivered">
          <div className="colbar"><span>Done</span><span className="cnt">{done.length}</span></div>
          {done.length ? done.map((o) => card(o, 'done')) : <div className="none">Nothing here</div>}
        </div>
      </div>
      <div className="drawer">
        <button onClick={() => setDrawer((d) => !d)}>Declined &amp; cancelled <span>{cancelled.length} ▾</span></button>
        {drawer && <div className="body">{cancelled.length ? cancelled.map((o) => card(o, 'drawer')) : <div className="none">None</div>}</div>}
      </div>
        </div>
      </div>
      {floor.popup(act)}{floor.modal}{act.modal}
    </section>
  )
}

type Act = ReturnType<typeof useOrderActions>

/** Phone layout: pill tabs + big buttons (Oceana's mobile Orders). New orders can be accepted from the list too. */
function MobileOrders({ orders, act, revenue, range, setRange }: { orders: DOrder[]; act: Act; revenue: number; range: Range; setRange: (r: Range) => void }) {
  const { api, toast } = useDash()
  const live = orders.filter((o) => o.status !== 'cancelled')
  const groups: Record<string, DOrder[]> = {
    new: live.filter((o) => o.status === 'pending'),
    preparing: live.filter((o) => ['preparing', 'confirmed'].includes(o.status)),
    ready: live.filter((o) => o.status === 'ready'),
    delivered: live.filter((o) => o.status === 'delivered'),
  }
  const [tab, setTab] = useState(groups.new.length ? 'new' : 'preparing')
  const list = groups[tab] ?? []

  const accept = async (o: DOrder) => {
    try { await api.post('orders', 'accept', { orderId: o.id, prepMinutes: 20 }); toast(`#${o.order_number} accepted · ready in 20 min`); window.dispatchEvent(new Event('fk-orders-changed')) }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not accept') }
  }
  const decline = (o: DOrder) => act.setModal(
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) act.close() }}>
      <div className="mcard"><h3>Decline #{o.order_number}</h3>
        <div className="rlist">{['Item unavailable', 'Kitchen full', 'Outside delivery area', 'Closing soon'].map((r) => (
          <button key={r} onClick={async () => {
            act.close()
            try { await api.post('orders', 'decline', { orderId: o.id, reason: r }); toast(`#${o.order_number} declined · ${r}`); window.dispatchEvent(new Event('fk-orders-changed')) }
            catch (e) { toast(e instanceof Error ? e.message : 'Could not decline') }
          }}>{r}</button>
        ))}</div>
        <button className="btn ghost" onClick={act.close}>Cancel</button>
      </div>
    </div>,
  )

  return (
    <section>
      <RangeChips range={range} setRange={setRange} />
      <div className="movrow">
        <div className="mostat rev"><span>Revenue</span><b>{rs(revenue)}</b></div>
        <div className="mostat"><span>Orders</span><b>{live.length}</b></div>
      </div>
      <div className="mtabs">
        {([['new', 'New'], ['preparing', 'Preparing'], ['ready', 'Ready / Out'], ['delivered', 'Done']] as const).map(([k, l]) => (
          <button key={k} className="mtab" aria-pressed={tab === k} onClick={() => setTab(k)}>{l}{groups[k].length ? ` (${groups[k].length})` : ''}</button>
        ))}
      </div>
      <div className="molist">
        {list.length ? list.map((o) => (
          <div key={o.id} className="mocard">
            <div className="morow"><b>#{o.order_number}</b><span>{ist(o.created_at)} · <Age o={o} /></span></div>
            <div className="osub">{o.order_type === 'dine-in' ? `Table ${o.table_number ?? '?'}` : customerName(o)}{o.customer?.phone ? ` · ${phoneShort(o.customer.phone)}` : ''}</div>
            {o.delivery_address && <div className="osub">📍 {o.delivery_address}</div>}
            <div className="oitems">{o.items.map((l) => `${l.quantity} × ${l.name_snapshot}`).join(', ')}</div>
            {o.items.filter((l) => l.notes).map((l) => <div key={l.id} className="linote">📝 {l.name_snapshot}: {l.notes}</div>)}
            {o.special_instructions && <div className="ordnote">📝 ORDER NOTE: {o.special_instructions}</div>}
            <div className="moamt">{rs(o.total_paise)} · <span style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'capitalize' }}>{statusLabel(o)}</span></div>
            <div className="moacts">
              {o.status === 'pending' && <>
                <button className="mobtn go" onClick={() => void accept(o)}>Accept</button>
                <button className="mobtn bad" onClick={() => decline(o)}>Reject</button>
              </>}
              {['preparing', 'confirmed'].includes(o.status) && (o.order_type === 'dine-in'
                ? <button className="mobtn go" onClick={() => act.markDone(o)}>✓ Mark done</button>
                : <button className="mobtn go" onClick={() => o.order_type === 'delivery' && !o.rider_id ? act.assignRider(o, () => void act.setStatus(o, 'ready')) : void act.setStatus(o, 'ready')}>Ready / dispatch</button>)}
              {o.status === 'ready' && <>
                <button className="mobtn go" onClick={() => act.markDone(o)}>Mark delivered</button>
                {!o.cash_collected && <button className="mobtn" onClick={() => void act.cash(o)}>💵 {rs(o.total_paise)}</button>}
              </>}
              {canEdit(o) && <button className="mobtn" onClick={() => act.edit(o)}>Edit</button>}
              <button className="mobtn" onClick={() => act.print(o)}>Print</button>
            </div>
          </div>
        )) : <div className="none">Nothing here</div>}
      </div>
      {act.modal}
    </section>
  )
}
