import { redirect } from 'next/navigation'
import { createAdminClient } from '@/lib/supabase/admin'
import { getStaffContext } from '@/lib/auth/staff'
import { SECTIONS } from '@/lib/dashboard/access'
import { secondaryBranches } from '@/lib/supabase/project'

/** /dashboard and old links like /dashboard/orders land on the staff member's branch. */
export async function redirectToBranch(section = 'orders'): Promise<never> {
  const staff = await getStaffContext()
  if (!staff) redirect('/dashboard/login?error=unauthorized')
  let q = createAdminClient().from('branches').select('slug').eq('is_active', true).order('name').limit(1)
  if (staff.branchId) q = createAdminClient().from('branches').select('slug').eq('id', staff.branchId).limit(1)
  for (const branch of secondaryBranches) q = q.neq('slug', branch)
  const { data } = await q
  const slug = data?.[0]?.slug
  if (!slug) redirect('/dashboard/login?error=unauthorized')
  const key = SECTIONS.some((s) => s.key === section) ? section : 'orders'
  redirect(`/dashboard/${slug}/${key}`)
}
