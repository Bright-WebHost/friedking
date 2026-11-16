import { randomBytes, randomInt } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getCustomerPhone } from '@/lib/customer/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { normalizePhone } from '@/lib/utils'
import { verificationEnabled } from '@/lib/verify'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const fail = (message: string, status = 400) => NextResponse.json({ message }, { status })

/** GET -> { enabled }: whether OTP verification is installed (checkout shows the OTP card or the old field). */
export async function GET() {
  try {
    return NextResponse.json({ enabled: await verificationEnabled(createAdminClient()) }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ enabled: false })
  }
}

/**
 * POST { phone? , linkToken?, useSession? } -> sends a 6-digit OTP to that WhatsApp number (through n8n)
 * and returns { secret, phoneMasked }. The number comes from the WhatsApp link or the login when there is one.
 */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}))
  try {
    const db = createAdminClient()
    if (!(await verificationEnabled(db))) return NextResponse.json({ enabled: false })

    let phone: string | null = null
    const token = String(b.linkToken ?? '')
    if (/^[0-9a-f]{32}$/.test(token)) {
      const { data } = await db.from('wa_links').select('phone').eq('token', token).gt('expires_at', new Date().toISOString()).maybeSingle()
      phone = data?.phone ?? null
    }
    if (!phone && b.useSession) phone = await getCustomerPhone()
    if (!phone) phone = normalizePhone(String(b.phone ?? ''))
    if (!phone) return fail('Enter a valid 10-digit mobile number.')

    // Limits: stops anyone from using the form to spam a number or run up WhatsApp costs.
    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim().slice(0, 64) || null
    const hourAgo = new Date(Date.now() - 3600000).toISOString()
    const { data: recent } = await db.from('wa_verifications').select('created_at').eq('phone', phone).gt('created_at', hourAgo).order('created_at', { ascending: false })
    if (recent?.length && Date.now() - new Date(recent[0].created_at).getTime() < 30000) return fail('Please wait 30 seconds before asking for another OTP.', 429)
    if ((recent?.length ?? 0) >= 5) return fail('Too many OTP requests for this number. Try again in an hour.', 429)
    if (ip) {
      const { count } = await db.from('wa_verifications').select('id', { count: 'exact', head: true }).eq('ip', ip).gt('created_at', hourAgo)
      if ((count ?? 0) >= 15) return fail('Too many OTP requests. Try again later.', 429)
    }

    const { data: cfg } = await db.from('branch_settings').select('key, value').in('key', ['otp_webhook_url', 'otp_template', 'otp_template_lang'])
    const setting = (k: string) => String(cfg?.find((r) => r.key === k)?.value ?? '')
    const url = setting('otp_webhook_url')
    if (!url) return fail('The OTP service is not connected yet. Please try again later.', 503)

    const otp = String(randomInt(0, 1000000)).padStart(6, '0')
    const secret = randomBytes(24).toString('hex')
    const { data: row, error } = await db.from('wa_verifications').insert({ secret, phone, otp, ip }).select('id').single()
    if (error || !row) throw new Error(error?.message ?? 'insert failed')

    let sent = false
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, otp, template: setting('otp_template') || 'friedking_otp', lang: setting('otp_template_lang') || 'en' }),
        signal: AbortSignal.timeout(12000),
      })
      const out = await res.json().catch(() => ({}))
      sent = res.ok && out.ok === true
    } catch { /* treated as not sent */ }
    if (!sent) {
      await db.from('wa_verifications').delete().eq('id', row.id)
      return fail('We could not send the OTP on WhatsApp. Check the number and try again.', 502)
    }
    return NextResponse.json({ enabled: true, secret, phoneMasked: `+91 ${phone.slice(3, 5)}•••••${phone.slice(-3)}` })
  } catch (e) {
    console.error('[verify/start]', e instanceof Error ? e.message : e)
    return fail('Could not send the OTP. Try again.', 500)
  }
}
