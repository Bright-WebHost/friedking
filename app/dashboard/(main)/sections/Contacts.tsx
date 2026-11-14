'use client'

import { useState } from 'react'
import type { DCustomer } from '@/lib/dashboard/types'
import { dayKeyIST, Loading, phoneShort, useDash, useLoad } from '../kit'

type Seg = 'all' | 'recent30' | 'inactive1' | 'inactive2' | 'repeat' | 'onetime' | 'optout'
type Sort = 'last_desc' | 'last_asc' | 'orders_desc' | 'orders_asc' | 'name_asc' | 'name_desc'
const days = (c: DCustomer) => (c.last_order_at ? Math.floor((Date.now() - new Date(c.last_order_at).getTime()) / 86400000) : null)
const inSeg = (c: DCustomer, s: Seg) => {
  const d = days(c)
  switch (s) {
    case 'recent30': return d != null && d <= 30
    case 'inactive1': return d != null && d >= 30 && d < 60
    case 'inactive2': return d != null && d >= 60
    case 'repeat': return c.total_orders > 1
    case 'onetime': return c.total_orders === 1
    case 'optout': return c.opted_out
    default: return true
  }
}

export default function Contacts() {
  const { api, toast, go } = useDash()
  const { data, error, reload } = useLoad(() => api.get<{ customers: DCustomer[] }>('contacts'), [api])
  const [q, setQ] = useState('')
  const [seg, setSeg] = useState<Seg>('all')
  const [sort, setSort] = useState<Sort>('last_desc')
  const [pick, setPick] = useState<Set<string>>(new Set())
  const [paste, setPaste] = useState('')
  const [drag, setDrag] = useState(false)
  const [imported, setImported] = useState<number | null>(null)
  if (!data) return <Loading error={error} onRetry={reload} />

  const query = q.trim().toLowerCase()
  let rows = data.customers.filter((c) => (!query || c.phone.includes(query) || (c.name ?? '').toLowerCase().includes(query)) && inSeg(c, seg))
  rows = [...rows].sort((a, b) => {
    switch (sort) {
      case 'last_asc': return (a.last_order_at ?? '').localeCompare(b.last_order_at ?? '')
      case 'orders_desc': return b.total_orders - a.total_orders
      case 'orders_asc': return a.total_orders - b.total_orders
      case 'name_asc': return (a.name ?? '').localeCompare(b.name ?? '')
      case 'name_desc': return (b.name ?? '').localeCompare(a.name ?? '')
      default: return (b.last_order_at ?? '').localeCompare(a.last_order_at ?? '')
    }
  })
  const eligible = rows.filter((c) => !c.opted_out)

  const doImport = async (text: string) => {
    try {
      const r = await api.post<{ phones: string[] }>('contacts', 'import', { text })
      setImported(r.phones.length); setPaste('')
      setPick((p) => new Set([...p, ...r.phones]))
      toast(`${r.phones.length} numbers added and selected`)
      void reload()
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not import') }
  }
  const readFile = (f: File | undefined) => { if (f) void f.text().then(doImport) }

  return (
    <section>
      <div className="stats">
        <div className="stat"><span>Saved Contacts</span><b>{data.customers.length}</b></div>
        <div className="stat b"><span>Matching Filter</span><b>{rows.length}</b></div>
        <div className="stat r"><span>Selected</span><b>{pick.size}</b></div>
        <div className="stat o"><span>Opted Out</span><b>{data.customers.filter((c) => c.opted_out).length}</b></div>
      </div>
      <div className={`drop ${drag ? 'on' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); readFile(e.dataTransfer.files[0]) }}>
        <b style={{ color: 'var(--ink)' }}>Add numbers</b><br />Drop a CSV here, or paste numbers below (one per line, or comma separated)
        <div style={{ marginTop: 12 }}><label className="btn sm ghost" style={{ display: 'inline-block', cursor: 'pointer' }}>Choose CSV<input type="file" accept=".csv,.txt" hidden onChange={(e) => readFile(e.target.files?.[0])} /></label></div>
      </div>
      <textarea className="f" rows={3} style={{ marginTop: 12 }} placeholder="98450 12345, 77952 40605 …" value={paste} onChange={(e) => setPaste(e.target.value)} />
      <button className="btn sm" onClick={() => void doImport(paste)}>Add to contacts</button>
      {imported != null && <div className="stat" style={{ padding: '12px 16px', marginTop: 10, display: 'inline-block' }}><span>Imported</span><b>{imported}</b></div>}

      <div className="pickbar" style={{ marginTop: 22 }}>
        <input className="f grow" style={{ margin: 0 }} placeholder="Search name or number" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="f2" style={{ width: 'auto', margin: 0 }} value={seg} onChange={(e) => setSeg(e.target.value as Seg)}>
          <option value="all">All contacts</option><option value="recent30">Recently ordered (30 days)</option><option value="inactive1">Inactive 1 month+ (30–59 days)</option>
          <option value="inactive2">Inactive 2 months+ (60+ days)</option><option value="repeat">Repeat customers</option><option value="onetime">One-time customers</option><option value="optout">Opted out</option>
        </select>
        <select className="f2" style={{ width: 'auto', margin: 0 }} value={sort} onChange={(e) => setSort(e.target.value as Sort)}>
          <option value="last_desc">Last order: newest first</option><option value="last_asc">Last order: oldest first</option><option value="orders_desc">Total orders: high to low</option>
          <option value="orders_asc">Total orders: low to high</option><option value="name_asc">Name: A → Z</option><option value="name_desc">Name: Z → A</option>
        </select>
        <button className="btn sm ghost" onClick={() => setPick(new Set([...pick, ...eligible.map((c) => c.phone)]))}>Select all shown ({eligible.length})</button>
        <button className="btn sm ghost" onClick={() => setPick(new Set())}>Clear</button>
        {pick.size > 0 && <span className="selinfo">{pick.size} selected</span>}
      </div>
      <div className="tblwrap"><table><thead><tr><th style={{ width: 38 }} /><th>Number</th><th>Name</th><th>Orders</th><th>Last order</th></tr></thead><tbody>
        {rows.length ? rows.slice(0, 400).map((c) => <tr key={c.id}>
          <td><input type="checkbox" className="cbox" disabled={c.opted_out} checked={pick.has(c.phone)} onChange={(e) => { const n = new Set(pick); if (e.target.checked) n.add(c.phone); else n.delete(c.phone); setPick(n) }} /></td>
          <td>{phoneShort(c.phone)}</td><td>{c.name || '—'}</td><td>{c.total_orders}</td>
          <td>{c.last_order_at ? dayKeyIST(c.last_order_at) : '—'}{c.opted_out && <> · <b style={{ color: 'var(--red)' }}>opted out</b></>}</td>
        </tr>) : <tr><td colSpan={5}><div className="none">No contacts match this filter</div></td></tr>}
      </tbody></table></div>
      {rows.length > 400 && <div className="none" style={{ marginTop: 10 }}>Showing first 400. Search or filter to narrow.</div>}
      {pick.size > 0 && <button className="btn" style={{ marginTop: 16 }} onClick={() => go('blast', { phones: [...pick] })}>Blast to {pick.size} selected →</button>}
    </section>
  )
}
