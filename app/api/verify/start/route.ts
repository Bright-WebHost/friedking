import { randomBytes, randomInt } from 'crypto'
import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { verificationEnabled } from '@/lib/verify'

export const dynamic = 'force-dynamic'
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'

/** POST -> { enabled, secret?, code?, waUrl? }. Starts a verification the customer finishes on WhatsApp. */
export async function POST() {
  try {
    const db = createAdminClient()
    if (!(await verificationEnabled(db))) return NextResponse.json({ enabled: false })
    const code = Array.from({ length: 6 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('')
    const secret = randomBytes(24).toString('hex')
    const { error } = await db.from('wa_verifications').insert({ code, secret })
    if (error) throw new Error(error.message)
    const { data } = await db.from('branch_settings').select('value').eq('key', 'whatsapp_number').limit(1).maybeSingle()
    const number = String(data?.value ?? '').replace(/\D/g, '') || '919742175222'
    const to = number.length === 10 ? '91' + number : number
    return NextResponse.json({ enabled: true, secret, code, waUrl: `https://wa.me/${to}?text=${encodeURIComponent('VERIFY ' + code)}` })
  } catch (e) {
    console.error('[verify/start]', e instanceof Error ? e.message : e)
    return NextResponse.json({ message: 'Could not start verification. Try again.' }, { status: 500 })
  }
}
