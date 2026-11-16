import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'

const COOKIE = 'fk_cust'
const DAYS = 30

// Signing key derives from the server-only service key, so no extra env var is needed.
const key = () => createHash('sha256').update('fk-customer-session:' + (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '')).digest()
const sign = (v: string) => createHmac('sha256', key()).update(v).digest('base64url')

/** Sets the login cookie for a verified phone (E.164). */
export async function setCustomerSession(phone: string) {
  const exp = Date.now() + DAYS * 86400000
  const v = `${phone}|${exp}`
  const jar = await cookies()
  jar.set(COOKIE, `${Buffer.from(v).toString('base64url')}.${sign(v)}`, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: DAYS * 86400,
  })
}

export async function clearCustomerSession() {
  const jar = await cookies()
  jar.delete(COOKIE)
}

/** The logged-in customer's phone (E.164) or null. */
export async function getCustomerPhone(): Promise<string | null> {
  const raw = (await cookies()).get(COOKIE)?.value
  if (!raw) return null
  const [b, sig] = raw.split('.')
  if (!b || !sig) return null
  const v = Buffer.from(b, 'base64url').toString()
  const want = Buffer.from(sign(v))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  const [phone, exp] = v.split('|')
  return /^\+91\d{10}$/.test(phone) && Number(exp) > Date.now() ? phone : null
}
