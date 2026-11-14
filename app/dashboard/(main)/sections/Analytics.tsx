'use client'

import { useState } from 'react'
import type { DCustomer, DOrder } from '@/lib/dashboard/types'
import { dayKeyIST, downloadCsv, Empty, esc, inBounds, ist, Loading, Modal, phoneShort, printHtml, RangeChips, rangeBounds, rs, todayIST, typeLabel, useDash, useIsMobile, useLoad, type Range } from '../kit'

const TYPES: Array<[string, string, string]> = [['dine-in', 'Dine-in', '#5b3fbf'], ['delivery', 'Delivery', '#ec1c23'], ['pickup', 'Takeaway', '#f5a623']]
const SOURCES: Array<[string, string, string]> = [['pos', 'Counter (POS)', '#1c1414'], ['web', 'Menu link', '#ec1c23'], ['whatsapp', 'WhatsApp chat', '#f5a623']]

export default function Analytics() {
  const { api, riders } = useDash()
  const [range, setRange] = useState<Range>('week')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [modal, setModal] = useState<React.ReactNode>(null)
  const mobile = useIsMobile()
  const { data, error, reload } = useLoad(async () => {
    const [o, c] = await Promise.all([api.get<{ orders: DOrder[] }>('orders', { limit: 2000 }), api.get<{ customers: DCustomer[] }>('contacts')])
    return { orders: o.orders, customers: c.customers }
  }, [api])
  if (!data) return <Loading error={error} onRetry={reload} />

  const b = rangeBounds(range, custom.from, custom.to)
  const rows = data.orders.filter((o) => inBounds(o.created_at, b))
  const live = rows.filter((o) => o.status !== 'cancelled')
  const cancelled = rows.filter((o) => o.status === 'cancelled')
  const revenue = live.reduce((s, o) => s + o.total_paise, 0)
  const avg = live.length ? Math.round(revenue / live.length) : 0
  const days = new Set(live.map((o) => dayKeyIST(o.created_at))).size

  // Top items
  const agg = new Map<string, number>()
  for (const o of live) for (const l of o.items) agg.set(l.name_snapshot, (agg.get(l.name_snapshot) ?? 0) + l.quantity)
  const top = [...agg.entries()].sort((a, x) => x[1] - a[1]).slice(0, 8)

  // Sales by day
  const byDay = new Map<string, number>()
  for (const o of live) byDay.set(dayKeyIST(o.created_at), (byDay.get(dayKeyIST(o.created_at)) ?? 0) + o.total_paise)
  const dayKeys = [...byDay.keys()].sort().slice(-10)
  const maxDay = Math.max(1, ...dayKeys.map((k) => byDay.get(k)!))
  let trend: React.ReactNode = null
  if (dayKeys.length >= 2) {
    const last = byDay.get(dayKeys[dayKeys.length - 1])!, prev = byDay.get(dayKeys[dayKeys.length - 2])!
    if (prev) { const p = Math.round(((last - prev) / prev) * 100); trend = <div className={`trendbubble ${p >= 0 ? 'up' : 'down'}`}>{p >= 0 ? '▲' : '▼'} {Math.abs(p)}% vs prev day</div> }
  }

  // Heatmap (IST weekday × hour)
  const heat = Array.from({ length: 7 }, () => Array(24).fill(0) as number[])
  for (const o of live) { const d = new Date(new Date(o.created_at).getTime() + 19800000); heat[d.getUTCDay()][d.getUTCHours()]++ }
  const maxHeat = Math.max(1, ...heat.flat())

  // Customers: new vs returning (a customer with more than one order overall is "repeat")
  const custByPhone = new Map(data.customers.map((c) => [c.phone, c]))
  const isRepeat = (o: DOrder) => (custByPhone.get(o.customer?.phone ?? '')?.total_orders ?? 0) > 1
  const phones = new Set(live.map((o) => o.customer?.phone).filter(Boolean))
  const repeatCust = [...phones].filter((p) => (custByPhone.get(p!)?.total_orders ?? 0) > 1).length
  const ordNew = live.filter((o) => !isRepeat(o)), ordRet = live.filter(isRepeat)
  const aov = (a: DOrder[]) => (a.length ? Math.round(a.reduce((s, o) => s + o.total_paise, 0) / a.length) : 0)

  // Loyalty (all time)
  const allLive = data.orders.filter((o) => o.status !== 'cancelled' && o.customer?.phone)
  const byPhone = new Map<string, DOrder[]>()
  for (const o of allLive) byPhone.set(o.customer!.phone, [...(byPhone.get(o.customer!.phone) ?? []), o])
  const gaps: number[] = []
  for (const list of byPhone.values()) { const t = list.map((o) => new Date(o.created_at).getTime()).sort((a, x) => a - x); for (let i = 1; i < t.length; i++) gaps.push((t[i] - t[i - 1]) / 86400000) }
  const avgGap = gaps.length ? Math.round((gaps.reduce((s, g) => s + g, 0) / gaps.length) * 10) / 10 : null
  const spenders = [...byPhone.entries()].map(([p, l]) => ({ phone: p, name: custByPhone.get(p)?.name ?? l[0].customer?.name ?? null, orders: l.length, amt: l.reduce((s, o) => s + o.total_paise, 0) })).sort((a, x) => x.amt - a.amt).slice(0, 8)

  const pie = (() => {
    const d = TYPES.map(([k, l, c]) => ({ l, c, n: live.filter((o) => o.order_type === k).length }))
    const tot = d.reduce((s, x) => s + x.n, 0)
    if (!tot) return <Empty icon="🍽️" text="No orders in this range" />
    let a0 = -Math.PI / 2
    const paths = d.filter((x) => x.n).map((x) => {
      const ang = (x.n / tot) * Math.PI * 2, a1 = a0 + ang, big = ang > Math.PI ? 1 : 0, ro = 100, ri = 62
      const p = x.n === tot
        ? <circle key={x.l} cx={110} cy={110} r={(ro + ri) / 2} fill="none" stroke={x.c} strokeWidth={ro - ri} />
        : <path key={x.l} fill={x.c} d={`M${110 + ro * Math.cos(a0)},${110 + ro * Math.sin(a0)} A${ro},${ro} 0 ${big},1 ${110 + ro * Math.cos(a1)},${110 + ro * Math.sin(a1)} L${110 + ri * Math.cos(a1)},${110 + ri * Math.sin(a1)} A${ri},${ri} 0 ${big},0 ${110 + ri * Math.cos(a0)},${110 + ri * Math.sin(a0)} Z`} />
      a0 = a1
      return p
    })
    return <div className="pie-wrap"><svg viewBox="0 0 220 220" width={170} height={170} role="img" aria-label="Order types">{paths}
      <text x={110} y={104} textAnchor="middle" fontSize={24} fontWeight={800} fill="#1c1414">{tot}</text><text x={110} y={124} textAnchor="middle" fontSize={10.5} fontWeight={700} fill="#6b6f78">ORDERS</text></svg>
      <div className="legend">{d.map((x) => <div key={x.l}><i style={{ background: x.c }} />{x.l}<b>{x.n}</b></div>)}</div></div>
  })()

  const hbars = (defs: Array<[string, string, string]>, key: 'source' | 'order_type', valueOf: (rows: DOrder[]) => number, fmt: (rows: DOrder[]) => string) => {
    const list = defs.map(([k, l, c]) => ({ l, c, rows: live.filter((o) => o[key] === k) })).filter((x) => x.rows.length)
    const max = Math.max(1, ...list.map((x) => valueOf(x.rows)))
    return list.length ? list.map((x) => <div className="hbar-row" key={x.l}><span className="hbar-label">{x.l}</span><div className="hbar-track"><div className="hbar-fill" style={{ width: `${Math.max(4, Math.round((valueOf(x.rows) / max) * 100))}%`, background: x.c }} /></div><span className="hbar-val">{fmt(x.rows)}</span></div>)
      : <Empty icon="🌐" text="No orders in this range" />
  }

  const DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']
  return (
    <section>
      <div className="filterrow" style={{ marginBottom: 0 }}><div style={{ flex: 1 }}><RangeChips range={range} setRange={setRange} custom from={custom.from} to={custom.to} setCustom={(from, to) => setCustom({ from, to })} /></div>
        <button className="btn sm ghost" style={{ marginBottom: 16 }} onClick={() => setModal(<ShiftClose orders={data.orders} onClose={() => setModal(null)} />)}>📋 Shift Close Report</button></div>
      <div className="ov-card"><h4>Overview</h4><div className="ov-pills">
        <div className="ovpill teal"><b>{rs(revenue)}</b><span>Revenue</span></div>
        <div className="ovpill blue"><b>{live.length}</b><span>Orders</span></div>
        <div className="ovpill orange"><b>{rs(avg)}</b><span>Avg Order</span></div>
      </div></div>
      <div className="agrid">
        <div className="anacard"><h4>Order Types</h4>{pie}</div>
        <div className="anacard"><h4>Most Ordered Items</h4>
          <table><thead><tr><th>Item</th><th>Times Ordered</th></tr></thead><tbody>
            {top.length ? top.map(([n, q]) => <tr key={n}><td><b>{n}</b></td><td><span className="countchip">{q}</span></td></tr>) : <tr><td colSpan={2}><div className="none">No orders in this range</div></td></tr>}
          </tbody></table></div>
        <div className="anacard"><h4>Sales by Day <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}><span className="daypill">{days} DAY{days === 1 ? '' : 'S'}</span>
          <button className="expbtn" onClick={() => downloadCsv(`friedking-orders-${range}.csv`, [['Order Number', 'Type', 'Source', 'Status', 'Total (₹)', 'Created At (IST)'], ...live.map((o) => [o.order_number, typeLabel(o.order_type), o.source, o.status, o.total_paise / 100, ist(o.created_at)])])}>Export</button></span></h4>
          {dayKeys.length ? <>{trend}<div className="bars">{dayKeys.map((k) => <div className="bcol" key={k} title={`${k} · ${rs(byDay.get(k))}`}><div className="bfill" style={{ height: `${Math.max(3, Math.round((byDay.get(k)! / maxDay) * 100))}%` }} /><span className="blbl">{new Date(`${k}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' })}</span></div>)}</div></> : <Empty icon="📈" text="No orders in this range" />}
        </div>
      </div>
      <div className="anacard"><h4>Hourly Order Heatmap</h4><p className="asub">Orders placed by hour of day (IST), this range</p>
        {live.length ? <><div className="heatwrap"><div className="heat"><div className="hd" />{Array.from({ length: 24 }, (_, h) => <div key={h} className="hh">{h}</div>)}
          {DAYS.map((dn, wd) => [<div key={dn} className="hd">{dn}</div>, ...heat[wd].map((n, h) => { const op = n ? Math.max(0.16, n / maxHeat) : 0; return <div key={`${dn}${h}`} className="heatcell" title={`${dn} ${h}:00 · ${n} order${n === 1 ? '' : 's'}`} style={{ background: n ? `rgba(236,28,35,${op.toFixed(2)})` : '#f0eeee', color: op > 0.45 ? '#fff' : '#9a2530' }}>{n || ''}</div> })])}
        </div></div><div className="heatlegend"><span>Fewer</span>{[0, 0.25, 0.5, 0.75, 1].map((x) => <i key={x} style={{ background: x ? `rgba(236,28,35,${x})` : '#f0eeee' }} />)}<span>More</span></div></> : <Empty icon="🔥" text="No orders in this range" />}
      </div>
      <div className="anacard"><h4>Cancelled Orders <span className="countpill">{cancelled.length} Cancelled</span></h4>
        {mobile ? (cancelled.length ? cancelled.slice(0, 30).map((o) => <div className="arow" key={o.id}><div className="at"><b>#{o.order_number}</b><span>{rs(o.total_paise)}</span></div><div className="as">{o.items.map((l) => `${l.quantity}× ${l.name_snapshot}`).join(', ')}</div><div className="as">{o.cancel_reason || 'No reason provided'} · {o.cancelled_by || 'Staff'}</div></div>) : <div className="none">No cancelled orders in this period</div>)
          : <div className="tblwrap"><table><thead><tr><th>Order</th><th>Items</th><th>Total</th><th>Reason</th><th>By</th></tr></thead><tbody>
            {cancelled.length ? cancelled.slice(0, 30).map((o) => <tr key={o.id}><td><b>#{o.order_number}</b></td><td style={{ maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{o.items.map((l) => `${l.quantity}× ${l.name_snapshot}`).join(', ')}</td><td>{rs(o.total_paise)}</td><td>{o.cancel_reason || 'No reason provided'}</td><td>{o.cancelled_by || 'Staff'}</td></tr>)
              : <tr><td colSpan={5}><div className="none">No cancelled orders in this period</div></td></tr>}
          </tbody></table></div>}
      </div>
      <div className="anacard"><h4>Where Orders Came From</h4>{hbars(SOURCES, 'source', (r) => r.reduce((s, o) => s + o.total_paise, 0), (r) => `${rs(r.reduce((s, o) => s + o.total_paise, 0))} · ${r.length}`)}</div>
      <div className="anacard"><h4>Customers · New vs. Returning</h4><p className="asub">Based on the filter above</p>
        {phones.size ? <>
          <div className="ov-pills" style={{ marginBottom: 16 }}>
            <div className="ovpill teal"><b>{phones.size}</b><span>Customers</span></div>
            <div className="ovpill blue"><b>{repeatCust}</b><span>Repeat Customers</span></div>
            <div className="ovpill orange"><b>{Math.round((repeatCust / phones.size) * 100)}%</b><span>Repeat Rate</span></div>
          </div>
          <div className="stats">
            <div className="stat"><span>New customer orders</span><b>{ordNew.length}</b></div><div className="stat"><span>Avg order · new</span><b>{rs(aov(ordNew))}</b></div>
            <div className="stat"><span>Returning orders</span><b>{ordRet.length}</b></div><div className="stat"><span>Avg order · returning</span><b>{rs(aov(ordRet))}</b></div>
          </div>
          <p className="asub" style={{ margin: '0 0 8px' }}>Returning-customer share by channel, this range</p>
          {hbars(SOURCES, 'source', (r) => r.length, (r) => `${r.filter(isRepeat).length}/${r.length} repeat`)}
        </> : <Empty icon="👥" text="No customers in this range" />}
      </div>
      <div className="anacard"><h4>Customer Loyalty</h4><p className="asub">All time, not limited by the filter above</p>
        <div className="stats"><div className="stat"><span>Avg days between visits</span><b>{avgGap ?? '—'}</b></div><div className="stat"><span>Repeat customers tracked</span><b>{[...byPhone.values()].filter((l) => l.length > 1).length}</b></div></div>
        <div className="tblwrap"><table><thead><tr><th>Customer</th><th>Number</th><th>Orders</th><th>Total spend</th></tr></thead><tbody>
          {spenders.length ? spenders.map((t) => <tr key={t.phone}><td><b>{t.name || '—'}</b></td><td>{phoneShort(t.phone)}</td><td>{t.orders}</td><td>{rs(t.amt)}</td></tr>) : <tr><td colSpan={4}><div className="none">Not enough data yet</div></td></tr>}
        </tbody></table></div>
      </div>
      <div className="anacard"><h4>Riders</h4>
        <div className="tblwrap"><table><thead><tr><th>Rider</th><th>Deliveries</th><th>Cash collected</th><th>Pending</th></tr></thead><tbody>
          {riders.length ? riders.map((r) => { const rr = rows.filter((o) => o.rider_id === r.id); const cash = rr.filter((o) => o.cash_collected).reduce((s, o) => s + (o.cash_amount_paise ?? o.total_paise), 0); const pend = rr.filter((o) => !o.cash_collected && o.status !== 'cancelled').reduce((s, o) => s + o.total_paise, 0)
            return <tr key={r.id}><td><b>{r.name}</b></td><td>{rr.length}</td><td>{rs(cash)}</td><td>{pend ? <b style={{ color: 'var(--red)' }}>{rs(pend)}</b> : '—'}</td></tr> })
            : <tr><td colSpan={4}><div className="none">No riders added yet</div></td></tr>}
        </tbody></table></div>
      </div>
      {modal}
    </section>
  )
}

function ShiftClose({ orders, onClose }: { orders: DOrder[]; onClose: () => void }) {
  const { branch } = useDash()
  const [day, setDay] = useState(todayIST())
  const go = () => {
    const rows = orders.filter((o) => dayKeyIST(o.created_at) === day)
    const live = rows.filter((o) => o.status !== 'cancelled')
    const revenue = live.reduce((s, o) => s + o.total_paise, 0)
    const staff = new Set(live.flatMap((o) => [o.taken_by, o.accepted_by].filter((x): x is string => !!x)))
    const agg = new Map<string, number>()
    for (const o of live) for (const l of o.items) agg.set(l.name_snapshot, (agg.get(l.name_snapshot) ?? 0) + l.quantity)
    const top = [...agg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10)
    const label = new Date(`${day}T00:00:00+05:30`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', weekday: 'long', timeZone: 'Asia/Kolkata' })
    printHtml(`Shift Close ${day}`, `<h2>FRIED KING</h2><div class="c">${esc(branch.name)}<br>Shift Close / End-of-Day Report</div><div class="c">${esc(label)}</div><hr>
      <div class="r t"><span>Revenue</span><span>${rs(revenue)}</span></div><div class="r"><span>Orders</span><span>${live.length}</span></div>
      <div class="r"><span>Avg Order</span><span>${rs(live.length ? revenue / live.length : 0)}</span></div><div class="r"><span>Cancelled / Declined</span><span>${rows.length - live.length}</span></div>
      <hr><b>By Channel</b><table><tr><th>Channel</th><th>Orders</th><th>Revenue</th></tr>${TYPES.map(([k, l]) => { const r = live.filter((o) => o.order_type === k); return `<tr><td>${l}</td><td>${r.length}</td><td>${rs(r.reduce((s, o) => s + o.total_paise, 0))}</td></tr>` }).join('')}</table>
      <hr><b>Cash</b><div class="r"><span>Collected</span><span>${rs(live.filter((o) => o.cash_collected).reduce((s, o) => s + (o.cash_amount_paise ?? o.total_paise), 0))}</span></div>
      <div class="r"><span>Pending</span><span>${rs(live.filter((o) => !o.cash_collected).reduce((s, o) => s + o.total_paise, 0))}</span></div>
      <hr><b>Staff on duty</b><div>${staff.size ? [...staff].map(esc).join(', ') : '—'}</div>
      <hr><b>Top items</b><table><tr><th>Item</th><th>Qty</th></tr>${top.length ? top.map(([n, q]) => `<tr><td>${esc(n)}</td><td>${q}</td></tr>`).join('') : '<tr><td colspan="2">No orders</td></tr>'}</table>
      <hr><div class="c">Generated ${ist(Date.now())}</div>`)
    onClose()
  }
  return <Modal onClose={onClose}><h3>Shift Close / End-of-Day Report</h3>
    <label className="lbl">Date</label><input className="f2" type="date" value={day} max={todayIST()} onChange={(e) => setDay(e.target.value)} />
    <div className="mrow"><button onClick={onClose}>Cancel</button><button className="go" onClick={go}>Generate &amp; Print</button></div>
  </Modal>
}
