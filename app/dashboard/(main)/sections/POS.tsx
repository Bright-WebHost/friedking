'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { calcTotals } from '@/lib/utils'
import { isBoss } from '@/lib/dashboard/access'
import type { DCategory, DCustomer, DMenuItem, DOrder, DProgram, DSession, DTable } from '@/lib/dashboard/types'
import { Img, Loading, openPrintWindow, phoneShort, printReceipt, rs, useDash, useLoad, usePoll } from '../kit'

const PER_CAT = 8
type OType = 'pickup' | 'delivery' | 'dine-in'
interface PosData { items: DMenuItem[]; categories: DCategory[]; program: DProgram | null; popularIds: string[] }

export default function POS() {
  const { api, toast, handoff, staff, settings, branch, go } = useDash()
  const { data, error, reload } = useLoad(() => api.get<PosData>('pos'), [api])
  const tabs = useLoad(() => api.get<{ tables: DTable[]; sessions: DSession[]; orders: DOrder[] }>('tables'), [api])
  usePoll(tabs.reload, 30000) // also refreshed at once after any order change

  const tables = useMemo(() => {
    return [...(tabs.data?.tables ?? [])].sort((a, b) => a.table_number - b.table_number)
  }, [tabs.data])
  const occupiedIds = useMemo(() => {
    return new Set((tabs.data?.sessions ?? []).map((s) => s.table_id))
  }, [tabs.data])

  const init = useRef(handoff.current)
  useEffect(() => { handoff.current = null }, [handoff])
  const [cat, setCat] = useState('All')
  const [q, setQ] = useState('')
  const [cart, setCart] = useState<Record<string, number>>({})
  const [type, setType] = useState<OType>((init.current?.orderType as OType) ?? 'pickup')
  const [phone, setPhone] = useState(String(init.current?.phone ?? ''))
  const [name, setName] = useState(String(init.current?.name ?? ''))
  const [address, setAddress] = useState('')
  const [pincode, setPincode] = useState('')
  const [table, setTable] = useState(init.current?.table ? String(init.current.table) : '')
  const [typeahead, setTypeahead] = useState(false)
  const [redeemOn, setRedeemOn] = useState(false)
  const [redeemPts, setRedeemPts] = useState(0)
  const [discOn, setDiscOn] = useState(false)
  const [disc, setDisc] = useState('')
  const [discountPasscode, setDiscountPasscode] = useState('')
  const [cartOpen, setCartOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const submitting = useRef(false)
  const [bad, setBad] = useState('')

  const items = useMemo(() => data?.items.filter((i) => i.is_active || cart[i.id]) ?? [], [data, cart])
  const all = data?.items ?? []
  const cats = useMemo(() => (data?.categories ?? []).filter((c) => all.some((i) => i.category_id === c.id)), [data, all])
  const byId = useMemo(() => new Map(all.map((i) => [i.id, i])), [all])
  const lines = Object.entries(cart).filter(([id]) => byId.has(id)).map(([id, n]) => ({ item: byId.get(id)!, qty: n }))
  const totals = calcTotals(lines.map((l) => ({ pricePaise: l.item.price_paise, quantity: l.qty })))
  const count = lines.reduce((s, l) => s + l.qty, 0)

  const digits = phone.replace(/\D/g, '')
  // Saved contacts are looked up on the server as the number is typed (3+ digits), so this stays fast with any number of contacts.
  const [found, setFound] = useState<DCustomer[]>([])
  const lookupFor = digits.length >= 3 ? digits.slice(-10) : ''
  useEffect(() => {
    if (!lookupFor) { setFound([]); return }
    let live = true
    const t = setTimeout(() => {
      api.get<{ hits: DCustomer[] }>('pos', { lookup: lookupFor })
        .then((r) => { if (live) setFound(r.hits ?? []) })
        .catch(() => { /* keep the last results; the next keystroke tries again */ })
    }, 200)
    return () => { live = false; clearTimeout(t) }
  }, [api, lookupFor])
  // While the next answer is on its way, narrow the last one so the list does not flicker.
  const current = lookupFor ? found.filter((c) => c.phone.includes(lookupFor)) : []
  const ten = digits.slice(-10)
  const match = ten.length === 10 ? current.find((c) => c.phone.endsWith(ten)) ?? null : null
  const hits = typeahead ? current.slice(0, 6) : []

  const program = data?.program
  const discountPct = discOn && isBoss(staff.role) ? Math.min(100, Math.max(0, Number(disc) || 0)) : 0
  const discountPaise = Math.round(totals.totalPaise * discountPct / 100)
  const maxPts = program && match && match.points_balance > 0
    ? Math.max(0, Math.min(match.points_balance, Math.floor(((totals.totalPaise - discountPaise) * program.max_redeem_pct_per_order / 100) / program.redemption_paise_per_point)))
    : 0
  const pts = redeemOn ? Math.min(redeemPts, maxPts) : 0
  const loyaltyPaise = program ? pts * program.redemption_paise_per_point : 0
  const finalTotal = Math.max(0, Math.round((totals.totalPaise - discountPaise - loyaltyPaise) / 100) * 100)

  if (!data) return <Loading error={error} onRetry={reload} />

  const add = (i: DMenuItem) => {
    if (!i.is_active) { toast(`${i.name} is marked sold out`); return }
    setCart((c) => ({ ...c, [i.id]: Math.min(50, (c[i.id] ?? 0) + 1) }))
  }
  const dec = (id: string) => setCart((c) => { const n = (c[id] ?? 0) - 1; const x = { ...c }; if (n <= 0) delete x[id]; else x[id] = n; return x })
  const clear = () => { setCart({}); setRedeemOn(false); setRedeemPts(0); setDiscOn(false); setDisc(''); setDiscountPasscode('') }

  const openTab = (() => {
    if (type !== 'dine-in' || !table.trim() || !tabs.data) return null
    const t = tabs.data.tables.find((x) => String(x.table_number) === table.trim())
    const s = t && tabs.data.sessions.find((x) => x.table_id === t.id)
    if (!s) return null
    const rounds = tabs.data.orders.filter((o) => o.table_session_id === s.id && o.status !== 'cancelled')
    return { t, already: rounds.reduce((x, o) => x + o.total_paise, 0), round: rounds.length + 1 }
  })()

  const submit = async () => {
    if (submitting.current || !lines.length) return
    setBad('')
    if (digits.length < 10) { setBad('phone'); toast('Enter a valid WhatsApp number'); return }
    if (type === 'delivery' && !address.trim()) { setBad('address'); toast('Delivery needs an address'); return }
    if (type === 'dine-in') {
      if (!table.trim()) { setBad('table'); toast('Dine-in needs a table number'); return }
      const t = tabs.data?.tables.find((x) => String(x.table_number) === table.trim())
      const isOccupied = t && occupiedIds.has(t.id)
      const isCurrentHandoff = init.current?.table && String(init.current.table) === table.trim()
      if (isOccupied && !isCurrentHandoff) {
        setBad('table')
        toast(`Table ${table} is occupied. Pick a free table.`)
        return
      }
    }
    if (discountPct > 0 && !discountPasscode) { setBad('discount'); toast('Enter the staff discount passcode'); return }
    submitting.current = true
    setSending(true)
    const printWindow = settings.auto_print === 'true' ? openPrintWindow() : null
    try {
      const r = await api.post<{ orderId: string; orderNumber: number; totalPaise: number }>('pos', 'create', {
        phone: digits, name, orderType: type, address, pincode, tableNumber: type === 'dine-in' ? Number(table) : null,
        lines: lines.map((l) => ({ itemId: l.item.id, quantity: l.qty })),
        redeemPoints: pts, discountPct: discountPct || undefined, discountPasscode: discountPct ? discountPasscode : undefined,
      })
      toast(`#${r.orderNumber} sent to the kitchen`)
      clear(); setCartOpen(false); setPhone(''); setName(''); setAddress(''); setPincode(''); setTable('')
      window.dispatchEvent(new Event('fk-orders-changed'))
      go('orders')
      if (settings.auto_print === 'true') {
        if (!printWindow) toast('Order placed. Allow pop-ups to print the bill.')
        else void (async () => {
          try {
            const { orders } = await api.get<{ orders: DOrder[] }>('orders', { orderId: r.orderId })
            const o = orders.find((x) => x.id === r.orderId)
            if (!o || !printReceipt(o, branch, settings, printWindow)) throw new Error('Bill unavailable')
            void api.post('orders', 'printed', { orderId: o.id }).catch(() => undefined)
          } catch {
            printWindow.close()
            toast(`Order #${r.orderNumber} placed. Use Print on the order to print the bill.`)
          }
        })()
      }
    } catch (e) {
      printWindow?.close()
      if (e instanceof Error && e.message === 'Wrong discount passcode') setBad('discount')
      toast(e instanceof Error ? e.message : 'Could not create the order')
    } finally {
      submitting.current = false
      setSending(false)
    }
  }

  const tile = (i: DMenuItem) => {
    const thr = i.low_stock_threshold ?? Number(settings.low_stock_threshold)
    const warn = i.track_stock ? (i.stock_qty <= 0 ? 'out' : i.stock_qty <= thr ? 'low' : '') : ''
    return (
      <button key={i.id} className={`pitem ${i.is_active ? '' : 'off'}`} onClick={() => add(i)}>
        {cart[i.id] ? <span className="qb">{cart[i.id]}</span> : null}
        {warn && <span className={`pstock ${warn}`}>{warn === 'out' ? 'Out' : `${i.stock_qty} left`}</span>}
        <Img src={i.image_url} className="pthumb" />
        <span className="pbody"><b>{i.name}</b><i>{rs(i.price_paise)}</i></span>
      </button>
    )
  }

  const query = q.trim().toLowerCase()
  const catName = (id: string) => data.categories.find((c) => c.id === id)?.name ?? ''
  let body: React.ReactNode
  if (query) {
    const found = items.filter((i) => i.name.toLowerCase().includes(query) || catName(i.category_id).toLowerCase().includes(query))
    body = found.length ? <div className="csec"><h4>{found.length} result{found.length > 1 ? 's' : ''}</h4><div className="pgrid">{found.slice(0, 60).map(tile)}</div></div> : <div className="none">Nothing matched that</div>
  } else if (cat === 'All') {
    const popular = data.popularIds.map((id) => byId.get(id)).filter((i): i is DMenuItem => !!i && i.is_active)
    body = <>
      {popular.length > 0 && <div className="csec popular"><h4>⭐ Popular · fastest to tap for a walk-in</h4><div className="pgrid">{popular.map(tile)}</div></div>}
      {cats.map((c) => {
        const rows = items.filter((i) => i.category_id === c.id)
        return rows.length ? <div className="csec" key={c.id}><h4>{c.name}{rows.length > PER_CAT && <button onClick={() => setCat(c.id)}>All {rows.length} →</button>}</h4><div className="pgrid">{rows.slice(0, PER_CAT).map(tile)}</div></div> : null
      })}
    </>
  } else {
    const rows = items.filter((i) => i.category_id === cat)
    body = <div className="csec"><h4>{catName(cat)} · {rows.length} items<button onClick={() => setCat('All')}>← All categories</button></h4><div className="pgrid">{rows.map(tile)}</div></div>
  }

  return (
    <>
    <div className="pos">
      <div className="catrail">
        <button aria-pressed={cat === 'All'} onClick={() => { setCat('All'); setQ('') }}><span className="cn">All dishes</span><span className="ct">{items.length}</span></button>
        {cats.map((c) => <button key={c.id} aria-pressed={cat === c.id} onClick={() => { setCat(c.id); setQ('') }}><span className="cn">{c.name}</span><span className="ct">{items.filter((i) => i.category_id === c.id).length}</span></button>)}
      </div>

      <div className="panel">
        <div className="psearch">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
          <input placeholder="Search dish or category…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
        {body}
      </div>

      {cartOpen && <div className="navbackdrop" style={{ zIndex: 65 }} onClick={() => setCartOpen(false)} />}
      <div className={`cartbox ${cartOpen ? 'open' : ''} ${count ? 'hasitems' : ''}`}>
        <div className="ch" onClick={(e) => { if ((e.target as HTMLElement).tagName !== 'BUTTON') setCartOpen((o) => !o) }}>
          <span>🛒 Current order{count ? ` · ${count} · ${rs(finalTotal)}` : ''}</span>
          <span className="mobindicator">{cartOpen ? '▼ Minimize' : '▲ View order'}</span>
          {count > 0 && <button onClick={clear}>Clear</button>}
        </div>
        <div style={{ padding: '14px 16px 16px', borderBottom: '1px solid var(--line)' }}>
          {/* Phones hide Dine-in (tables are run from the Tables page); it stays when a table round was started there. */}
          <div className={`seg3 ${type === 'dine-in' ? '' : 'nodine-phone'}`}>
            <button aria-pressed={type === 'pickup'} onClick={() => setType('pickup')}><span>🏪</span>Takeaway</button>
            <button aria-pressed={type === 'delivery'} onClick={() => setType('delivery')}><span>🛵</span>Delivery</button>
            <button className="dinebtn" aria-pressed={type === 'dine-in'} onClick={() => setType('dine-in')}><span>🍽️</span>Dine-in</button>
          </div>
          {openTab && <div className="tabbanner"><b>Table {openTab.t?.table_number} · Round {openTab.round}</b>
            <span>Already on tab: {rs(openTab.already)}{count ? ` + this round ${rs(finalTotal)} = new total ${rs(openTab.already + finalTotal)}` : ''}</span></div>}
        </div>
        <div className="clines">
          {lines.length ? lines.map((l) => (
            <div className="cline" key={l.item.id}>
              <div className="nm">{l.item.name}<small>{rs(l.item.price_paise)} each</small></div>
              <div className="stp"><button onClick={() => dec(l.item.id)}>−</button><b>{l.qty}</b><button onClick={() => add(l.item)}>+</button></div>
            </div>
          )) : <div className="cartempty">Tap a dish to start the order</div>}
        </div>
        <div className="cfoot">
          <div className="pphwrap">
            <input className={`f2 ${bad === 'phone' ? 'ferr' : ''}`} placeholder="WhatsApp number *" inputMode="numeric" value={phone} autoComplete="off"
              onChange={(e) => { setPhone(e.target.value); setTypeahead(true); setRedeemOn(false) }} onBlur={() => setTimeout(() => setTypeahead(false), 150)} />
            {hits.length > 0 && <div className="postype">{hits.map((c) => (
              <button key={c.id} onMouseDown={(e) => e.preventDefault()} onClick={() => { setPhone(phoneShort(c.phone)); setName(c.name ?? ''); setTypeahead(false) }}>
                <span><b style={{ fontSize: 12.5 }}>{c.name || '—'}</b><br /><small style={{ color: 'var(--muted)' }}>{phoneShort(c.phone)}</small></span>
                <small style={{ textAlign: 'right', color: 'var(--muted)' }}>{c.total_orders} orders{c.points_balance ? <><br /><b style={{ color: '#b8860b' }}>{c.points_balance} pts</b></> : null}</small>
              </button>
            ))}</div>}
          </div>
          {match && <div className="custcard">
            <div className="plh"><b>{match.name || 'Customer'}</b><span>{match.total_orders} orders</span></div>
            {program && <div style={{ marginTop: 3, fontSize: 11.5, color: '#8a6300', fontWeight: 700 }}>{match.points_balance} pts (≈{rs(match.points_balance * program.redemption_paise_per_point)}){match.tier ? ` · ${match.tier}` : ''}</div>}
          </div>}
          <input className="f2" placeholder="Customer name" value={name} onChange={(e) => setName(e.target.value)} />
          {type === 'delivery' && <>
            <input className={`f2 ${bad === 'address' ? 'ferr' : ''}`} placeholder="Delivery address *" value={address} onChange={(e) => setAddress(e.target.value)} />
            <input className="f2" placeholder="Pincode" inputMode="numeric" maxLength={6} value={pincode} onChange={(e) => setPincode(e.target.value.replace(/\D/g, ''))} />
          </>}
          {type === 'dine-in' && (
            <select
              className={`f2 ${bad === 'table' ? 'ferr' : ''}`}
              value={table}
              onChange={(e) => {
                setTable(e.target.value)
                if (bad === 'table') setBad('')
              }}
            >
              <option value="">Select table *</option>
              {tabs.loading && !tables.length && <option value="" disabled>Loading tables…</option>}
              {!tabs.loading && !tables.length && <option value="" disabled>No tables configured</option>}
              {tables.map((t) => {
                const isOccupied = occupiedIds.has(t.id)
                const isCurrentHandoff = init.current?.table && String(init.current.table) === String(t.table_number)
                const disabled = isOccupied && !isCurrentHandoff
                return (
                  <option key={t.id} value={t.table_number} disabled={disabled}>
                    Table {t.table_number}{isOccupied ? ' (Occupied)' : ''}
                  </option>
                )
              })}
            </select>
          )}
          {maxPts > 0 && program && <div className="posloy">
            <div className="plh"><label style={{ display: 'flex', gap: 7, alignItems: 'center', fontWeight: 700 }}><input type="checkbox" checked={redeemOn} onChange={(e) => { setRedeemOn(e.target.checked); if (e.target.checked && !redeemPts) setRedeemPts(maxPts) }} /> 🎁 Redeem points</label>
              <span>{redeemOn ? `${pts} pts · − ${rs(loyaltyPaise)}` : 'off'}</span></div>
            <input type="range" min={0} max={maxPts} value={Math.min(redeemPts, maxPts)} disabled={!redeemOn} onChange={(e) => setRedeemPts(Number(e.target.value))} />
          </div>}
          {isBoss(staff.role) && <div className="posdisc">
            <div className="plh" style={{ cursor: 'pointer' }} onClick={() => { setDiscOn((d) => !d); setDiscountPasscode(''); setBad('') }}><b>💸 Staff discount</b><span>{discOn ? 'remove' : 'add'}</span></div>
            {discOn && <div style={{ marginTop: 8 }}>
              <div style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
                {[5, 10, 20].map((pct) => <button key={pct} className={`btn ${Number(disc) === pct ? 'on' : 'ghost'}`} onClick={() => setDisc(String(pct))}>{pct}%</button>)}
                <button className={`btn ${disc && ![5, 10, 20].includes(Number(disc)) ? 'on' : 'ghost'}`} onClick={() => setDisc('0')}>Custom</button>
              </div>
              {disc && ![5, 10, 20].includes(Number(disc)) && <input className="f2" type="number" min={0} max={100} placeholder="Custom percentage" value={disc} onChange={(e) => setDisc(e.target.value)} style={{ margin: 0 }} />}
              <input className={`f2 ${bad === 'discount' ? 'ferr' : ''}`} type="password" inputMode="numeric" maxLength={6} autoComplete="off" aria-label="Staff discount passcode" aria-invalid={bad === 'discount'} placeholder="Discount passcode" value={discountPasscode} onChange={(e) => { setDiscountPasscode(e.target.value.replace(/\D/g, '')); if (bad === 'discount') setBad('') }} style={{ marginTop: 8, marginBottom: 0 }} />
            </div>}
          </div>}
          <div className="li" style={{ marginBottom: 2 }}><span>Total (incl. 5% GST)</span><span>{rs(totals.totalPaise)}</span></div>
          <div className="ctot"><span>Total</span><span>{rs(finalTotal)}</span></div>
          <button className="cta" disabled={!lines.length || sending} onClick={() => void submit()}>{sending ? 'Sending…' : type === 'dine-in' ? 'Send to kitchen 🚀' : 'Place order 🚀'}</button>
        </div>
      </div>
    </div>
    </>
  )
}
