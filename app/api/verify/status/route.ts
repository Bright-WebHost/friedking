import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/** GET ?s=<secret> -> { verified, phoneMasked } */
export async function GET(req: NextRequest) {
  const s = req.nextUrl.searchParams.get('s') ?? ''
  if (!/^[0-9a-f]{48}$/.test(s)) return NextResponse.json({ verified: false })
  try {
    const { data } = await createAdminClient().from('wa_verifications').select('phone, verified_at, consumed_at, created_at').eq('secret', s).maybeSingle()
    const ok = !!data?.verified_at && !data.consumed_at && !!data.phone
    return NextResponse.json({ verified: ok, phoneMasked: ok ? `+91 ${data!.phone.slice(3, 5)}•••••${data!.phone.slice(-3)}` : null })
  } catch {
    return NextResponse.json({ verified: false })
  }
}
