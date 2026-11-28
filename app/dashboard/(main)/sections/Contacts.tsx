'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { DCustomer } from '@/lib/dashboard/types'
import { dayKeyIST, Loading, phoneShort, useDash } from '../kit'

type Seg = 'all' | 'recent30' | 'inactive1' | 'inactive2' | 'repeat' | 'onetime' | 'optout'
type Sort = 'last_desc' | 'last_asc' | 'orders_desc' | 'orders_asc' | 'name_asc' | 'name_desc'
const PAGE = 100

interface PageData { customers: DCustomer[]; matching: number; total: number; optedOut: number; page: number; size: number }

/**
 * Contacts. Search, filter, sort and paging run on the server (lib/dashboard/customers.ts), so only the 100 rows on
 * screen are downloaded, however many contacts the branch has.
 */
export default function Contacts() {
  const { api, toast, go } = useDash()
  const [q, setQ] = useState('')
  const [search, setSearch] = useState('') // q after the person stops typing
  const [seg, setSeg] = useState<Seg>('all')
  const [sort, setSort] = useState<Sort>('last_desc')
  const [page, setPage] = useState(1)
  const [data, setData] = useState<PageData | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [pick, setPick] = useState<Set<string>>(new Set())
  const [paste, setPaste] = useState('')
  const [drag, setDrag] = useState(false)
  const [imported, setImported] = useState<number | null>(null)
  const [selecting, setSelecting] = useState(false)
  const [firstN, setFirstN] = useState('')
  const seq = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => { setSearch(q.trim()); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [q])

  const load = useCallback(async () => {
    const mine = ++seq.current // only the newest request may update the table
    setBusy(true)
    try {
      const d = await api.get<PageData>('contacts', { page, size: PAGE, q: search, seg, sort })
      if (mine !== seq.current) return
      setData(d); setError('')
    } catch (e) {
      if (mine === seq.current) setError(e instanceof Error ? e.message : 'Could not load')
    } finally {
      if (mine === seq.current) setBusy(false)
    }
  }, [api, page, search, seg, sort])
  useEffect(() => { void load() }, [load])
  // Fewer matches than the page we are on (e.g. after a search): go to the last page that has rows.
  useEffect(() => {
    if (data && page > 1 && (page - 1) * PAGE >= data.matching) setPage(Math.max(1, Math.ceil(data.matching / PAGE)))
  }, [data, page])

  if (!data) return <Loading error={error} onRetry={load} />

  const pages = Math.max(1, Math.ceil(data.matching / PAGE))
  const shown = data.customers
  const filtered = !!search || seg !== 'all'

  const doImport = async (text: string) => {
    try {
      const r = await api.post<{ phones: string[]; added: number; withName: number; named: number }>('contacts', 'import', { text })
      setImported(r.phones.length); setPaste('')
      setPick((p) => new Set([...p, ...r.phones]))
      const noName = r.phones.length - r.withName
      const already = r.phones.length - r.added
      toast(`${r.added} new contact${r.added === 1 ? '' : 's'} added${already ? `, ${already} already saved (not added again)` : ''}${r.named ? `, ${r.named} names filled in` : ''}. ${r.phones.length} selected${noName ? `; ${noName} without a name will get "Hi there"` : ''}`)
      void load()
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not import') }
  }
  const readFile = (f: File | undefined) => { if (f) void f.text().then(doImport) }
  const editName = async (c: DCustomer) => {
    const name = window.prompt(`Name for ${phoneShort(c.phone)} (used in promotions as "Hi <name>")`, c.name ?? '')
    if (name === null) return
    try { await api.post('contacts', 'setName', { phone: c.phone, name }); toast('Name saved'); void load() }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not save the name') }
  }
  // Tick box in the table header: every selectable (not opted-out) row on this page.
  const pageRows = shown.filter((c) => !c.opted_out)
  const pageAll = pageRows.length > 0 && pageRows.every((c) => pick.has(c.phone))
  const pageSome = !pageAll && pageRows.some((c) => pick.has(c.phone))
  const togglePage = () => {
    const n = new Set(pick)
    for (const c of pageRows) { if (pageAll) n.delete(c.phone); else n.add(c.phone) }
    setPick(n)
  }
  const selectFirst = async () => {
    const count = Math.floor(Number(firstN))
    if (!count || count < 1) { toast('Enter how many contacts to select'); return }
    setSelecting(true)
    try {
      const r = await api.post<{ phones: string[] }>('contacts', 'firstPhones', { q: search, seg, sort, count })
      setPick(new Set(r.phones)) // replaces the selection so "first 200" means exactly 200
      toast(`${r.phones.length} contacts selected${r.phones.length < count ? ` (only ${r.phones.length} available)` : ''}`)
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not select') }
    finally { setSelecting(false) }
  }
  const selectAll = async () => {
    setSelecting(true)
    try {
      const r = await api.post<{ phones: string[] }>('contacts', 'phones', { q: search, seg, sort })
      setPick((p) => new Set([...p, ...r.phones]))
      toast(`${r.phones.length} contacts selected${data.matching > r.phones.length ? ` (${data.matching - r.phones.length} opted out, left out)` : ''}`)
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not select') }
    finally { setSelecting(false) }
  }

  return (
    <section>
      <div className="stats">
        <div className="stat"><span>Saved Contacts</span><b>{data.total}</b></div>
        <div className="stat b"><span>Matching Filter</span><b>{data.matching}</b></div>
        <div className="stat r"><span>Selected</span><b>{pick.size}</b></div>
        <div className="stat o"><span>Opted Out</span><b>{data.optedOut}</b></div>
      </div>
      <div className={`drop ${drag ? 'on' : ''}`} onDragOver={(e) => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={(e) => { e.preventDefault(); setDrag(false); readFile(e.dataTransfer.files[0]) }}>
        <b style={{ color: 'var(--ink)' }}>Add numbers</b><br />Drop a CSV here, or paste below: one contact per line as <b>Name, number</b> (the name is used in promotions as &quot;Hi Name&quot;). Numbers without a name get &quot;Hi there&quot;. Numbers already saved are not added again.
        <div style={{ marginTop: 12 }}><label className="btn sm ghost" style={{ display: 'inline-block', cursor: 'pointer' }}>Choose CSV<input type="file" accept=".csv,.txt" hidden onChange={(e) => readFile(e.target.files?.[0])} /></label></div>
      </div>
      <textarea className="f" rows={3} style={{ marginTop: 12 }} placeholder={'Shahil, 77952 40605\nRiya, 98450 12345'} value={paste} onChange={(e) => setPaste(e.target.value)} />
      <button className="btn sm" onClick={() => void doImport(paste)}>Add to contacts</button>
      {imported != null && <div className="stat" style={{ padding: '12px 16px', marginTop: 10, display: 'inline-block' }}><span>Imported</span><b>{imported}</b></div>}

      <div className="pickbar" style={{ marginTop: 22 }}>
        <input className="f grow" style={{ margin: 0 }} placeholder="Search name or number" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="f2" style={{ width: 'auto', margin: 0 }} value={seg} onChange={(e) => { setSeg(e.target.value as Seg); setPage(1) }}>
          <option value="all">All contacts</option><option value="recent30">Recently ordered (30 days)</option><option value="inactive1">Inactive 1 month+ (30–59 days)</option>
          <option value="inactive2">Inactive 2 months+ (60+ days)</option><option value="repeat">Repeat customers</option><option value="onetime">One-time customers</option><option value="optout">Opted out</option>
        </select>
        <select className="f2" style={{ width: 'auto', margin: 0 }} value={sort} onChange={(e) => { setSort(e.target.value as Sort); setPage(1) }}>
          <option value="last_desc">Last order: newest first</option><option value="last_asc">Last order: oldest first</option><option value="orders_desc">Total orders: high to low</option>
          <option value="orders_asc">Total orders: low to high</option><option value="name_asc">Name: A → Z</option><option value="name_desc">Name: Z → A</option>
        </select>
        <button className="btn sm ghost" disabled={selecting || !data.matching} onClick={() => void selectAll()}>{selecting ? 'Selecting…' : `Select all ${filtered ? 'matching' : 'contacts'} (${data.matching})`}</button>
        <input className="f" type="number" min={1} max={5000} inputMode="numeric" style={{ margin: 0, width: 96 }} placeholder="How many" value={firstN} onChange={(e) => setFirstN(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void selectFirst() }} />
        <button className="btn sm ghost" disabled={selecting || !data.matching} onClick={() => void selectFirst()}>Select first {firstN || 'N'}</button>
        <button className="btn sm ghost" onClick={() => setPick(new Set())}>Clear</button>
        {pick.size > 0 && <span className="selinfo">{pick.size} selected</span>}
        {busy && <span className="selinfo">Loading…</span>}
      </div>
      <div className="tblwrap" style={{ opacity: busy ? 0.6 : 1 }}><table><thead><tr><th style={{ width: 38 }}><input type="checkbox" className="cbox" title="Select everyone on this page" aria-label="Select everyone on this page" disabled={!pageRows.length} checked={pageAll} ref={(el) => { if (el) el.indeterminate = pageSome }} onChange={togglePage} /></th><th>Number</th><th>Name</th><th>Orders</th><th>Last order</th></tr></thead><tbody>
        {shown.length ? shown.map((c) => <tr key={c.id}>
          <td><input type="checkbox" className="cbox" disabled={c.opted_out} checked={pick.has(c.phone)} onChange={(e) => { const n = new Set(pick); if (e.target.checked) n.add(c.phone); else n.delete(c.phone); setPick(n) }} /></td>
          <td>{phoneShort(c.phone)}</td><td><button title="Add or change the name" style={{ textAlign: 'left', color: c.name ? 'inherit' : 'var(--muted)' }} onClick={() => void editName(c)}>{c.name || '+ Add name'} <span style={{ fontSize: 11, color: 'var(--muted)' }}>✎</span></button></td><td>{c.total_orders}</td>
          <td>{c.last_order_at ? dayKeyIST(c.last_order_at) : '—'}{c.opted_out && <> · <b style={{ color: 'var(--red)' }}>opted out</b></>}</td>
        </tr>) : <tr><td colSpan={5}><div className="none">{busy ? 'Loading…' : 'No contacts match this filter'}</div></td></tr>}
      </tbody></table></div>
      {pages > 1 && <Pager page={Math.min(page, pages)} pages={pages} total={data.matching} onPage={setPage} />}
      {pick.size > 0 && <button className="btn" style={{ marginTop: 16 }} onClick={() => go('blast', { phones: [...pick] })}>Blast to {pick.size} selected →</button>}
    </section>
  )
}

/** Page numbers under the table: Prev 1 2 3 … 13 Next, with "101–200 of 1230". */
function Pager({ page, pages, total, onPage }: { page: number; pages: number; total: number; onPage: (p: number) => void }) {
  const nums = [...new Set([1, page - 2, page - 1, page, page + 1, page + 2, pages])].filter((n) => n >= 1 && n <= pages).sort((a, b) => a - b)
  const go = (p: number) => { onPage(p); document.querySelector('.fkd .tblwrap')?.scrollIntoView({ block: 'start', behavior: 'smooth' }) }
  return (
    <div className="pickbar" style={{ marginTop: 12, justifyContent: 'center', flexWrap: 'wrap' }}>
      <button className="btn sm ghost" disabled={page <= 1} onClick={() => go(page - 1)}>‹ Prev</button>
      {nums.map((n, i) => (
        <span key={n} style={{ display: 'contents' }}>
          {i > 0 && n - nums[i - 1] > 1 && <span style={{ color: 'var(--muted)' }}>…</span>}
          <button className={`btn sm ${n === page ? '' : 'ghost'}`} onClick={() => go(n)} aria-current={n === page ? 'page' : undefined}>{n}</button>
        </span>
      ))}
      <button className="btn sm ghost" disabled={page >= pages} onClick={() => go(page + 1)}>Next ›</button>
      <span className="selinfo">{(page - 1) * PAGE + 1}–{Math.min(page * PAGE, total)} of {total}</span>
    </div>
  )
}
