import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const RED = '#d62300'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const W = 1080
const rs = (paise: number) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`

/** Poppins from public/fonts: read from disk, or fetched from our own site if the file is not bundled. */
async function font(file: string, origin: string): Promise<ArrayBuffer> {
  try {
    const buf = await readFile(path.join(process.cwd(), 'public', 'fonts', file))
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  } catch {
    return (await fetch(`${origin}/fonts/${file}`)).arrayBuffer()
  }
}

/**
 * GET /api/receipt?order=<order uuid>  ->  PNG receipt (sent to the customer on WhatsApp when an order is accepted).
 * The private order id is the key, so receipts cannot be guessed from an order number.
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('order') ?? ''
  const sessionId = request.nextUrl.searchParams.get('session') ?? ''
  const isTable = UUID.test(sessionId)
  if (!isTable && !UUID.test(id)) return new Response('Order id is required', { status: 400 })

  try {
    const admin = createAdminClient(request.nextUrl.searchParams.get('branch'))
    const SELECT = 'order_number, token_number, status, order_type, payment_method, subtotal_paise, gst_paise, total_paise, discount_paise, loyalty_discount_paise, delivery_address, table_number, special_instructions, created_at, cash_collected, branch_id, customer:customers(name, phone), items:order_items(name_snapshot, quantity, line_total_paise, line_no, notes)'
    let order
    if (isTable) {
      // One bill for the whole table: every round that was not cancelled, items merged by dish.
      const { data: rounds } = await admin.from('orders').select(SELECT).eq('table_session_id', sessionId)
        .in('status', ['pending', 'confirmed', 'preparing', 'ready', 'delivered']).order('created_at')
      if (!rounds?.length) return new Response('Table not found', { status: 404 })
      const merged = new Map<string, { name_snapshot: string; quantity: number; line_total_paise: number; line_no: number; notes: string | null }>()
      for (const r of rounds) for (const it of r.items ?? []) {
        const m = merged.get(it.name_snapshot)
        if (m) { m.quantity += it.quantity; m.line_total_paise += it.line_total_paise; m.notes = [m.notes, it.notes].filter(Boolean).join('; ') || null }
        else merged.set(it.name_snapshot, { name_snapshot: it.name_snapshot, quantity: it.quantity, line_total_paise: it.line_total_paise, line_no: merged.size, notes: it.notes })
      }
      const sum = (k: 'subtotal_paise' | 'gst_paise' | 'total_paise' | 'discount_paise' | 'loyalty_discount_paise') => rounds.reduce((t, r) => t + (r[k] ?? 0), 0)
      const first = rounds[0]
      order = { ...first, status: 'delivered', order_type: 'dine-in', cash_collected: true, delivery_address: null,
        special_instructions: rounds.map((r) => r.special_instructions).filter(Boolean).join('; ') || null,
        created_at: new Date().toISOString(), items: [...merged.values()],
        subtotal_paise: sum('subtotal_paise'), gst_paise: sum('gst_paise'), total_paise: sum('total_paise'),
        discount_paise: sum('discount_paise'), loyalty_discount_paise: sum('loyalty_discount_paise') }
    } else {
      const { data, error } = await admin.from('orders').select(SELECT).eq('id', id).maybeSingle()
      if (error || !data || data.status === 'draft') return new Response('Order not found', { status: 404 })
      order = data
    }

    const [{ data: branch }, { data: rows }] = await Promise.all([
      admin.from('branches').select('name, address, phone').eq('id', order.branch_id).maybeSingle(),
      admin.from('branch_settings').select('key, value').eq('branch_id', order.branch_id).in('key', ['gstin', 'whatsapp_number']),
    ])
    const s = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value ?? '']))
    const phone = branch?.phone || (s.whatsapp_number ? `+91 ${s.whatsapp_number}` : '')
    const branchName = (branch?.name ? branch.name.replace(/^Fried\s+King\s+/i, '').trim() : '') || branch?.name || 'Pandeshwar'

    const origin = request.nextUrl.origin
    const [regular, semi, bold, logoFile] = await Promise.all([
      font('Poppins-Regular.ttf', origin),
      font('Poppins-SemiBold.ttf', origin),
      font('Poppins-Bold.ttf', origin),
      readFile(path.join(process.cwd(), 'public', 'brand', 'logo-white.png')),
    ])
    const logo = `data:image/png;base64,${logoFile.toString('base64')}`

    const items = [...(order.items ?? [])].sort((a, b) => (a.line_no ?? 0) - (b.line_no ?? 0))
    const customer = Array.isArray(order.customer) ? order.customer[0] : order.customer
    const digits = String(customer?.phone ?? '').replace(/\D/g, '').slice(-10)
    const custPhone = digits ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : ''
    const d = new Date(new Date(order.created_at).getTime() + 5.5 * 3600 * 1000)
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const when = `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`

    const typeLabel = order.order_type === 'pickup' ? 'TAKEAWAY' : String(order.order_type).toUpperCase()
    const payLabel = order.cash_collected ? 'PAID' : order.order_type === 'delivery' ? 'CASH ON DELIVERY' : 'PAY AT COUNTER'

    const roundedTotalPaise = Math.round(order.total_paise / 100) * 100
    const summary: Array<[string, string]> = [['Item total', rs(order.subtotal_paise)]]
    if (order.discount_paise > 0) summary.push(['Discount', `-${rs(order.discount_paise)}`])
    if (order.loyalty_discount_paise > 0) summary.push(['Reward points', `-${rs(order.loyalty_discount_paise)}`])
    summary.push(['GST (CGST + SGST)', rs(order.gst_paise)])
    const baseSum = order.subtotal_paise - (order.discount_paise || 0) - (order.loyalty_discount_paise || 0) + order.gst_paise
    const fee = order.order_type === 'delivery' ? Math.max(0, order.total_paise - baseSum) : 0
    if (fee > 0) summary.push(['Delivery fee', rs(fee)])
    const roundOff = roundedTotalPaise - (baseSum + fee)
    if (roundOff !== 0) {
      summary.push(['Round off', `${roundOff > 0 ? '+' : ''}${rs(roundOff)}`])
    }

    const COLS = 40, SQ = W / COLS
    const checker = (flip: boolean) => (
      <div style={{ display: 'flex', flexDirection: 'column', width: W }}>
        {[0, 1].map((row) => (
          <div key={row} style={{ display: 'flex', height: SQ }}>
            {Array.from({ length: COLS }, (_, i) => (
              <div key={i} style={{ width: SQ, height: SQ, backgroundColor: (i + row + (flip ? 1 : 0)) % 2 === 0 ? RED : '#ffffff' }} />
            ))}
          </div>
        ))}
      </div>
    )

    const wrapLines = (t: string, per: number) => Math.max(1, Math.ceil(t.length / per))
    const itemsH = items.reduce((h, it) => h + 92 + 48 * (wrapLines(it.name_snapshot, 26) - 1) + (it.notes ? 44 * wrapLines(it.notes, 40) : 0), 0)
    const extraDeliveryH = order.order_type === 'delivery' && order.delivery_address ? 75 : 0
    const extraNotesH = order.special_instructions ? 65 : 0
    const height = 255 + 55 + 195 + 75 + extraDeliveryH + extraNotesH + 75 + itemsH + (summary.length * 46 + 45) + 140 + 185 + (s.gstin ? 30 : 0) + 55 + 5

    return new ImageResponse(
      (
        <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff', fontFamily: 'Poppins' }}>
          {/* Header */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: RED, padding: '32px 44px', width: W }}>
            {/* Left spacer to keep logo centered */}
            <div style={{ display: 'flex', width: 240 }} />
            {/* Center: Logo */}
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <img src={logo} alt="Fried King" style={{ width: 340, height: 190, objectFit: 'contain' }} />
            </div>
            {/* Right: Branch badge */}
            <div style={{ display: 'flex', width: 240, justifyContent: 'flex-end', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 999, padding: '10px 24px', boxShadow: '0 4px 12px rgba(0,0,0,0.12)' }}>
                <span style={{ fontSize: 24, fontWeight: 700, color: RED, letterSpacing: 1.5, textTransform: 'uppercase' }}>{branchName}</span>
              </div>
            </div>
          </div>
          {checker(false)}

          {/* Order Info Row */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '32px 44px 20px', borderBottom: '2px dashed #f2b8ae' }}>
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ fontSize: 54, fontWeight: 700, color: '#111827', letterSpacing: 2 }}>
                  {isTable ? `TABLE ${order.table_number ?? ''}` : `FK-${order.order_number}`}
                </span>
                {order.token_number ? (
                  <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#fee2e2', border: `2px solid ${RED}`, borderRadius: 10, padding: '4px 14px', marginLeft: 16 }}>
                    <span style={{ fontSize: 24, fontWeight: 700, color: RED, letterSpacing: 1 }}>TOKEN #{order.token_number}</span>
                  </div>
                ) : null}
              </div>
              <span style={{ fontSize: 26, color: '#6b7280', marginTop: 8, fontWeight: 400 }}>{when}</span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end' }}>
              <div style={{ display: 'flex', alignItems: 'center', backgroundColor: RED, borderRadius: 999, padding: '10px 24px' }}>
                <span style={{ fontSize: 26, fontWeight: 700, color: '#ffffff', letterSpacing: 1.5 }}>
                  {order.order_type === 'dine-in' && order.table_number && !isTable
                    ? `DINE-IN · TABLE ${order.table_number}`
                    : typeLabel}
                </span>
              </div>
              <span style={{ fontSize: 24, fontWeight: 700, color: order.cash_collected ? '#059669' : '#b91c1c', marginTop: 10, letterSpacing: 0.5, textTransform: 'uppercase' }}>
                {payLabel}
              </span>
            </div>
          </div>

          {/* Customer Bar */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#f9fafb', borderRadius: 16, padding: '16px 28px', margin: '20px 44px 10px', border: '1.5px solid #f3f4f6' }}>
            <div style={{ display: 'flex', alignItems: 'center' }}>
              <span style={{ fontSize: 26, color: '#6b7280', marginRight: 10 }}>Customer:</span>
              <span style={{ fontSize: 28, fontWeight: 700, color: '#111827' }}>{customer?.name || 'Guest'}</span>
            </div>
            {custPhone ? (
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ fontSize: 28, fontWeight: 600, color: '#374151' }}>{custPhone}</span>
              </div>
            ) : null}
          </div>

          {/* Delivery Address (if delivery) */}
          {order.order_type === 'delivery' && order.delivery_address ? (
            <div style={{ display: 'flex', backgroundColor: '#fff7ed', border: '1.5px solid #ffedd5', borderRadius: 14, padding: '14px 24px', margin: '6px 44px 10px' }}>
              <span style={{ fontSize: 24, color: '#c2410c', fontWeight: 600, marginRight: 8 }}>Delivery:</span>
              <span style={{ fontSize: 24, color: '#7c2d12', flex: 1 }}>{order.delivery_address}</span>
            </div>
          ) : null}

          {/* Special Instructions (if any) */}
          {order.special_instructions ? (
            <div style={{ display: 'flex', backgroundColor: '#fef2f2', border: '1.5px solid #fee2e2', borderRadius: 14, padding: '14px 24px', margin: '6px 44px 10px' }}>
              <span style={{ fontSize: 24, color: RED, fontWeight: 600, marginRight: 8 }}>Note:</span>
              <span style={{ fontSize: 24, color: '#7f1d1d', flex: 1 }}>{order.special_instructions}</span>
            </div>
          ) : null}

          {/* Items Container */}
          <div style={{ display: 'flex', flexDirection: 'column', padding: '0 44px', marginTop: 10 }}>
            {/* Column Headers */}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '16px 0 10px', borderBottom: '2px solid #e5e7eb' }}>
              <span style={{ fontSize: 24, fontWeight: 700, color: '#9ca3af', letterSpacing: 1.5, textTransform: 'uppercase' }}>ITEM</span>
              <div style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ fontSize: 24, fontWeight: 700, color: '#9ca3af', letterSpacing: 1.5, textTransform: 'uppercase', marginRight: 60 }}>QTY</span>
                <span style={{ fontSize: 24, fontWeight: 700, color: '#9ca3af', letterSpacing: 1.5, textTransform: 'uppercase' }}>AMOUNT</span>
              </div>
            </div>

            {/* Items */}
            {items.map((it, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', borderBottom: '2px dashed #f2c7bf', padding: '18px 0' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ display: 'flex', flex: 1, fontSize: 42, fontWeight: 700, color: '#111827', lineHeight: 1.3 }}>{it.name_snapshot}</span>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: '#f3f4f6', borderRadius: 10, padding: '6px 18px', margin: '0 24px' }}>
                    <span style={{ fontSize: 34, fontWeight: 700, color: '#374151' }}>x{it.quantity}</span>
                  </div>
                  <span style={{ display: 'flex', width: 220, justifyContent: 'flex-end', fontSize: 44, fontWeight: 700, color: '#111827' }}>{rs(it.line_total_paise)}</span>
                </div>
                {it.notes ? <span style={{ fontSize: 28, color: RED, marginTop: 8, lineHeight: 1.4 }}>Note: {it.notes}</span> : null}
              </div>
            ))}

            {/* Summary Lines */}
            <div style={{ display: 'flex', flexDirection: 'column', margin: '20px 0 20px' }}>
              {summary.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 12 }}>
                  <span style={{ fontSize: 30, color: '#6b7280' }}>{k}</span>
                  <span style={{ fontSize: 30, fontWeight: 600, color: '#1f2937' }}>{v}</span>
                </div>
              ))}
            </div>

            {/* TOTAL Card */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: RED, borderRadius: 24, padding: '24px 36px' }}>
              <span style={{ fontSize: 34, color: '#ffffff', letterSpacing: 5, fontWeight: 700 }}>TOTAL</span>
              <span style={{ fontSize: 66, fontWeight: 700, color: '#ffffff' }}>{`₹${Math.round(order.total_paise / 100).toLocaleString('en-IN')}`}</span>
            </div>
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '24px 44px 18px', textAlign: 'center' }}>
            <div style={{ display: 'flex', fontSize: 32, color: '#374151' }}>
              Thank you for ordering with <span style={{ color: RED, fontWeight: 700, marginLeft: 10 }}>Fried King</span>!
            </div>
            {phone ? <span style={{ fontSize: 26, color: '#6b7280', marginTop: 8 }}>Questions? WhatsApp us on {phone}</span> : null}
            {s.gstin ? <span style={{ fontSize: 22, color: '#6b7280', marginTop: 4 }}>GSTIN: {s.gstin}</span> : null}
            <span style={{ fontSize: 22, color: '#9ca3af', marginTop: 20 }}>Developed by Loopdot</span>
          </div>
          {checker(true)}
        </div>
      ),
      {
        width: W,
        height,
        fonts: [
          { name: 'Poppins', data: regular, weight: 400, style: 'normal' },
          { name: 'Poppins', data: semi, weight: 600, style: 'normal' },
          { name: 'Poppins', data: bold, weight: 700, style: 'normal' },
        ],
      },
    )
  } catch (e) {
    console.error('[GET /api/receipt]', e instanceof Error ? e.message : e)
    return new Response('Failed to generate receipt', { status: 500 })
  }
}
