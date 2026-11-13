import { createClient } from '@/lib/supabase/server'
import { createAdminClient } from '@/lib/supabase/admin'

export type StaffRole = 'owner' | 'manager' | 'staff'

export interface StaffContext {
  userId: string
  email: string
  branchId: string | null
  role: StaffRole
}

export async function getStaffContext(): Promise<StaffContext | null> {
  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  const user = userData.user
  if (!user) return null

  const { data: staff, error } = await createAdminClient()
    .from('staff')
    .select('user_id, branch_id, role')
    .eq('user_id', user.id)
    .maybeSingle()
  if (error || !staff || !['owner', 'manager', 'staff'].includes(staff.role)) return null

  return {
    userId: user.id,
    email: user.email ?? '',
    branchId: staff.branch_id,
    role: staff.role as StaffRole,
  }
}

export function canAccessBranch(staff: StaffContext, branchId: string) {
  return staff.branchId === null || staff.branchId === branchId
}
