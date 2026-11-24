import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'
const NO_STORE = { 'Cache-Control': 'no-store' }

/**
 * GET ?secret=<48 hex> -> { verified, phoneMasked?, expired? }
 * The checkout polls this while the customer sends "VERIFY <code>" on WhatsApp. The secret is only known to that browser.
 */
export async function GET(req: NextRequest) {
  const secret = String(req.nextUrl.searchParams.get('secret') ?? '')
  if (!/^[0-9a-f]{48}$/.test(secret)) return NextResponse.json({ message: 'Bad request' }, { status: 400 })
  try {
    const db = createAdminClient()
    const { data: v } = await db.from('wa_verifications').select('phone, verified_at, consumed_at, created_at').eq('secret', secret).maybeSingle()
    if (!v) return NextResponse.json({ verified: false, expired: true }, { headers: NO_STORE })
    if (v.verified_at && v.phone && !v.consumed_at) {
      return NextResponse.json({ verified: true, phoneMasked: `+91 ${v.phone.slice(3, 5)}•••••${v.phone.slice(-3)}` }, { headers: NO_STORE })
    }
    const expired = !!v.consumed_at || Date.now() - new Date(v.created_at).getTime() > 15 * 60000
    return NextResponse.json({ verified: false, expired }, { headers: NO_STORE })
  } catch (e) {
    console.error('[verify/status]', e instanceof Error ? e.message : e)
    return NextResponse.json({ verified: false }, { headers: NO_STORE })
  }
}
