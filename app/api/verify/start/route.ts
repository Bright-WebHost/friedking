import { randomBytes, randomInt } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { getCustomerPhone } from '@/lib/customer/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSecondaryBranch } from '@/lib/supabase/project'
import { normalizePhone } from '@/lib/utils'
import { branchSlugOf, loadBranchVerifySettings, messageVerificationInstalled, verificationEnabled } from '@/lib/verify'

export const dynamic = 'force-dynamic'
export const maxDuration = 20

const fail = (message: string, status = 400) => NextResponse.json({ message }, { status })

// No 0/O/1/I: the code is read off a screen. Must stay 6 characters of A-Z0-9 (the WhatsApp bot matches exactly that).
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const newCode = () => Array.from({ length: 6 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('')

/**
 * GET ?branch=<slug> -> { enabled, otp, message }
 *  enabled: verification is installed (checkout shows the verification card, or the old plain field when false)
 *  otp:     this branch can send an OTP on WhatsApp (its Send OTP link is set; needs an approved template outside the 24 h window)
 *  message: this branch can verify by the customer sending a WhatsApp message (needs no template)
 */
export async function GET(req: NextRequest) {
  try {
    const slug = branchSlugOf(req.nextUrl.searchParams.get('branch'))
    const db = createAdminClient(slug)
    if (!(await verificationEnabled(db))) return NextResponse.json({ enabled: false }, { headers: { 'Cache-Control': 'no-store' } })
    const cfg = await loadBranchVerifySettings(db, slug)
    const message = !!cfg?.verifyByMessage && !!cfg?.whatsappNumber && (await messageVerificationInstalled(db))
    // 'only' hides the OTP completely (the branch's Send OTP link stays configured for later).
    return NextResponse.json({ enabled: true, otp: !!cfg?.otpWebhookUrl && !cfg?.messageOnly, message }, { headers: { 'Cache-Control': 'no-store' } })
  } catch {
    return NextResponse.json({ enabled: false })
  }
}

/**
 * POST { branch, mode?: 'otp' | 'message', phone?, linkToken?, useSession? }
 *  mode 'otp' (default): sends a 6-digit OTP to that WhatsApp number (through the branch's n8n Send OTP) -> { secret, phoneMasked }
 *  mode 'message':       no number needed; returns a short code and a wa.me link. The customer sends "VERIFY <code>" to the branch
 *                        number, the bot proves the number, and the browser polls /api/verify/status -> { secret, code, waLink, whatsapp }
 */
export async function POST(req: NextRequest) {
  const b = await req.json().catch(() => ({}))
  try {
    const slug = branchSlugOf(b.branch)
    const db = createAdminClient(slug)
    if (!(await verificationEnabled(db))) return NextResponse.json({ enabled: false })
    const cfg = await loadBranchVerifySettings(db, slug)
    if (!cfg) return fail('This branch is not available.', 404)

    const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim().slice(0, 64) || null
    const hourAgo = new Date(Date.now() - 3600000).toISOString()

    // ── Verify by sending a WhatsApp message (no template) ───────────────────────
    if (b.mode === 'message') {
      if (!cfg.verifyByMessage || !cfg.whatsappNumber) return fail('WhatsApp verification is not set up for this branch yet.', 503)
      if (!(await messageVerificationInstalled(db))) return fail('WhatsApp verification is not available yet. Please try again later.', 503)
      if (ip) {
        const { count } = await db.from('wa_verifications').select('id', { count: 'exact', head: true }).eq('ip', ip).gt('created_at', hourAgo)
        if ((count ?? 0) >= 15) return fail('Too many attempts. Try again later.', 429)
      }
      const secret = randomBytes(24).toString('hex')
      let code = ''
      for (let i = 0; i < 6 && !code; i++) {
        const c = newCode()
        const { data: clash } = await db.from('wa_verifications').select('id').eq('code', c).is('verified_at', null).gt('created_at', new Date(Date.now() - 16 * 60000).toISOString()).limit(1)
        if (!clash?.length) code = c
      }
      if (!code) return fail('Could not create a code. Try again.', 500)
      const { error } = await db.from('wa_verifications').insert({ secret, code, ip, branch_id: cfg.branch.id })
      if (error) throw new Error(error.message)
      return NextResponse.json({
        enabled: true, mode: 'message', secret, code,
        whatsapp: cfg.whatsappNumber,
        waLink: `https://wa.me/${cfg.whatsappNumber}?text=${encodeURIComponent(`VERIFY ${code}`)}`,
      })
    }

    // ── Verify with a WhatsApp OTP ───────────────────────────────────────────────
    let phone: string | null = null
    const token = String(b.linkToken ?? '')
    if (/^[0-9a-f]{32}$/.test(token)) {
      const { data } = await db.from('wa_links').select('phone').eq('token', token).gt('expires_at', new Date().toISOString()).maybeSingle()
      phone = data?.phone ?? null
    }
    if (!phone && b.useSession) phone = await getCustomerPhone(slug)
    if (!phone) phone = normalizePhone(String(b.phone ?? ''))
    if (!phone) return fail('Enter a valid 10-digit mobile number.')

    // Limits: stops anyone from using the form to spam a number or run up WhatsApp costs.
    const { data: recent } = await db.from('wa_verifications').select('created_at').eq('phone', phone).gt('created_at', hourAgo).order('created_at', { ascending: false })
    if (recent?.length && Date.now() - new Date(recent[0].created_at).getTime() < 30000) return fail('Please wait 30 seconds before asking for another OTP.', 429)
    if ((recent?.length ?? 0) >= 5) return fail('Too many OTP requests for this number. Try again in an hour.', 429)
    if (ip) {
      const { count } = await db.from('wa_verifications').select('id', { count: 'exact', head: true }).eq('ip', ip).gt('created_at', hourAgo)
      if ((count ?? 0) >= 15) return fail('Too many OTP requests. Try again later.', 429)
    }

    if (cfg.messageOnly) return fail('Please verify with the WhatsApp button.', 403)

    // This branch's own Send OTP link (each branch has its own WhatsApp number, so its own workflow).
    const url = cfg.otpWebhookUrl
    if (!url) return fail('OTP is not available for this branch. Please verify by WhatsApp message instead.', 503)

    const otp = String(randomInt(0, 1000000)).padStart(6, '0')
    const secret = randomBytes(24).toString('hex')
    const { data: row, error } = await db.from('wa_verifications').insert({ secret, phone, otp, ip, ...(isSecondaryBranch(slug) ? { branch_id: cfg.branch.id } : {}) }).select('id').single()
    if (error || !row) throw new Error(error?.message ?? 'insert failed')

    let sent = false
    let via = 'whatsapp'
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // n8n sends a normal WhatsApp text inside the 24 h window; outside it, an SMS when smsTemplateId is set, else the WhatsApp template.
        body: JSON.stringify({ phone, otp, template: cfg.otpTemplate, lang: cfg.otpTemplateLang, smsTemplateId: cfg.smsTemplateId || undefined }),
        signal: AbortSignal.timeout(12000),
      })
      const out = await res.json().catch(() => ({}))
      sent = res.ok && out.ok === true
      if (out.via === 'sms') via = 'sms'
    } catch { /* treated as not sent */ }
    if (!sent) {
      await db.from('wa_verifications').delete().eq('id', row.id)
      return fail('We could not send the OTP. Check the number, or verify by WhatsApp message instead.', 502)
    }
    return NextResponse.json({ enabled: true, mode: 'otp', via, secret, phoneMasked: `+91 ${phone.slice(3, 5)}•••••${phone.slice(-3)}` })
  } catch (e) {
    console.error('[verify/start]', e instanceof Error ? e.message : e)
    return fail('Could not start the verification. Try again.', 500)
  }
}
