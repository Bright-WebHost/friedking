import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSecondaryBranch } from '@/lib/supabase/project'

export const dynamic = 'force-dynamic'
const bad = (message: string, status = 400) => NextResponse.json({ message }, { status })

/** POST { secret, otp } -> marks the verification as done when the OTP matches (5 tries). */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}))
  const secret = String(b.secret ?? '')
  const otp = String(b.otp ?? '').replace(/\D/g, '')
  if (!/^[0-9a-f]{48}$/.test(secret) || otp.length !== 6) return bad('Enter the 6-digit OTP')
  const branch = req.nextUrl.searchParams.get('branch')
  try {
    const db = createAdminClient(branch)
    const { data: v } = await db.from('wa_verifications').select('id, phone, otp, otp_attempts, verified_at, consumed_at, created_at').eq('secret', secret).maybeSingle()
    if (!v || !v.phone || v.consumed_at) return bad('Send the WhatsApp message first.')
    if (v.verified_at && !isSecondaryBranch(branch)) return NextResponse.json({ verified: true })
    if (Date.now() - new Date(v.created_at).getTime() > 30 * 60000) return bad('This OTP has expired. Start again.', 410)
    if (v.verified_at) return NextResponse.json({ verified: true })
    if ((v.otp_attempts ?? 0) >= 5) return bad('Too many wrong tries. Start again.', 429)
    if (v.otp !== otp) {
      await db.from('wa_verifications').update({ otp_attempts: (v.otp_attempts ?? 0) + 1 }).eq('id', v.id)
      return bad('That OTP is not correct.')
    }
    await db.from('wa_verifications').update({ verified_at: new Date().toISOString() }).eq('id', v.id)
    return NextResponse.json({ verified: true })
  } catch (e) {
    console.error('[verify/confirm]', e instanceof Error ? e.message : e)
    return bad('Could not check the OTP. Try again.', 500)
  }
}
