'use client'

import { useState } from 'react'
import type { DExpense, DOrder } from '@/lib/dashboard/types'
import { compareLabel, downloadCsv, inBounds, ist, Loading, Modal, pct, previousBounds, RangeChips, rangeBounds, rs, todayIST, useDash, useLoad, type Range } from '../kit'
import type { MenuData } from './Menu'
import { dishMargins } from './Stock'

const COLORS = ['#ec1c23', '#1c1414', '#f5a623', '#1f8a4c', '#8a6300', '#5b3fbf', '#17c3b2', '#c0392b']
type B = { start: number; end: number }

export default function Pnl() {
  const { api, toast } = useDash()
  const [range, setRange] = useState<Range>('month')
  const [custom, setCustom] = useState({ from: '', to: '' })
  const [modal, setModal] = useState<React.ReactNode>(null)
  const b = rangeBounds(range, custom.from, custom.to)
  const pb = previousBounds(range)
  const { data, error, reload } = useLoad(async () => {
    const since = range === 'all' ? null : new Date((pb ?? b).start).toISOString()
    const [o, m, e] = await Promise.all([
      api.get<{ orders: DOrder[] }>('orders', { since, limit: 2000 }),
      api.get<MenuData>('menu'),
      api.get<{ expenses: DExpense[] }>('expenses'),
    ])
    return { orders: o.orders, menu: m, expenses: e.expenses }
  }, [api, range, custom.from, custom.to])
  if (!data) return <Loading error={error} onRetry={reload} />

  const margins = dishMargins(data.menu)
  const costById = new Map<string, number>(), costByName = new Map<string, number>()
  for (const x of margins) if (x.cost != null) { costById.set(x.item.id, x.cost); costByName.set(x.item.name.trim().toLowerCase(), x.cost) }

  const summary = (bb: B) => {
    const ord = data.orders.filter((o) => o.status !== 'cancelled' && inBounds(o.created_at, bb))
    const revenue = ord.reduce((s, o) => s + o.total_paise, 0)
    let cogs = 0, matched = 0, excluded = 0
    for (const o of ord) for (const l of o.items) {
      const c = (l.menu_item_id ? costById.get(l.menu_item_id) : undefined) ?? costByName.get(l.name_snapshot.trim().toLowerCase())
      if (c != null) { cogs += c * l.quantity; matched += l.quantity } else excluded += l.quantity
    }
    const exp = data.expenses.filter((e) => inBounds(`${e.expense_date}T12:00:00+05:30`, bb))
    const expenses = exp.reduce((s, e) => s + e.amount_paise, 0)
    return { revenue, cogs, matched, excluded, expenses, gross: revenue - cogs, net: revenue - cogs - expenses, exp }
  }
  const cur = summary(b)
  const prev = pb ? summary(pb) : null
  const margin = cur.revenue > 0 ? (cur.net / cur.revenue) * 100 : 0

  const delta = (c: number, p: number | undefined, invert = false) => {
    if (p == null || (p === 0 && c === 0)) return null
    const label = compareLabel(range)
    if (p === 0) { const up = c > 0, good = invert ? !up : up; return <span className={`pnldelta ${good ? 'pos' : 'neg'}`}>{up ? '▲' : '▼'} {rs(Math.abs(c))} · no data for {label}</span> }
    const d = c - p
    if (d === 0) return <span className="pnldelta">No change vs {label}</span>
    const up = d > 0, good = invert ? !up : up
    return <span className={`pnldelta ${good ? 'pos' : 'neg'}`}>{up ? '▲' : '▼'} {rs(Math.abs(d))} vs {label}</span>
  }

  // Trend buckets: daily up to 45 days, weekly up to 200, else monthly (max 40).
  let start = b.start
  if (start <= 0) start = Math.min(...data.orders.map((o) => new Date(o.created_at).getTime()), b.end - 90 * 86400000)
  const span = Math.max(1, Math.round((b.end - start) / 86400000))
  const step = span <= 45 ? 1 : span <= 200 ? 7 : 30
  const buckets: Array<{ label: string; revenue: number; net: number }> = []
  for (let t = start; t < b.end && span >= 2; t += step * 86400000) {
    const s = summary({ start: t, end: Math.min(t + step * 86400000, b.end) })
    buckets.push({ label: new Date(t).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', timeZone: 'Asia/Kolkata' }), revenue: s.revenue, net: s.net })
  }
  const trend = buckets.slice(-40)

  const byCat = new Map<string, number>()
  for (const e of cur.exp) byCat.set(e.category, (byCat.get(e.category) ?? 0) + e.amount_paise)
  const cats = [...byCat.entries()].sort((a, x) => x[1] - a[1])
  const covPct = cur.matched + cur.excluded > 0 ? Math.round((cur.matched / (cur.matched + cur.excluded)) * 100) : 0
  const close = () => setModal(null)

  return (
    <section>
      <div className="mhead">
        <div><h2>Profit &amp; Loss</h2><p>Revenue minus ingredient cost minus operating expenses, for the period below.</p></div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn sm ghost" onClick={() => downloadCsv(`friedking-pnl-${range}.csv`, [['Line', 'Amount (₹)'], ['Revenue', cur.revenue / 100], ['COGS (ingredient cost)', -cur.cogs / 100], ['Gross Profit', cur.gross / 100], ...cats.map(([c, a]) => [`Expense: ${c}`, -a / 100]), ['Total Expenses', -cur.expenses / 100], ['Net Profit', cur.net / 100]])}>⬇ Export CSV</button>
          <button className="btn sm" onClick={() => setModal(<AddExpense cats={[...new Set(['Rent & Utilities', 'Salaries & wages', 'Packaging & delivery', 'Marketing & equipment', ...data.expenses.map((e) => e.category)])]} onClose={close} onSaved={() => { close(); toast('Expense added'); void reload() }} />)}>+ Add Expense</button>
        </div>
      </div>
      <div className="stats">
        <div className="stat b"><span>Revenue</span><b>{rs(cur.revenue)}</b></div>
        <div className="stat p"><span>Gross Profit</span><b>{rs(cur.gross)}</b></div>
        <div className="stat g"><span>Net Margin</span><b>{pct(margin)}</b></div>
        <div className={`stat ${cur.net >= 0 ? 'g' : 'r'}`}><span>{cur.net >= 0 ? 'Net Profit' : 'Net Loss'}</span><b>{rs(Math.abs(cur.net))}</b></div>
      </div>
      <RangeChips range={range} setRange={setRange} custom from={custom.from} to={custom.to} setCustom={(from, to) => setCustom({ from, to })} />
      {trend.length >= 2 && <div className="ov-card"><h4>Revenue vs. Net Profit</h4>
        <div className="pnllegend"><span><i style={{ background: '#ec1c23' }} />Revenue</span><span><i style={{ background: '#1f8a4c' }} />Net Profit</span></div>
        <TrendSvg buckets={trend} /></div>}
      <div className="ov-card">
        <h4>Profit &amp; Loss Statement</h4>
        {cur.excluded > 0 && <details className="pnlwarn"><summary>⚠ {covPct}% recipe coverage: costs understated</summary>
          <p>Only {covPct}% of items sold this period ({cur.matched} of {cur.matched + cur.excluded}) have a recipe cost. The other {cur.excluded} count as ₹0 in COGS, so Gross and Net Profit read <b>higher than they really are</b> until more recipes are built (Stock → Reports → Recipe Coverage).</p></details>}
        <p className="asub" style={{ margin: '0 0 6px' }}>Where the money went</p>
        <Waterfall revenue={cur.revenue} cogs={cur.cogs} expenses={cur.expenses} net={cur.net} />
        <div className="pnlrow"><div className="pnlrow-label">Revenue</div><div className="pnlrow-right"><div className="pnlrow-val">{rs(cur.revenue)}</div>{delta(cur.revenue, prev?.revenue)}</div></div>
        <div className="pnlrow sub"><div className="pnlrow-label">− Cost of Goods Sold{cur.excluded > 0 && <span className="pnlflag">partial</span>}</div><div className="pnlrow-right"><div className="pnlrow-val">{rs(cur.cogs)}</div>{delta(cur.cogs, prev?.cogs, true)}</div></div>
        <div className="pnlrow total"><div className="pnlrow-label">Gross Profit</div><div className="pnlrow-right"><div className="pnlrow-val">{rs(cur.gross)}<span className="pnlmargin">{cur.revenue > 0 ? `${pct((cur.gross / cur.revenue) * 100)} margin` : ''}</span></div>{delta(cur.gross, prev?.gross)}</div></div>
        <div className="pnlrow sub"><div className="pnlrow-label">− Operating Expenses</div><div className="pnlrow-right"><div className="pnlrow-val">{rs(cur.expenses)}</div>{delta(cur.expenses, prev?.expenses, true)}</div></div>
        <div className={`pnlrow final ${cur.net >= 0 ? 'profit' : 'loss'}`}><div className="pnlrow-label">{cur.net >= 0 ? 'NET PROFIT' : 'NET LOSS'}</div><div className="pnlrow-right"><div className="pnlrow-val">{cur.net < 0 ? '−' : ''}{rs(Math.abs(cur.net))}</div>{delta(cur.net, prev?.net)}</div></div>
      </div>
      <div className="anacard"><h4>Expenses by category</h4>
        {cats.length ? <div className="pie-wrap"><Donut rows={cats} total={cur.expenses} />
          <div style={{ flex: 1, minWidth: 0 }} className="tblwrap"><table><thead><tr><th></th><th>Category</th><th>Amount</th><th>% of expenses</th></tr></thead><tbody>
            {cats.map(([c, a], i) => <tr key={c}><td><span className="pnldot" style={{ background: COLORS[i % COLORS.length] }} /></td><td><b>{c}</b></td><td>{rs(a)}</td><td>{cur.expenses ? `${Math.round((a / cur.expenses) * 100)}%` : '—'}</td></tr>)}
          </tbody></table></div></div> : <div className="none">No expenses logged in this period</div>}
      </div>
      <div className="anacard"><h4>Expense ledger</h4>
        {cur.exp.length ? <div className="ledger">{cur.exp.map((e) => <div key={e.id}><span>{ist(`${e.expense_date}T12:00:00+05:30`).slice(0, 6)} · {e.category}{e.note ? ` · ${e.note}` : ''} · {e.recorded_by}</span>
          <b>{rs(e.amount_paise)} <button className="icostbtn" title="Delete" onClick={() => setModal(<Modal onClose={close}><h3>Delete this expense?</h3><p>{e.category} · {rs(e.amount_paise)}</p><div className="mrow"><button onClick={close}>Cancel</button><button className="x" onClick={async () => { close(); await api.post('expenses', 'remove', { id: e.id }); toast('Expense deleted'); void reload() }}>Delete</button></div></Modal>)}>🗑️</button></b></div>)}</div>
          : <div className="none">No expenses logged in this period</div>}
      </div>
      {modal}
    </section>
  )
}

function AddExpense({ cats, onClose, onSaved }: { cats: string[]; onClose: () => void; onSaved: () => void }) {
  const { api, toast } = useDash()
  const [f, setF] = useState({ date: todayIST(), category: '', amount: '', note: '' })
  return <Modal onClose={onClose}><h3>Add Expense</h3>
    <label className="lbl">Date</label><input className="f2" type="date" value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} />
    <label className="lbl">Category *</label><input className="f2" list="fk-expcats" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} placeholder="e.g. Rent & Utilities" />
    <datalist id="fk-expcats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
    <label className="lbl">Amount, ₹ *</label><input className="f2" inputMode="decimal" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
    <label className="lbl">Note (optional)</label><input className="f2" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="e.g. October electricity bill" />
    <div style={{ fontSize: 11.5, color: 'var(--muted)', margin: '-4px 0 10px' }}>Don&apos;t log ingredient restocks here: those are already tracked through Stock → Restock.</div>
    <div className="mrow"><button onClick={onClose}>Cancel</button><button className="go" onClick={async () => {
      if (!f.date || !f.category.trim() || !(Number(f.amount) > 0)) { toast('Date, category and a valid amount are required'); return }
      try { await api.post('expenses', 'add', f); onSaved() } catch (e) { toast(e instanceof Error ? e.message : 'Could not save') }
    }}>Save</button></div>
  </Modal>
}

function TrendSvg({ buckets }: { buckets: Array<{ label: string; revenue: number; net: number }> }) {
  const W = 680, H = 180, pl = 8, pr = 8, pt = 16, pb = 20, iw = W - pl - pr, ih = H - pt - pb
  const max = Math.max(1, ...buckets.map((x) => Math.max(x.revenue, x.net, 0)))
  const min = Math.min(0, ...buckets.map((x) => x.net))
  const rng = max - min || 1
  const x = (i: number) => pl + (i / (buckets.length - 1)) * iw
  const y = (v: number) => pt + ih - ((v - min) / rng) * ih
  const path = (k: 'revenue' | 'net') => buckets.map((bk, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(bk[k]).toFixed(1)}`).join(' ')
  const nth = Math.max(1, Math.ceil(buckets.length / 6)), last = buckets.length - 1
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 180 }} role="img" aria-label="Revenue and net profit trend">
      <line x1={pl} y1={y(0)} x2={W - pr} y2={y(0)} stroke="var(--line)" />
      <path d={path('revenue')} fill="none" stroke="#ec1c23" strokeWidth={2.2} />
      <path d={path('net')} fill="none" stroke="#1f8a4c" strokeWidth={2.2} />
      <circle cx={x(last)} cy={y(buckets[last].revenue)} r={3.2} fill="#ec1c23" />
      <circle cx={x(last)} cy={y(buckets[last].net)} r={3.2} fill="#1f8a4c" />
      {buckets.map((bk, i) => (i % nth === 0 || i === last) && <text key={i} x={x(i)} y={H - 5} fontSize={9} fill="var(--muted)" textAnchor="middle">{bk.label}</text>)}
    </svg>
  )
}

function Waterfall({ revenue, cogs, expenses, net }: { revenue: number; cogs: number; expenses: number; net: number }) {
  let run = 0
  const bars = ([['Revenue', revenue, '#2f2323'], ['COGS', -cogs, '#ec1c23'], ['Expenses', -expenses, '#f5a623']] as Array<[string, number, string]>).map(([l, d, c]) => {
    const s = run, e = run + d; run = e
    return { l, lo: Math.min(s, e), hi: Math.max(s, e), d, c }
  })
  bars.push({ l: net >= 0 ? 'Net Profit' : 'Net Loss', lo: Math.min(0, net), hi: Math.max(0, net), d: net, c: net >= 0 ? '#1f8a4c' : '#c0392b' })
  const max = Math.max(1, revenue, ...bars.map((x) => x.hi)), W = 680, H = 150, pt = 22, pb = 24, gap = W / bars.length, bw = gap * 0.55
  const sy = (v: number) => pt + (H - pt - pb) * (1 - v / max)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 150 }} role="img" aria-label="Where the money went">
      {bars.map((x, i) => {
        const cx = gap * i + gap / 2, y0 = sy(x.hi), h = Math.max(2, sy(x.lo) - y0)
        return <g key={x.l}><rect x={cx - bw / 2} y={y0} width={bw} height={h} rx={5} fill={x.c} />
          <text x={cx} y={y0 - 6} fontSize={10.5} fontWeight={800} textAnchor="middle" fill="var(--ink)">{x.d < 0 ? '−' : ''}{rs(Math.abs(x.d))}</text>
          <text x={cx} y={H - 8} fontSize={9.5} fontWeight={700} textAnchor="middle" fill="var(--muted)">{x.l}</text></g>
      })}
    </svg>
  )
}

function Donut({ rows, total }: { rows: Array<[string, number]>; total: number }) {
  const R = 46, C = 2 * Math.PI * R
  let off = 0
  return (
    <svg viewBox="0 0 120 120" style={{ width: 120, height: 120, flex: 'none' }} role="img" aria-label="Expenses by category">
      {rows.map(([c, a], i) => { const len = total ? (a / total) * C : 0; const el = <circle key={c} cx={60} cy={60} r={R} fill="none" stroke={COLORS[i % COLORS.length]} strokeWidth={16} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-off} transform="rotate(-90 60 60)" />; off += len; return el })}
      <circle cx={60} cy={60} r={30} fill="#fff" />
    </svg>
  )
}
