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

export async function getStaffContext(): Promise<StaffContext | null> {
  const supabase = await createClient()
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
