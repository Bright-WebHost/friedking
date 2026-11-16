import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { StaffRole } from '@/lib/dashboard/access'

export type { StaffRole }

export interface StaffContext {
  userId: string
  email: string
  /** Display name for "Order by …", audit log, receipts. Falls back to the email. */
  name: string
  branchId: string | null
  role: StaffRole
}

// A verified sign-in is remembered for 45 s per access token. The dashboard polls every few seconds, and without this
// every poll paid for an Auth round trip plus a staff lookup before doing any real work.
const TTL_MS = 45_000
const seen = new Map<string, { at: number; ctx: StaffContext }>()

export async function getStaffContext(): Promise<StaffContext | null> {
  const supabase = await createClient()
  // getSession only reads the cookie (no network); the token is used purely as a cache key, so a forged cookie never hits the cache.
  const { data: sess } = await supabase.auth.getSession()
  const token = sess.session?.access_token
  const hit = token ? seen.get(token) : undefined
  if (hit && Date.now() - hit.at < TTL_MS) return hit.ctx
  const ctx = await loadStaffContext(supabase)
  if (token && ctx) {
    if (seen.size > 200) for (const [k, v] of seen) if (Date.now() - v.at > TTL_MS) seen.delete(k)
    seen.set(token, { at: Date.now(), ctx })
  }
  return ctx
}

async function loadStaffContext(supabase: Awaited<ReturnType<typeof createClient>>): Promise<StaffContext | null> {
  const { data: userData } = await supabase.auth.getUser()
  const user = userData.user
  if (!user) return null

  // select('*') so this keeps working before the name/email/is_active columns exist.
  const { data: staff, error } = await createAdminClient()
    .from('staff')
    .select('*')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error || !staff || !['owner', 'manager', 'staff'].includes(staff.role)) return null

  const email = user.email ?? staff.email ?? ''
  return {
    userId: user.id,
    email,
    name: (staff.name as string | null)?.trim() || email.split('@')[0] || 'Staff',
    branchId: staff.branch_id,
    role: staff.role as StaffRole,
  }
}

export function canAccessBranch(staff: StaffContext, branchId: string) {
  return staff.branchId === null || staff.branchId === branchId
}
