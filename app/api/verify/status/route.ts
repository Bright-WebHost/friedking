import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/** GET ?s=<secret> -> { sent, verified, phoneMasked }. sent = the WhatsApp message arrived (an OTP was replied). */
export async function GET(req: NextRequest) {
  const s = req.nextUrl.searchParams.get('s') ?? ''
  if (!/^[0-9a-f]{48}$/.test(s)) return NextResponse.json({ sent: false, verified: false })
  try {
    const { data } = await createAdminClient().from('wa_verifications').select('phone, otp, verified_at, consumed_at').eq('secret', s).maybeSingle()
    const has = !!data?.phone && !data.consumed_at
    return NextResponse.json({
      // old SQL (no otp column) verifies on the message itself, so verified alone is enough there
      sent: has && !!data!.otp,
      verified: has && !!data!.verified_at,
      phoneMasked: has ? `+91 ${data!.phone.slice(3, 5)}•••••${data!.phone.slice(-3)}` : null,
    })
  } catch {
    return NextResponse.json({ sent: false, verified: false })
  }
}
