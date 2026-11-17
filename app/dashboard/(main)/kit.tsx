'use client'

/* Shared dashboard building blocks: API calls, formatting, IST date ranges, modal, toast, slider, switch, printing. */
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { DBranch, DMeta, DOrder, DRider } from '@/lib/dashboard/types'
import type { SettingKey } from '@/lib/dashboard/settings'
import type { StaffRole } from '@/lib/dashboard/access'
import { normalizePhone } from '@/lib/utils'

// ---------------------------------------------------------------- API

export class ApiError extends Error {}

async function readBody(res: Response) {
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(data.message ?? 'Something went wrong. Try again.')
  return data
}

export function makeApi(slug: string, onRead?: () => void) {
  const base = `/api/dashboard/${encodeURIComponent(slug)}`
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    get: async <T = any>(domain: string, params?: Record<string, string | number | null | undefined>): Promise<T> => {
      const q = new URLSearchParams()
      for (const [k, v] of Object.entries(params ?? {})) if (v !== null && v !== undefined && v !== '') q.set(k, String(v))
      const data = await readBody(await fetch(`${base}/${domain}${q.size ? `?${q}` : ''}`, { cache: 'no-store' }))
      onRead?.()
      return data
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    post: async <T = any>(domain: string, action: string, body: Record<string, unknown> = {}): Promise<T> =>
      readBody(await fetch(`${base}/${domain}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, action }) })),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    form: async <T = any>(domain: string, action: string, form: FormData): Promise<T> => {
      form.set('action', action)
      return readBody(await fetch(`${base}/${domain}`, { method: 'POST', body: form }))
    },
  }
}
export type Api = ReturnType<typeof makeApi>

// ---------------------------------------------------------------- context

export interface Dash {
  slug: string
  api: Api
  branch: DBranch
  settings: Record<SettingKey, string>
  riders: DRider[]
  staff: { name: string; email: string; role: StaffRole; branchId: string | null }
  toast: (msg: string) => void
  reloadMeta: () => Promise<void>
  /** True while a slider is being dragged or a popup is open: background refresh waits. */
  busy: React.MutableRefObject<number>
  sound: { on: boolean; enable: () => void; ping: () => void }
  /** Ask the shell to open a section, e.g. POS in dine-in mode for a table. */
  go: (section: string, state?: Record<string, unknown>) => void
  handoff: React.MutableRefObject<Record<string, unknown> | null>
  updated: (when?: Date) => void
}

export const DashContext = createContext<Dash | null>(null)
export function useDash(): Dash {
  const d = useContext(DashContext)
  if (!d) throw new Error('useDash outside dashboard')
  return d
}
export type { DMeta }

// ---------------------------------------------------------------- formatting

const INR = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 2 })
/** 12345 paise -> "₹123.45", 12300 -> "₹123" */
export const rs = (paise: number | null | undefined) => `₹${INR.format(Math.round(Number(paise || 0)) / 100)}`
export const pct = (n: number) => `${n >= 0 ? '' : '−'}${Math.abs(n || 0).toFixed(1)}%`
const istFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })
export const ist = (t: string | number | Date | null | undefined) => (t ? istFmt.format(new Date(t)) : '—')
const timeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit' })
export const istTime = (t: Date) => timeFmt.format(t)
export const fmtMins = (m: number) => (m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`)
export const minsSince = (t: string) => Math.max(0, Math.floor((Date.now() - new Date(t).getTime()) / 60000))
/** "2026-11-14" in IST for a timestamp */
export const dayKeyIST = (t: string | number | Date) => new Date(new Date(t).getTime() + 19800000).toISOString().slice(0, 10)
export const todayIST = () => dayKeyIST(Date.now())
export const phoneShort = (p: string | null | undefined) => (p ?? '').replace(/^\+91/, '')
export const statusLabel = (o: Pick<DOrder, 'status' | 'order_type'>) =>
  o.status === 'ready' ? (o.order_type === 'delivery' ? 'out for delivery' : o.order_type === 'dine-in' ? 'served' : 'ready for pickup')
    : o.status === 'pending' ? 'new' : o.status
export const typeLabel = (t: string) => (t === 'pickup' ? 'takeaway' : t)
export const customerName = (o: DOrder) => o.customer?.name || 'Guest'

// ---------------------------------------------------------------- IST date ranges (Oceana's chips)

export type Range = 'today' | 'yesterday' | 'week' | 'month' | 'all' | 'custom'
export const RANGES: Array<[Range, string]> = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This Week'], ['month', 'This Month'], ['all', 'All Time']]

const istMidnight = (day: string) => new Date(`${day}T00:00:00+05:30`).getTime()
export function rangeBounds(range: Range, from = '', to = ''): { start: number; end: number } {
  const today = istMidnight(todayIST())
  const now = Date.now()
  switch (range) {
    case 'today': return { start: today, end: now + 60000 }
    case 'yesterday': return { start: today - 86400000, end: today }
    case 'week': return { start: today - 6 * 86400000, end: now + 60000 }
    case 'month': return { start: today - 29 * 86400000, end: now + 60000 }
    case 'custom': return from ? { start: istMidnight(from), end: to ? istMidnight(to) + 86400000 : now + 60000 } : { start: 0, end: now + 60000 }
    default: return { start: 0, end: now + 60000 }
  }
}
export function previousBounds(range: Range): { start: number; end: number } | null {
  if (range === 'all' || range === 'custom') return null
  const b = rangeBounds(range)
  const today = istMidnight(todayIST())
  if (range === 'today') return { start: today - 86400000, end: today }
  if (range === 'yesterday') return { start: today - 2 * 86400000, end: today - 86400000 }
  const len = b.end - b.start
  return { start: b.start - len, end: b.start }
}
export const inBounds = (t: string, b: { start: number; end: number }) => {
  const x = new Date(t).getTime()
  return x >= b.start && x < b.end
}
export const compareLabel = (range: Range) =>
  ({ today: 'yesterday', yesterday: 'the day before', week: 'last week', month: 'last month' } as Record<string, string>)[range] ?? 'the previous period'

export function RangeChips({ range, setRange, custom, from, to, setCustom }: {
  range: Range; setRange: (r: Range) => void; custom?: boolean; from?: string; to?: string; setCustom?: (from: string, to: string) => void
}) {
  const [f, setF] = useState(from ?? '')
  const [t, setT] = useState(to ?? '')
  return (
    <>
      <div className="filterrow">
        <span className="flabel">Filter:</span>
        <div className="chips">
          {[...RANGES, ...(custom ? [['custom', 'Custom Date'] as [Range, string]] : [])].map(([k, l]) => (
            <button key={k} className="chip" aria-pressed={range === k} onClick={() => setRange(k)}>{l}</button>
          ))}
        </div>
      </div>
      {custom && range === 'custom' && setCustom && (
        <div className="customrow">
          <input type="date" className="f2" value={f} onChange={(e) => setF(e.target.value)} />
          <span>to</span>
          <input type="date" className="f2" value={t} onChange={(e) => setT(e.target.value)} />
          <button className="btn sm" onClick={() => setCustom(f, t)}>Apply</button>
        </div>
      )}
    </>
  )
}

// ---------------------------------------------------------------- UI pieces

export function Modal({ children, onClose, className = '', closeOnBackdrop = true }: { children: React.ReactNode; onClose: () => void; className?: string; closeOnBackdrop?: boolean }) {
  const { busy } = useDash()
  useEffect(() => {
    busy.current += 1
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => { busy.current -= 1; window.removeEventListener('keydown', esc) }
  }, [busy, onClose])
  return (
    <div className="modal" onClick={(e) => { if (closeOnBackdrop && e.target === e.currentTarget) onClose() }}>
      <div className={`mcard ${className}`} role="dialog" aria-modal="true">{children}</div>
    </div>
  )
}

export function Switch({ on, onClick, label }: { on: boolean; onClick: () => void; label?: string }) {
  return <button className="sw" aria-pressed={on} aria-label={label} title={label} onClick={onClick}><i /></button>
}

export function VegMark({ veg }: { veg: boolean }) {
  return (
    <span role="img" aria-label={veg ? 'Vegetarian' : 'Non-vegetarian'} style={{ display: 'inline-flex', width: 14, height: 14, border: `1.5px solid ${veg ? '#1f8a3b' : '#a8261d'}`, borderRadius: 2, alignItems: 'center', justifyContent: 'center', background: '#fff', flex: 'none' }}>
      <span style={{ width: 6, height: 6, borderRadius: 99, background: veg ? '#1f8a3b' : '#a8261d' }} />
    </span>
  )
}

export function Empty({ icon, text }: { icon: string; text: string }) {
  return <div className="aempty"><div className="aei">{icon}</div><div>{text}</div></div>
}

export function Img({ src, alt = '', className = '' }: { src: string | null | undefined; alt?: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt={alt} loading="lazy" className={className} /> : <img src="/brand/mark-red.png" alt="" className={`${className} ph`} />
}

/** Oceana's slide-to-confirm. onDone may return false (or a rejected promise) to snap back. */
export function Slide({ label, color, onDone, big = false, pulse = false }: { label: string; color: string; onDone: () => unknown; big?: boolean; pulse?: boolean }) {
  const { busy } = useDash()
  const box = useRef<HTMLDivElement>(null)
  const [x, setX] = useState(0)
  const [text, setText] = useState(label)
  const drag = useRef<{ x0: number; max: number } | null>(null)
  useEffect(() => setText(label), [label])

  const knobW = big ? 66 : 50
  const down = (e: React.PointerEvent) => {
    if (!box.current) return
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { x0: e.clientX, max: box.current.clientWidth - knobW - 6 }
    busy.current += 1
  }
  const move = (e: React.PointerEvent) => {
    if (!drag.current) return
    const d = Math.max(0, Math.min(drag.current.max, e.clientX - drag.current.x0))
    setX(d)
    setText(d > drag.current.max * 0.55 ? 'Release' : label)
  }
  const up = async () => {
    if (!drag.current) return
    const passed = x > drag.current.max * 0.55
    drag.current = null
    busy.current = Math.max(0, busy.current - 1)
    if (!passed) { setX(0); setText(label); return }
    setText('Working…')
    try {
      const r = await onDone()
      if (r === false) { setX(0); setText(label) }
    } catch {
      setX(0); setText(label)
    }
  }
  return (
    <div ref={box} className={`slide ${big ? 'big' : ''} ${pulse ? 'pulsering' : ''}`} onClick={(e) => e.stopPropagation()}>
      <div className="fill" style={{ background: color, opacity: 0.16, width: x + knobW }} />
      <div className="lbl2">{text}</div>
      <div className="knob" style={{ background: color, left: 3 + x }} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up}>›</div>
    </div>
  )
}

export function PasscodeModal({ title, detail, onOk, onClose }: { title: string; detail: string; onOk: (code: string) => Promise<boolean | void>; onClose: () => void }) {
  const [code, setCode] = useState('')
  const [bad, setBad] = useState(false)
  const tryIt = async (v: string) => {
    const ok = await onOk(v).catch(() => false)
    if (ok === false) { setBad(true); setCode(''); setTimeout(() => setBad(false), 320) } else onClose()
  }
  return (
    <Modal onClose={onClose}>
      <div className="pinwrap">
        <h3>{title}</h3>
        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>{detail}</p>
        <input className={`pinbox ${bad ? 'bad' : ''}`} inputMode="numeric" maxLength={6} placeholder="••••" autoFocus autoComplete="off"
          value={code} onChange={(e) => { const v = e.target.value.replace(/\D/g, ''); setCode(v); if (v.length === 4) void tryIt(v) }}
          onKeyDown={(e) => { if (e.key === 'Enter') void tryIt(code) }} />
        <div className="mrow"><button onClick={onClose}>Cancel</button><button className="go" onClick={() => void tryIt(code)}>Confirm</button></div>
      </div>
    </Modal>
  )
}

export function Toaster({ msg }: { msg: string | null }) {
  const [el, setEl] = useState<HTMLElement | null>(null)
  useEffect(() => setEl(document.querySelector<HTMLElement>('.fkd')), [])
  if (!msg || !el) return null
  return createPortal(<div className="toast" role="status">{msg}</div>, el)
}

/** Loads data for a section; reload() refetches. Errors become a toast + error string. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const fnRef = useRef(fn)
  fnRef.current = fn
  const reload = useCallback(async () => {
    try {
      const d = await fnRef.current()
      setData(d)
      setError('')
      return d
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load')
      return null
    } finally {
      setLoading(false)
    }
  }, [])
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setLoading(true); void reload() }, deps)
  return { data, setData, error, loading, reload }
}

export function Loading({ error, onRetry }: { error?: string; onRetry?: () => void }) {
  if (error) return <div className="none"><p style={{ margin: '0 0 10px' }}>{error}</p>{onRetry && <button className="btn sm" onClick={onRetry}>Try again</button>}</div>
  return <div className="none">Loading…</div>
}

/** Phone/tablet width (same 860 px breakpoint as Oceana). */
export function useIsMobile() {
  const [m, setM] = useState(false)
  useEffect(() => {
    const q = window.matchMedia('(max-width: 860px)')
    const f = () => setM(q.matches)
    f(); q.addEventListener('change', f)
    return () => q.removeEventListener('change', f)
  }, [])
  return m
}

/** Re-render every `ms` (running clocks). */
export function useTick(ms = 20000) {
  const [, set] = useState(0)
  useEffect(() => { const t = window.setInterval(() => set((x) => x + 1), ms); return () => window.clearInterval(t) }, [ms])
}

/**
 * Background refresh like Oceana's 3 s poll: skipped while the tab is hidden or a
 * slider/popup is busy; also runs on "Refresh now" and after any order change.
 */
export function usePoll(fn: () => unknown, ms = 5000) {
  const { busy } = useDash()
  const ref = useRef(fn)
  ref.current = fn
  useEffect(() => {
    const t = window.setInterval(() => { if (!document.hidden && busy.current === 0) void ref.current() }, ms)
    const now = () => void ref.current()
    window.addEventListener('fk-refresh', now)
    window.addEventListener('fk-orders-changed', now)
    return () => { window.clearInterval(t); window.removeEventListener('fk-refresh', now); window.removeEventListener('fk-orders-changed', now) }
  }, [busy, ms])
}

// ---------------------------------------------------------------- CSV + download

export function downloadCsv(name: string, rows: Array<Array<string | number | null | undefined>>) {
  const csv = rows.map((r) => r.map((v) => `"${String(v ?? '').replace(/"/g, '""')}"`).join(',')).join('\n')
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
  const a = document.createElement('a')
  a.href = url; a.download = name
  document.body.appendChild(a); a.click(); a.remove()
  URL.revokeObjectURL(url)
}

// ---------------------------------------------------------------- printing (80 mm thermal)

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
const RECEIPT_CSS = `@page{size:80mm auto;margin:0}
body{font-family:Arial,sans-serif;padding:3mm 4mm;font-size:13px;width:72mm;max-width:72mm;margin:0 auto;color:#111}
.bill,.kot{width:100%}.logo{display:block;width:52mm;height:auto;max-height:22mm;object-fit:contain;filter:grayscale(1) contrast(2);margin:0 auto 2mm}
.brand{text-align:center;font-size:16px;font-weight:700;text-transform:none}.phone{text-align:center;font-size:13px;margin-top:2px}
.line{border:0;border-top:1px solid #111;margin:7px 0}.dots{border:0;border-top:2px dotted #111;margin:8px 0}
.r{display:flex;justify-content:space-between;gap:8px}.c{text-align:center}.b{font-weight:700}.t{font-weight:bold;font-size:15px}
.meta{display:grid;grid-template-columns:1fr 1fr;gap:2px 8px}.meta .right{text-align:right}
.items{width:100%;border-collapse:collapse;font-size:12px}.items td,.items th{padding:3px 0;text-align:left;vertical-align:top}.items td:nth-child(2),.items th:nth-child(2){text-align:center;width:10mm}.items td:nth-child(3),.items th:nth-child(3),.items td:last-child,.items th:last-child{text-align:right;white-space:nowrap}
.desc{font-size:11px;font-style:italic;padding:0 0 3px 4mm!important}.note{font-size:11px;padding:0 0 3px 4mm!important}
.totals{margin-left:auto;width:48mm}.grand{font-weight:700;font-size:16px;margin-top:5px}.thanks{text-align:center;margin-top:9px;font-weight:700}
.kot{break-before:page;page-break-before:always;padding-top:5mm}.kot h2{font-size:17px;text-align:center;margin:0 0 4px}.kot .items td:first-child{font-weight:700;font-size:14px}.kot .items td:nth-child(2){font-weight:700;font-size:14px}
@media print{.kot{break-before:page;page-break-before:always}}`

function printHtml(title: string, body: string) {
  const w = window.open('', '_blank', 'width=380,height=640')
  if (!w) return false
  w.document.write(`<html><head><title>${esc(title)}</title><style>${RECEIPT_CSS}</style></head><body>${body}</body></html>`)
  w.document.close(); w.focus(); w.print()
  return true
}

const plainRs = (paise: number) => (paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const printType = (type: DOrder['order_type']) => type === 'delivery' ? 'Delivery' : type === 'dine-in' ? 'Dine In' : 'Pick Up'
function printDate(iso: string) {
  const date = new Date(iso)
  return {
    day: date.toLocaleDateString('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: '2-digit' }),
    time: date.toLocaleTimeString('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hour12: false }),
  }
}

function billMarkup(o: DOrder, branch: DBranch, settings: Record<SettingKey, string>) {
  const gstPct = Number(settings.gst_percent) || 5
  const halfGst = Math.floor(o.gst_paise / 2)
  const date = printDate(o.created_at)
  const phone = settings.whatsapp_number || branch.phone || ''
  const branchName = branch.name.toLowerCase().includes('fried king') ? branch.name : `Fried king ${branch.name}`
  const fee = o.total_paise - (o.subtotal_paise - o.discount_paise - o.loyalty_discount_paise + o.gst_paise)
  const rows = o.items.map((l) => `<tr><td>${esc(l.name_snapshot)}</td><td>${l.quantity}</td><td>${plainRs(l.unit_price_paise)}</td><td>${plainRs(l.line_total_paise)}</td></tr>${l.notes ? `<tr><td colspan="4" class="note">Note: ${esc(l.notes)}</td></tr>` : ''}`).join('')
  const totalQty = o.items.reduce((sum, l) => sum + l.quantity, 0)
  return `<section class="bill">
    <img class="logo" src="/brand/logo-red.png" alt="Fried King">
    <div class="brand">${esc(branchName)}</div><div class="phone">Mob no: ${esc(phone)}</div>
    <hr class="line"><div>Name: ${esc(customerName(o))}</div><hr class="line">
    <div class="meta"><div>Date: ${date.day}<br>${date.time}</div><div class="right b">${esc(printType(o.order_type))}<br>Bill No.: ${o.order_number}</div>
      <div>Cashier: ${esc(o.taken_by || 'biller')}<br><span class="b">Token No.: ${o.token_number ?? '—'}</span></div>
      ${o.table_number ? `<div class="right">Table: ${o.table_number}</div>` : '<div></div>'}</div>
    <hr class="line"><table class="items"><thead><tr><th>Item</th><th>Qty.</th><th>Price</th><th>Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <hr class="line"><div class="totals"><div class="r"><span>Total Qty: ${totalQty}</span><span>Sub Total&nbsp; ${plainRs(o.subtotal_paise)}</span></div>
      <div class="r"><span></span><span>Total&nbsp; ${plainRs(o.subtotal_paise)}</span></div>
      <div class="r"><span>CGST@${gstPct / 2}%</span><span>${plainRs(halfGst)}</span></div>
      <div class="r"><span>SGST@${gstPct / 2}%</span><span>${plainRs(o.gst_paise - halfGst)}</span></div>
      ${fee > 0 ? `<div class="r"><span>Delivery fee</span><span>${plainRs(fee)}</span></div>` : ''}
      ${o.discount_paise ? `<div class="r"><span>Discount</span><span>-${plainRs(o.discount_paise)}</span></div>` : ''}
      ${o.loyalty_discount_paise ? `<div class="r"><span>Points</span><span>-${plainRs(o.loyalty_discount_paise)}</span></div>` : ''}
      <div class="r grand"><span>Grand Total</span><span>₹ ${plainRs(o.total_paise)}</span></div></div>
    <div style="margin-top:3px">${o.cash_collected ? 'Paid' : 'Not Paid'}</div>
    <div class="thanks">*****Thank You Visit Again*****</div>
  </section>`
}

function kotMarkup(o: DOrder) {
  const date = printDate(o.created_at)
  const rows = o.items.map((l) => `<tr><td>${esc(l.name_snapshot)}${l.menu_item?.description ? `<div class="desc">Description: ${esc(l.menu_item.description)}</div>` : ''}${l.notes ? `<div class="note">Special note: ${esc(l.notes)}</div>` : ''}</td><td>${l.quantity}</td></tr>`).join('')
  return `<section class="kot"><div class="c">${date.day} ${date.time}</div><h2>KOT - ${o.token_number ?? '—'}<br>${esc(printType(o.order_type))}</h2>
    <hr class="dots"><table class="items"><thead><tr><th>Item</th><th>Qty.</th></tr></thead><tbody>${rows}</tbody></table>
    ${o.special_instructions ? `<hr class="dots"><div><b>Order note:</b> ${esc(o.special_instructions)}</div>` : ''}</section>`
}

export function printReceipt(o: DOrder, branch: DBranch, settings: Record<SettingKey, string>) {
  return printHtml(`Bill ${o.order_number} + KOT ${o.token_number ?? ''}`, `${billMarkup(o, branch, settings)}${kotMarkup(o)}`)
}

export function printKOT(o: DOrder, branch: DBranch): boolean {
  return printHtml(`KOT ${o.token_number ?? o.order_number}`, kotMarkup(o))
}

export function printTableQR(tableNumber: number, whatsapp: string): boolean {
  const phone = normalizePhone(whatsapp)
  if (!phone) return false
  const url = `https://wa.me/${phone.slice(1)}?text=${encodeURIComponent(`Hi, I'm at Table ${tableNumber}`)}`
  const img = `https://api.qrserver.com/v1/create-qr-code/?size=600x600&margin=10&data=${encodeURIComponent(url || `Table ${tableNumber}`)}`
  const w = window.open('', '_blank', 'width=420,height=640')
  if (!w) return false
  w.document.write(`<html><head><title>Table ${tableNumber} QR</title><style>body{font-family:system-ui,sans-serif;text-align:center;padding:26px}
    h1{font-size:40px;margin:0;color:#ec1c23}.s{letter-spacing:3px;color:#6b6f78;font-size:12px}h2{font-size:34px;margin:14px 0}img{width:300px;height:300px}p{color:#6b6f78;font-size:13px;margin:6px 0}</style></head><body>
    <h1>FRIED KING</h1><div class="s">GROWING THE CRISPIEST BITES</div><h2>TABLE ${tableNumber}</h2><img src="${img}" alt="QR">
    <p><b>Scan to order on WhatsApp</b></p><p>No app needed · Opens WhatsApp</p></body></html>`)
  w.document.close()
  setTimeout(() => { w.focus(); w.print() }, 900)
  return true
}

export { esc, printHtml }
