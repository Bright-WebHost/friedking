import { createHash, createHmac, timingSafeEqual } from 'crypto'
import { cookies } from 'next/headers'

import { BANGALORE_BRANCH, isSecondaryBranch, secondaryBranch } from '@/lib/supabase/project'

const cookie = (branch?: string | null) => {
  const slug = secondaryBranch(branch)
  return slug === BANGALORE_BRANCH ? 'fk_cust_bangalore' : slug ? 'fk_cust_secondary' : 'fk_cust'
}

const secondarySigningKey = (branch?: string | null) => secondaryBranch(branch) === BANGALORE_BRANCH
  ? process.env.BANGALORE_CUSTOMER_SESSION_SECRET
  : process.env.KADRI_CUSTOMER_SESSION_SECRET
const DAYS = 30

// Signing key derives from the server-only service key, so no extra env var is needed.
const key = () => createHash('sha256').update('fk-customer-session:' + (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '')).digest()
const sign = (v: string, branch?: string | null) => {
  const signingKey = isSecondaryBranch(branch) ? secondarySigningKey(branch) : key()
  if (!signingKey) throw new Error('Customer session secret is missing')
  return createHmac('sha256', signingKey).update(v).digest('base64url')
}

/** Sets the login cookie for a verified phone (E.164). */
export async function setCustomerSession(phone: string, branch?: string | null) {
  const exp = Date.now() + DAYS * 86400000
  const v = `${phone}|${exp}`
  const jar = await cookies()
  jar.set(cookie(branch), `${Buffer.from(v).toString('base64url')}.${sign(v, branch)}`, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: DAYS * 86400,
  })
}

export async function clearCustomerSession(branch?: string | null) {
  const jar = await cookies()
  jar.delete(cookie(branch))
}

/** The logged-in customer's phone (E.164) or null. */
export async function getCustomerPhone(branch?: string | null): Promise<string | null> {
  const raw = (await cookies()).get(cookie(branch))?.value
  if (!raw) return null
  const [b, sig] = raw.split('.')
  if (!b || !sig) return null
  const v = Buffer.from(b, 'base64url').toString()
  if (isSecondaryBranch(branch) && !secondarySigningKey(branch)) return null
  const want = Buffer.from(sign(v, branch))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null
  const [phone, exp] = v.split('|')
  return /^\+91\d{10}$/.test(phone) && Number(exp) > Date.now() ? phone : null
}
