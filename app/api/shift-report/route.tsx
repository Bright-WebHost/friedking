import { ImageResponse } from 'next/og'
import { NextRequest } from 'next/server'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

const RED = '#d62300'
const W = 1080
const rs = (paise: number) => `₹${Math.round((paise || 0) / 100).toLocaleString('en-IN')}`

interface ReportData {
  branch: string; label: string; period: string; generated: string
  revenue: number; orders: number; avg: number; gst: number
  cancelled: number; cancelled_paise: number; discounts: number
  channels: Array<{ label: string; n: number; paise: number }>
  sources: Record<string, number>
  cash_collected: number; cash_pending: number
  staff: string[]; top: Array<{ name: string; qty: number }>
  open_new: number; open_kitchen: number
}

async function font(file: string, origin: string): Promise<ArrayBuffer> {
  try {
    const buf = await readFile(path.join(process.cwd(), 'public', 'fonts', file))
    return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
  } catch {
    return (await fetch(`${origin}/fonts/${file}`)).arrayBuffer()
  }
}

/**
 * GET /api/shift-report?t=<token>  ->  PNG of the shift closing report (same figures as Analytics > Shift Close Report).
 * The token is created by claim_shift_report() for each report and is the only way to see it: it is not guessable and a new report
 * replaces it. n8n puts this link in the WhatsApp image message.
 */
export async function GET(request: NextRequest) {
  const token = (request.nextUrl.searchParams.get('t') ?? '').trim()
  if (!/^[0-9a-f]{64}$/.test(token)) return new Response('Not found', { status: 404 })

  try {
    const admin = createAdminClient(request.nextUrl.searchParams.get('branch'))
    const { data: rows } = await admin.from('branch_settings').select('value').eq('key', 'shift_report_image')
    let d: ReportData | null = null
    for (const r of rows ?? []) {
      try {
        const parsed = JSON.parse(String(r.value))
        if (parsed?.token === token) { d = parsed.data as ReportData; break }
      } catch { /* ignore a broken row */ }
    }
    if (!d) return new Response('This report link has expired', { status: 404 })

    const origin = request.nextUrl.origin
    const [regular, semi, bold, logoFile] = await Promise.all([
      font('Poppins-Regular.ttf', origin), font('Poppins-SemiBold.ttf', origin), font('Poppins-Bold.ttf', origin),
      readFile(path.join(process.cwd(), 'public', 'brand', 'logo-white.png')),
    ])
    const logo = `data:image/png;base64,${logoFile.toString('base64')}`
    const branchName = (d.branch ? d.branch.replace(/^Fried\s+King\s+/i, '').trim() : '') || 'Pandeshwar'
    const staff = d.staff ?? []
    const top = (d.top ?? []).slice(0, 10)
    const maxQty = Math.max(1, ...top.map((t) => t.qty))
    const src = d.sources ?? {}
    const hasOpen = (d.open_new ?? 0) + (d.open_kitchen ?? 0) > 0

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
    const heading = (t: string) => (
      <div style={{ display: 'flex', fontSize: 26, fontWeight: 700, color: '#9ca3af', letterSpacing: 3, textTransform: 'uppercase', margin: '34px 0 12px' }}>{t}</div>
    )
    const row = (k: string, v: string, strong = false, color = '#1f2937') => (
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '14px 0', borderBottom: '2px dashed #f2c7bf' }}>
        <span style={{ fontSize: 32, color: '#4b5563', fontWeight: strong ? 700 : 400 }}>{k}</span>
        <span style={{ fontSize: 36, fontWeight: 700, color }}>{v}</span>
      </div>
    )

    const staffRows = Math.max(1, Math.ceil(staff.length / 3))
    const height =
      255 + 54 +                                   // header + checker
      230 +                                        // title + period
      220 +                                        // revenue / orders cards
      (d.cancelled ? 100 : 0) + 100 +              // average + cancelled rows
      (60 + 3 * 82 + 62) +                         // by channel
      (60 + 2 * 82) +                              // cash
      (60 + 78) +                                  // sources
      (60 + staffRows * 70 + 20) +                 // staff on duty
      (60 + Math.max(1, top.length) * 84 + 10) +   // top items
      (hasOpen ? 130 : 0) +
      140 + 54                                     // footer + checker

    return new ImageResponse(
      (
        <div style={{ height: '100%', width: '100%', display: 'flex', flexDirection: 'column', backgroundColor: '#ffffff', fontFamily: 'Poppins' }}>
          {/* Header, same as the order receipt */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', backgroundColor: RED, padding: '32px 44px', width: W }}>
            <div style={{ display: 'flex', width: 240 }} />
            <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center' }}>
              <img src={logo} alt="Fried King" style={{ width: 340, height: 190, objectFit: 'contain' }} />
            </div>
            <div style={{ display: 'flex', width: 240, justifyContent: 'flex-end', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', backgroundColor: '#ffffff', borderRadius: 999, padding: '10px 24px' }}>
                <span style={{ fontSize: 24, fontWeight: 700, color: RED, letterSpacing: 1.5, textTransform: 'uppercase' }}>{branchName}</span>
              </div>
            </div>
          </div>
          {checker(false)}

          <div style={{ display: 'flex', flexDirection: 'column', padding: '0 44px' }}>
            {/* Title */}
            <div style={{ display: 'flex', flexDirection: 'column', padding: '30px 0 22px', borderBottom: '2px dashed #f2b8ae' }}>
              <span style={{ fontSize: 50, fontWeight: 700, color: '#111827', letterSpacing: 2 }}>SHIFT CLOSING REPORT</span>
              <span style={{ fontSize: 28, color: RED, fontWeight: 700, marginTop: 8 }}>{d.label}</span>
              <span style={{ fontSize: 24, color: '#6b7280', marginTop: 4 }}>{d.period}</span>
            </div>

            {/* Revenue + orders */}
            <div style={{ display: 'flex', marginTop: 28 }}>
              <div style={{ display: 'flex', flexDirection: 'column', flex: 1, backgroundColor: RED, borderRadius: 24, padding: '22px 30px', marginRight: 18 }}>
                <span style={{ fontSize: 24, color: '#ffe4de', letterSpacing: 4, fontWeight: 700 }}>REVENUE</span>
                <span style={{ fontSize: 66, fontWeight: 700, color: '#ffffff', marginTop: 4 }}>{rs(d.revenue)}</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', width: 300, backgroundColor: '#111827', borderRadius: 24, padding: '22px 30px' }}>
                <span style={{ fontSize: 24, color: '#9ca3af', letterSpacing: 4, fontWeight: 700 }}>ORDERS</span>
                <span style={{ fontSize: 66, fontWeight: 700, color: '#ffffff', marginTop: 4 }}>{d.orders}</span>
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', marginTop: 12 }}>
              {row('Average order', rs(d.avg))}
              {row('Cancelled / declined', d.cancelled ? `${d.cancelled} · ${rs(d.cancelled_paise)}` : '0', false, d.cancelled ? '#b91c1c' : '#1f2937')}
            </div>

            {/* By channel */}
            {heading('By channel')}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 0', borderBottom: '2px solid #e5e7eb' }}>
              <span style={{ fontSize: 24, fontWeight: 700, color: '#9ca3af', letterSpacing: 1.5 }}>CHANNEL</span>
              <div style={{ display: 'flex' }}>
                <span style={{ fontSize: 24, fontWeight: 700, color: '#9ca3af', letterSpacing: 1.5, width: 160, justifyContent: 'flex-end', display: 'flex' }}>ORDERS</span>
                <span style={{ fontSize: 24, fontWeight: 700, color: '#9ca3af', letterSpacing: 1.5, width: 260, justifyContent: 'flex-end', display: 'flex' }}>REVENUE</span>
              </div>
            </div>
            {d.channels.map((c) => (
              <div key={c.label} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderBottom: '2px dashed #f2c7bf' }}>
                <span style={{ fontSize: 34, fontWeight: 600, color: '#111827' }}>{c.label}</span>
                <div style={{ display: 'flex', alignItems: 'center' }}>
                  <span style={{ fontSize: 34, color: '#374151', width: 160, justifyContent: 'flex-end', display: 'flex' }}>{c.n}</span>
                  <span style={{ fontSize: 36, fontWeight: 700, color: '#111827', width: 260, justifyContent: 'flex-end', display: 'flex' }}>{rs(c.paise)}</span>
                </div>
              </div>
            ))}

            {/* Cash */}
            {heading('Cash')}
            {row('Collected', rs(d.cash_collected), false, '#059669')}
            {row('Still to collect', rs(d.cash_pending), false, d.cash_pending ? '#b45309' : '#1f2937')}

            {/* Sources */}
            {heading('Where orders came from')}
            <div style={{ display: 'flex' }}>
              {[['WhatsApp', src.whatsapp ?? 0, '#16a34a'], ['Website', src.web ?? 0, '#1a5fa8'], ['POS', src.pos ?? 0, '#946000']].map(([k, v, c]) => (
                <div key={String(k)} style={{ display: 'flex', alignItems: 'center', backgroundColor: '#f9fafb', border: '2px solid #f3f4f6', borderRadius: 999, padding: '10px 26px', marginRight: 14 }}>
                  <span style={{ fontSize: 28, color: String(c), fontWeight: 700 }}>{k}</span>
                  <span style={{ fontSize: 30, color: '#111827', fontWeight: 700, marginLeft: 12 }}>{v}</span>
                </div>
              ))}
            </div>

            {/* Staff */}
            {heading('Staff on duty')}
            <div style={{ display: 'flex', flexWrap: 'wrap' }}>
              {staff.length ? staff.map((n) => (
                <div key={n} style={{ display: 'flex', backgroundColor: '#111827', borderRadius: 999, padding: '8px 24px', margin: '0 12px 12px 0' }}>
                  <span style={{ fontSize: 28, color: '#ffffff', fontWeight: 600 }}>{n}</span>
                </div>
              )) : <span style={{ fontSize: 30, color: '#9ca3af' }}>-</span>}
            </div>

            {/* Top items */}
            {heading('Top items')}
            {top.length ? top.map((t, i) => (
              <div key={`${t.name}-${i}`} style={{ display: 'flex', alignItems: 'center', padding: '14px 0', borderBottom: '2px dashed #f2c7bf' }}>
                <span style={{ fontSize: 28, color: '#9ca3af', width: 56, fontWeight: 700 }}>{i + 1}</span>
                <div style={{ display: 'flex', flexDirection: 'column', flex: 1 }}>
                  <span style={{ fontSize: 32, color: '#111827', fontWeight: 600 }}>{t.name}</span>
                  <div style={{ display: 'flex', height: 10, width: Math.max(24, Math.round((t.qty / maxQty) * 560)), backgroundColor: '#fca5a5', borderRadius: 6, marginTop: 6 }} />
                </div>
                <div style={{ display: 'flex', backgroundColor: '#f3f4f6', borderRadius: 10, padding: '6px 20px' }}>
                  <span style={{ fontSize: 34, fontWeight: 700, color: '#374151' }}>x{t.qty}</span>
                </div>
              </div>
            )) : <span style={{ fontSize: 30, color: '#9ca3af' }}>No orders in this period</span>}

            {hasOpen ? (
              <div style={{ display: 'flex', backgroundColor: '#fff7ed', border: '2px solid #ffedd5', borderRadius: 16, padding: '16px 26px', marginTop: 30 }}>
                <span style={{ fontSize: 28, color: '#c2410c', fontWeight: 700, marginRight: 10 }}>Still open:</span>
                <span style={{ fontSize: 28, color: '#7c2d12' }}>{d.open_new} waiting to be accepted, {d.open_kitchen} in the kitchen</span>
              </div>
            ) : null}
          </div>

          {/* Footer */}
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '30px 44px 18px' }}>
            <span style={{ fontSize: 24, color: '#6b7280' }}>Generated {d.generated}</span>
            <span style={{ fontSize: 22, color: '#9ca3af', marginTop: 14 }}>Developed by Loopdot</span>
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
        headers: { 'Cache-Control': 'no-store' },
      },
    )
  } catch (e) {
    console.error('[GET /api/shift-report]', e instanceof Error ? e.message : e)
    return new Response('Failed to generate the report', { status: 500 })
  }
}
