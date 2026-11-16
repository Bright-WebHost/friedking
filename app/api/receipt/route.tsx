import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const RED = '#ec1c23'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const rs = (paise: number) => `Rs ${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: paise % 100 ? 2 : 0, maximumFractionDigits: 2 })}`

/**
 * GET /api/receipt?order=<order uuid>  ->  PNG receipt (sent to the customer on WhatsApp when an order is accepted).
 * The private order id is the key, so receipts cannot be guessed from an order number.
 */
export async function GET(request: NextRequest) {
  const id = request.nextUrl.searchParams.get('order') ?? ''
  if (!UUID.test(id)) return new Response('Order id is required', { status: 400 })

  try {
    const admin = createAdminClient()
    const { data: order, error } = await admin
      .from('orders')
      .select('order_number, status, order_type, payment_method, subtotal_paise, gst_paise, total_paise, discount_paise, loyalty_discount_paise, delivery_address, table_number, created_at, cash_collected, branch_id, customer:customers(name), items:order_items(name_snapshot, quantity, line_total_paise, line_no)')
      .eq('id', id)
      .maybeSingle()
    if (error || !order || order.status === 'draft') return new Response('Order not found', { status: 404 })

    const [{ data: branch }, { data: rows }] = await Promise.all([
      admin.from('branches').select('name, address, phone').eq('id', order.branch_id).maybeSingle(),
      admin.from('branch_settings').select('key, value').eq('branch_id', order.branch_id).in('key', ['gstin', 'tagline', 'whatsapp_number']),
    ])
    const s = Object.fromEntries((rows ?? []).map((r) => [r.key, r.value ?? '']))
    const phone = branch?.phone || (s.whatsapp_number ? `+91 ${s.whatsapp_number}` : '')

    const items = [...(order.items ?? [])].sort((a, b) => (a.line_no ?? 0) - (b.line_no ?? 0))
    const customer = Array.isArray(order.customer) ? order.customer[0] : order.customer
    const when = new Date(order.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
    const typeLabel = order.order_type === 'pickup' ? 'TAKEAWAY' : String(order.order_type).toUpperCase()
    const payLabel = order.payment_method === 'upi' ? 'UPI' : 'CASH'
    const where = order.order_type === 'delivery' ? order.delivery_address : order.order_type === 'dine-in' && order.table_number ? `Table ${order.table_number}` : ''

    const summary: Array<[string, string]> = [['Item total', rs(order.subtotal_paise)]]
    if (order.discount_paise > 0) summary.push(['Discount', `-${rs(order.discount_paise)}`])
    if (order.loyalty_discount_paise > 0) summary.push(['Reward points', `-${rs(order.loyalty_discount_paise)}`])
    summary.push([`GST (CGST + SGST)`, rs(order.gst_paise)])

    // Read the logo from disk: no network call back to ourselves.
    const logo = `data:image/png;base64,${(await readFile(path.join(process.cwd(), 'public', 'brand', 'logo-white.png'))).toString('base64')}`
    const label = { fontSize: 13, color: '#9ca3af', letterSpacing: 1 } as const
    const checker = Array.from({ length: 38 }, (_, i) => i)
    const height = 640 + items.length * 36 + summary.length * 26 + (where ? 64 : 0) + (s.gstin ? 22 : 0) + (branch?.address ? 22 : 0) + (phone ? 22 : 0)

    return new ImageResponse(
      (
        <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff', fontFamily: 'sans-serif' }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', backgroundColor: RED, padding: '26px 32px 22px' }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={logo} width={170} height={95} alt="" />
            <span style={{ fontSize: 15, color: '#ffffff', marginTop: 8, letterSpacing: 2 }}>{(s.tagline || 'Growing the crispiest bites').toUpperCase()}</span>
            {branch?.name ? <span style={{ fontSize: 15, color: '#ffd9db', marginTop: 8 }}>{branch.name}</span> : null}
            {branch?.address ? <span style={{ fontSize: 13, color: '#ffd9db', marginTop: 2 }}>{branch.address}</span> : null}
            {phone ? <span style={{ fontSize: 13, color: '#ffd9db', marginTop: 2 }}>{phone}</span> : null}
            {s.gstin ? <span style={{ fontSize: 12, color: '#ffd9db', marginTop: 2 }}>GSTIN: {s.gstin}</span> : null}
          </div>
          <div style={{ display: 'flex', width: '100%', height: 16 }}>
            {checker.map((i) => <div key={i} style={{ width: 16, height: 16, backgroundColor: i % 2 === 0 ? RED : '#ffffff' }} />)}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', padding: '22px 32px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 18 }}>
              <div style={{ display: 'flex', color: RED, fontSize: 15, fontWeight: 700, letterSpacing: 1.5, padding: '7px 20px', borderRadius: 999, border: `2px solid ${RED}` }}>
                {payLabel} · {typeLabel}
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', marginBottom: 16 }}>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                <span style={label}>ORDER</span>
                <span style={{ fontSize: 26, fontWeight: 800, color: '#111827' }}>FK-{order.order_number}</span>
              </div>
              <span style={{ fontSize: 15, color: '#6b7280' }}>{when}</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', backgroundColor: '#fff1f1', borderRadius: 10, padding: '12px 16px', marginBottom: 20 }}>
              <span style={label}>CUSTOMER</span>
              <span style={{ fontSize: 19, fontWeight: 700, color: '#111827' }}>{customer?.name || 'Guest'}</span>
              {where ? (
                <div style={{ display: 'flex', flexDirection: 'column', marginTop: 8 }}>
                  <span style={label}>{order.order_type === 'delivery' ? 'DELIVER TO' : 'TABLE'}</span>
                  <span style={{ fontSize: 15, color: '#374151' }}>{where}</span>
                </div>
              ) : null}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 14 }}>
              {items.map((it, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontSize: 17, color: '#111827' }}>{it.quantity} x {it.name_snapshot}</span>
                  <span style={{ fontSize: 17, fontWeight: 600, color: '#111827' }}>{rs(it.line_total_paise)}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', borderTop: '1px dashed #e5e7eb', paddingTop: 10, marginBottom: 14 }}>
              {summary.map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                  <span style={{ fontSize: 14, color: '#6b7280' }}>{k}</span>
                  <span style={{ fontSize: 14, color: '#374151' }}>{v}</span>
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', backgroundColor: RED, borderRadius: 12, padding: '16px 22px' }}>
              <span style={{ fontSize: 20, fontWeight: 800, color: '#ffffff', letterSpacing: 2 }}>TOTAL</span>
              <span style={{ fontSize: 32, fontWeight: 800, color: '#ffffff' }}>{rs(order.total_paise)}</span>
            </div>
            <span style={{ fontSize: 14, color: '#6b7280', alignSelf: 'center', marginTop: 18 }}>
              {order.cash_collected ? 'Paid. Thank you for ordering with Fried King!' : `Pay ${order.order_type === 'delivery' ? 'on delivery' : 'at the counter'}. Thank you for ordering with Fried King!`}
            </span>
          </div>
        </div>
      ),
      { width: 600, height },
    )
  } catch (e) {
    console.error('[GET /api/receipt]', e instanceof Error ? e.message : e)
    return new Response('Failed to generate receipt', { status: 500 })
  }
}
