'use client'

import { useMemo, useState } from 'react'
import type { DOrder } from '@/lib/dashboard/types'
import { buildOrderCards, type BoardOrder } from '@/lib/dashboard/orderCards'
import { isBoss } from '@/lib/dashboard/access'
import {
  customerName, ist, Loading, phoneShort, RangeChips, rangeBounds, rs, Slide, statusLabel, useDash, useIsMobile, useLoad, usePoll, useTick, type Range,
} from '../kit'
import { Age, canEdit, LineItems, TypeTag, useOrderActions } from './orderParts'
import { TableRail, useFloor } from './Tables'
import TableOrderCard from './TableOrderCard'

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
  const boardOrders = useMemo(() => {
    const byId = new Map(orders.map((o) => [o.id, o]))
    // An open table may have started before midnight. Keep its complete tab on today's board.
    if (range === 'today' || range === 'all') for (const o of floor.data?.orders ?? []) {
      if (!byId.has(o.id) || o.updated_at >= byId.get(o.id)!.updated_at) byId.set(o.id, o)
    }
    return buildOrderCards([...byId.values()])
  }, [orders, floor.data, range])
  const live = orders
  const cancelled = live.filter((o) => o.status === 'cancelled')
  const valid = live.filter((o) => o.status !== 'cancelled')
  const revenue = valid.reduce((s, o) => s + o.total_paise, 0)
  const cashDue = valid.filter((o) => !o.cash_collected && ['preparing', 'ready', 'delivered'].includes(o.status)).reduce((s, o) => s + o.total_paise, 0)

  if (loading && !data) return <Loading />
  if (error && !data) return <Loading error={error} onRetry={reload} />

  const fd = floor.data
  const openTable = (o: BoardOrder) => {
    const session = fd?.sessions.find((s) => s.id === o.table_session_id)
    if (session) floor.setOpenId(session.table_id)
    else act.details(o.rounds?.[0] ?? o, o.rounds)
  }
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
        <MobileOrders orders={boardOrders} act={act} revenue={revenue} range={range} setRange={setRange} openTable={openTable} floor={floor} />
        {floor.popup(act)}{floor.modal}{act.modal}
      </>
    )
  }

  // Each table session follows one kitchen card; a new round moves that card back to New/Preparing.
  const dineActive = boardOrders.filter((o) => o.order_type === 'dine-in' && ACTIVE_DINE.includes(o.status) && o.status === 'pending')
  const prep = boardOrders.filter((o) => ['preparing', 'confirmed'].includes(o.status))
  const ready = boardOrders.filter((o) => o.status === 'ready')
  const done = boardOrders.filter((o) => o.status === 'delivered')

  const card = (o: BoardOrder, col: 'prep' | 'ready' | 'done' | 'dine' | 'drawer') => {
    if (o.rounds) return <TableOrderCard key={o.table_session_id} order={o} act={act} onOpen={() => openTable(o)} />
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
          <button onClick={() => act.printKOT(o)}>KOT</button>
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

const RANGE_LABELS: Record<Range, string> = {
  today: 'Today',
  yesterday: 'Yesterday',
  week: 'Last 7 days',
  month: 'This month',
  all: 'All time',
  custom: 'Custom',
}

function MobileOrderProgress({ order }: { order: BoardOrder }) {
  const stage = order.status === 'pending' ? 0
    : ['preparing', 'confirmed'].includes(order.status) ? 1
      : order.status === 'ready' ? 2
        : 3
  const isDine = order.order_type === 'dine-in'
  const title = stage === 0 ? 'New order'
    : stage === 1 ? 'Being prepared'
      : stage === 2
        ? order.order_type === 'delivery' ? 'Out for delivery' : isDine ? 'Ready to serve' : 'Ready for pickup'
        : isDine ? 'Served & closed' : 'Delivered / Fulfilled'
  const detail = stage === 0 ? 'Waiting for staff to accept'
    : stage === 1 ? 'Kitchen is preparing this order'
      : stage === 2
        ? order.order_type === 'delivery' ? 'Rider assigned / on the way' : isDine ? 'Ready to serve at table' : 'Waiting for customer pickup'
        : isDine ? 'This table order has been served' : 'This order has been fulfilled'
  const steps = ['Received', 'Preparing', 'Ready', isDine ? 'Served' : 'Done']

  return (
    <section className={`mo-progress sts-${stage === 3 ? 'delivered' : stage === 2 ? 'ready' : stage === 1 ? 'preparing' : 'new'}`} aria-label={`Order status: ${title}`}>
      <div className="mo-progress-heading">
        <div>
          <span className="mo-progress-eyebrow">CURRENT STATUS · STEP ${stage + 1} OF 4</span>
          <strong>{title}</strong>
          <span className="mo-progress-detail">{detail}</span>
        </div>
      </div>
      <ol className="mo-progress-steps">
        {steps.map((step, index) => (
          <li key={step} className={index < stage ? 'complete' : index === stage ? 'current' : ''} aria-current={index === stage ? 'step' : undefined}>
            <span className="mo-progress-dot">{index < stage ? '✓' : index + 1}</span>
            <span className="mo-progress-step-label">{step}</span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/** Phone layout: Rasoi-style organized mobile orders board with summary, 2x2 status grid, progress tracker, and clean actions. */
function MobileOrders({
  orders, act, revenue, range, setRange, openTable, floor,
}: {
  orders: BoardOrder[]
  act: Act
  revenue: number
  range: Range
  setRange: (r: Range) => void
  openTable: (o: BoardOrder) => void
  floor: ReturnType<typeof useFloor>
}) {
  const { api, toast, riders, go } = useDash()
  const [filterOpen, setFilterOpen] = useState(false)
  const live = orders.filter((o) => o.status !== 'cancelled')
  const groups: Record<string, BoardOrder[]> = {
    new: live.filter((o) => o.status === 'pending'),
    preparing: live.filter((o) => ['preparing', 'confirmed'].includes(o.status)),
    ready: live.filter((o) => o.status === 'ready'),
    delivered: live.filter((o) => o.status === 'delivered'),
  }
  const [tab, setTab] = useState<'new' | 'preparing' | 'ready' | 'delivered'>(groups.new.length ? 'new' : 'preparing')
  const list = groups[tab] ?? []

  const accept = async (o: DOrder) => {
    try {
      await api.post('orders', 'accept', { orderId: o.id, prepMinutes: 20 })
      toast(`#${o.order_number} accepted · ready in 20 min`)
      window.dispatchEvent(new Event('fk-orders-changed'))
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not accept')
    }
  }

  const decline = (o: DOrder) => act.setModal(
    <div className="modal" onClick={(e) => { if (e.target === e.currentTarget) act.close() }}>
      <div className="mcard">
        <h3>Decline #{o.order_number}</h3>
        <div className="rlist">
          {['Item unavailable', 'Kitchen full', 'Outside delivery area', 'Closing soon'].map((r) => (
            <button key={r} onClick={async () => {
              act.close()
              try {
                await api.post('orders', 'decline', { orderId: o.id, reason: r })
                toast(`#${o.order_number} declined · ${r}`)
                window.dispatchEvent(new Event('fk-orders-changed'))
              } catch (e) {
                toast(e instanceof Error ? e.message : 'Could not decline')
              }
            }}>{r}</button>
          ))}
        </div>
        <button className="btn ghost" onClick={act.close}>Cancel</button>
      </div>
    </div>,
  )

  const currentRangeLabel = RANGE_LABELS[range] ?? 'Today'

  return (
    <section>
      {/* Date filter dropdown */}
      <div className="mofilter-row">
        <span className="mofilter-label">Order summary</span>
        <div className="mofilter-wrap">
          <button className="mofilter-btn" onClick={() => setFilterOpen((v) => !v)} aria-expanded={filterOpen}>
            {currentRangeLabel}
            <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ transition: 'transform .15s', transform: filterOpen ? 'rotate(180deg)' : 'none' }}>
              <path d="M2.5 4.5L6 8L9.5 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {filterOpen && (
            <div className="mofilter-drop">
              {(Object.keys(RANGE_LABELS) as Range[]).map((k) => (
                <button
                  key={k}
                  className={`mofilter-opt${range === k ? ' active' : ''}`}
                  onClick={() => {
                    setRange(k)
                    setFilterOpen(false)
                  }}
                >
                  <span>{RANGE_LABELS[k]}</span>
                  {range === k && <span style={{ fontWeight: 800 }}>✓</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Top 2 stats */}
      <div className="movrow">
        <div className="mostat rev">
          <span>Revenue</span>
          <b>{rs(revenue)}</b>
        </div>
        <div className="mostat">
          <span>Total orders</span>
          <b>{live.reduce((count, o) => count + (o.rounds?.length ?? 1), 0)}</b>
        </div>
      </div>

      {/* Rasoi-style 2x2 Status Filter Grid */}
      <div className="mstatus-grid" role="group" aria-label="Filter orders by status">
        {([
          { key: 'new' as const, label: 'New orders', hint: 'Needs action', count: groups.new.length, urgent: groups.new.length > 0 },
          { key: 'preparing' as const, label: 'In kitchen', hint: 'Being prepared', count: groups.preparing.length, urgent: false },
          { key: 'ready' as const, label: 'Ready / out', hint: 'Ready for next step', count: groups.ready.length, urgent: false },
          { key: 'delivered' as const, label: 'Completed', hint: 'Served or fulfilled', count: groups.delivered.length, urgent: false },
        ]).map((g) => (
          <button
            key={g.key}
            type="button"
            className={`mstatus-filter sts-${g.key}${tab === g.key ? ' selected' : ''}${g.urgent && tab !== g.key ? ' urgent' : ''}`}
            aria-pressed={tab === g.key}
            onClick={() => setTab(g.key)}
          >
            <span className="mstatus-filter-label">{g.label}</span>
            <strong className="mstatus-filter-count">{g.count}</strong>
            <span className="mstatus-filter-hint">{g.hint}</span>
          </button>
        ))}
      </div>

      {/* Tables live on their own page on phones */}
      {floor.data && floor.data.tables.length > 0 && (
        <button type="button" className="tbllink" onClick={() => go('tables')}>
          <span>🍽️ Tables</span>
          <small>{floor.data.sessions.length} of {floor.data.tables.length} occupied</small>
          <span aria-hidden>›</span>
        </button>
      )}

      {/* List of cards */}
      <div className="molist">
        {list.length ? list.map((o) => {
          if (o.rounds) return <TableOrderCard key={o.table_session_id} order={o} act={act} mobile onOpen={() => openTable(o)} />
          const rider = riders.find((r) => r.id === o.rider_id)
          const paidUp = o.cash_collected
          const stageKey = o.status === 'delivered' ? 'delivered' : o.status === 'ready' ? 'ready' : o.status === 'pending' ? 'new' : 'preparing'

          return (
            <div key={o.id} className={`mocard sts-${stageKey} source-${o.source}`}>
              <div className="morow">
                <b>#{o.order_number}</b>
                <span>{ist(o.created_at)} · <Age o={o} /></span>
              </div>

              <MobileOrderProgress order={o} />

              <div className="mosub">
                {o.order_type === 'dine-in' ? `Table ${o.table_number ?? '?'}` : customerName(o)}
                {o.customer?.phone ? ` · ${phoneShort(o.customer.phone)}` : ''}
              </div>

              {o.delivery_address && (
                <div className="mosub" style={{ color: 'var(--muted)', fontSize: 12, fontWeight: 500 }}>
                  📍 {o.delivery_address}{o.delivery_pincode ? ` — ${o.delivery_pincode}` : ''}
                </div>
              )}

              <div className="motags">
                <span className={`tag ${o.order_type === 'delivery' ? 'dl' : o.order_type === 'dine-in' ? 'din' : 'tk'}`}>
                  {o.order_type === 'delivery' ? '🚚 Delivery' : o.order_type === 'dine-in' ? `🍽️ Dine-in · Table ${o.table_number ?? '?'}` : '🛍️ Takeaway'}
                </span>
                <span className={`tag src src-${o.source}`}>
                  {o.source === 'whatsapp' ? '💬 WhatsApp' : o.source === 'pos' ? '🛒 POS' : '🌐 Web'}
                </span>
                {o.amendment_count > 0 && <span className="tag am">Amended ×{o.amendment_count}</span>}
                {o.discount_paise > 0 && <span className="tag disc">Disc {rs(o.discount_paise)}</span>}
                {rider && <span className="tag dl">🛵 {rider.name}</span>}
              </div>

              <div className="moitems">
                {o.items.map((l) => (
                  <div key={l.id} className="moli">
                    <span>{l.quantity} × {l.name_snapshot}</span>
                    <span className="moprice">{rs(l.unit_price_paise * l.quantity)}</span>
                  </div>
                ))}
                {o.items.filter((l) => l.notes).map((l) => (
                  <div key={`note-${l.id}`} className="linote" style={{ marginTop: 4 }}>
                    📝 {l.name_snapshot}: {l.notes}
                  </div>
                ))}
              </div>

              {o.special_instructions && (
                <div className="ordnote" style={{ marginBottom: 8 }}>
                  📝 ORDER NOTE: {o.special_instructions}
                </div>
              )}

              {o.order_type !== 'dine-in' && ['ready', 'delivered'].includes(o.status) && !paidUp && (
                <div className="money due" style={{ marginBottom: 8 }}>
                  💵 Collect {rs(o.total_paise)} {o.order_type === 'delivery' ? 'on delivery' : 'at counter'}
                </div>
              )}
              {paidUp && (
                <div className="money" style={{ marginBottom: 8 }}>
                  ✓ {rs(o.cash_amount_paise ?? o.total_paise)} collected
                </div>
              )}
              {o.cancel_reason && (
                <div className="money bad" style={{ marginBottom: 8 }}>
                  ✕ {o.cancel_reason}
                </div>
              )}

              <div className="moamt">
                <span>Total {rs(o.total_paise)}</span>
                <span style={{ fontSize: 12, color: 'var(--muted)', textTransform: 'capitalize', fontWeight: 600 }}>
                  {statusLabel(o)}
                </span>
              </div>

              <div className="moacts">
                {o.status === 'pending' && (
                  <>
                    <button className="mobtn go" onClick={() => void accept(o)}>Accept</button>
                    <button className="mobtn bad" onClick={() => decline(o)}>Reject</button>
                  </>
                )}
                {['preparing', 'confirmed'].includes(o.status) && (
                  o.order_type === 'dine-in' ? (
                    <button className="mobtn go" onClick={() => void act.setStatus(o, 'ready')}>✓ Mark served</button>
                  ) : (
                    <button
                      className="mobtn go"
                      onClick={() => o.order_type === 'delivery' && !o.rider_id ? act.assignRider(o, () => void act.setStatus(o, 'ready')) : void act.setStatus(o, 'ready')}
                    >
                      Ready / dispatch
                    </button>
                  )
                )}
                {o.status === 'ready' && (
                  <>
                    <button className="mobtn go" onClick={() => void act.markDone(o)}>
                      {o.table_session_id ? 'Close table & mark done' : 'Mark delivered'}
                    </button>
                    {!paidUp && (
                      <button className="mobtn cash" onClick={() => void act.cash(o)}>
                        💵 Collect {rs(o.total_paise)}
                      </button>
                    )}
                  </>
                )}
                {canEdit(o) && <button className="mobtn" onClick={() => act.edit(o)}>Edit</button>}
                <button className="mobtn" onClick={() => act.print(o)}>Print</button>
                <button className="mobtn" onClick={() => act.printKOT(o)}>KOT</button>
                {!['delivered', 'cancelled'].includes(o.status) && (
                  <button className="mobtn bad" onClick={() => act.cancel(o)}>Cancel</button>
                )}
              </div>
            </div>
          )
        }) : <div className="none">No orders in this status</div>}
      </div>
    </section>
  )
}
