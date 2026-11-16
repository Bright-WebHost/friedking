import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const RED = '#d62300'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const W = 840
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
    const admin = createAdminClient()
    const SELECT = 'order_number, status, order_type, payment_method, subtotal_paise, gst_paise, total_paise, discount_paise, loyalty_discount_paise, delivery_address, table_number, special_instructions, created_at, cash_collected, branch_id, customer:customers(name, phone), items:order_items(name_snapshot, quantity, line_total_paise, line_no, notes)'
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

    const origin = request.nextUrl.origin
    const [regular, semi, bold] = await Promise.all([font('Poppins-Regular.ttf', origin), font('Poppins-SemiBold.ttf', origin), font('Poppins-Bold.ttf', origin)])

    const items = [...(order.items ?? [])].sort((a, b) => (a.line_no ?? 0) - (b.line_no ?? 0))
    const customer = Array.isArray(order.customer) ? order.customer[0] : order.customer
    const digits = String(customer?.phone ?? '').replace(/\D/g, '').slice(-10)
    const custPhone = digits ? `+91 ${digits.slice(0, 5)} ${digits.slice(5)}` : ''
    const d = new Date(new Date(order.created_at).getTime() + 5.5 * 3600 * 1000)
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    const when = `${d.getUTCDate()} ${MON[d.getUTCMonth()]} ${d.getUTCFullYear()} · ${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`

    const typeLabel = order.order_type === 'pickup' ? 'TAKEAWAY' : String(order.order_type).toUpperCase()
    const payLabel = order.cash_collected ? 'PAID' : order.order_type === 'delivery' ? 'CASH ON DELIVERY' : 'PAY AT COUNTER'
    const detail: Array<[string, string]> = [['Name', customer?.name || 'Guest'], ['Phone', custPhone]]
    if (order.order_type === 'delivery' && order.delivery_address) detail.push(['Address', order.delivery_address])
    if (order.order_type === 'dine-in' && order.table_number) detail.push(['Table', String(order.table_number)])
    if (order.special_instructions) detail.push(['Note', order.special_instructions])

    const summary: Array<[string, string]> = [['Item total', rs(order.subtotal_paise)]]
    if (order.discount_paise > 0) summary.push(['Discount', `-${rs(order.discount_paise)}`])
    if (order.loyalty_discount_paise > 0) summary.push(['Reward points', `-${rs(order.loyalty_discount_paise)}`])
    summary.push(['GST (CGST + SGST)', rs(order.gst_paise)])

    const COLS = 40, SQ = W / COLS
    const checker = (flip: boolean) => (
      <div style={{ display: 'flex', flexDirection: 'column', width: W }}>
        {[0, 1].map((row) => (
          <div key={row} style={{ display: 'flex', height: SQ }}>
            {Array.from({ length: COLS }, (_, i) => <div key={i} style={{ width: SQ, height: SQ, backgroundColor: (i + row + (flip ? 1 : 0)) % 2 === 0 ? RED : '#ffffff' }} />)}
          </div>
        ))}
      </div>
    )

    const wrapLines = (t: string, per: number) => Math.max(1, Math.ceil(t.length / per))
    const detailH = detail.reduce((h, [, v]) => h + 14 + 46 * wrapLines(v, 26), 0)
    const itemsH = items.reduce((h, it) => h + 92 + (it.notes ? 40 * wrapLines(it.notes, 44) : 0), 0)
    const addrLines = branch?.address ? wrapLines(branch.address, 48) : 0
    const height = 560 + addrLines * 42 + 42 + 420 + detailH + itemsH + summary.length * 44 + 110 + 170 + (s.gstin ? 34 : 0)

    return new ImageResponse(
      (
        <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff', fontFamily: 'Poppins' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', backgroundColor: RED, padding: '64px 48px 52px' }}>
            <span style={{ fontSize: 78, fontWeight: 700, color: '#ffffff', letterSpacing: 12 }}>FRIED KING</span>
            {branch?.address ? <span style={{ fontSize: 28, color: '#ffffff', marginTop: 26, textAlign: 'center', lineHeight: 1.5 }}>{branch.address}</span> : null}
            {phone ? <span style={{ fontSize: 28, color: '#ffffff', marginTop: 6 }}>{phone}</span> : null}
            {s.gstin ? <span style={{ fontSize: 24, color: '#ffe0dc', marginTop: 10 }}>GSTIN: {s.gstin}</span> : null}
          </div>
          {checker(false)}

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '46px 48px 0' }}>
            <span style={{ fontSize: 72, fontWeight: 700, color: '#1c1c1c', letterSpacing: 6 }}>{isTable ? `TABLE ${order.table_number ?? ''}` : `FK-${order.order_number}`}</span>
            <span style={{ fontSize: 28, color: '#8a8a8a', marginTop: 8 }}>{when}</span>
            <div style={{ display: 'flex', marginTop: 30, color: RED, fontSize: 30, fontWeight: 700, letterSpacing: 2, padding: '14px 44px', borderRadius: 999, border: `5px solid ${RED}` }}>
              {typeLabel} · {payLabel}
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', padding: '0 48px', marginTop: 40 }}>
            <div style={{ display: 'flex', borderTop: '3px dashed #f2b8ae', marginBottom: 22 }} />
            {detail.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 14 }}>
                <span style={{ fontSize: 31, color: '#8a8a8a' }}>{k}</span>
                <span style={{ fontSize: 31, fontWeight: 600, color: '#1c1c1c', textAlign: 'right', maxWidth: 520 }}>{v}</span>
              </div>
            ))}
            <div style={{ display: 'flex', borderTop: '3px dashed #f2b8ae', margin: '14px 0 22px' }} />

            {items.map((it, i) => (
              <div key={i} style={{ display: 'flex', flexDirection: 'column', borderBottom: '2px dashed #f2c7bf', padding: '14px 0 16px' }}>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ display: 'flex', flex: 1, fontSize: 34, fontWeight: 600, color: '#1c1c1c' }}>{it.name_snapshot}</span>
                  <span style={{ display: 'flex', width: 90, justifyContent: 'center', fontSize: 31, color: '#8a8a8a' }}>x{it.quantity}</span>
                  <span style={{ display: 'flex', width: 170, justifyContent: 'flex-end', fontSize: 34, fontWeight: 700, color: '#1c1c1c' }}>{rs(it.line_total_paise)}</span>
                </div>
                {it.notes ? <span style={{ fontSize: 26, color: RED, marginTop: 6 }}>Note: {it.notes}</span> : null}
              </div>
            ))}

            <div style={{ display: 'flex', flexDirection: 'column', margin: '22px 0 26px' }}>
              {summary.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
                  <span style={{ fontSize: 27, color: '#8a8a8a' }}>{k}</span>
                  <span style={{ fontSize: 27, color: '#5a5a5a' }}>{v}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: RED, borderRadius: 30, padding: '34px 44px' }}>
              <span style={{ fontSize: 30, color: '#ffffff', letterSpacing: 7 }}>TOTAL</span>
              <span style={{ fontSize: 76, fontWeight: 700, color: '#ffffff' }}>{rs(order.total_paise)}</span>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', flexGrow: 1, justifyContent: 'center', padding: '34px 48px', textAlign: 'center' }}>
            <div style={{ display: 'flex', fontSize: 31, color: '#5a5a5a' }}>
              Thank you for ordering with <span style={{ color: RED, fontWeight: 700, marginLeft: 10 }}>Fried King</span>!
            </div>
            {phone ? <span style={{ fontSize: 28, color: '#5a5a5a', marginTop: 8 }}>Questions? WhatsApp us on {phone}</span> : null}
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
