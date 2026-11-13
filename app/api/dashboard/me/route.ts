import { NextResponse } from 'next/server'
import { canAccessBranch, getStaffContext } from '@/lib/auth/staff'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET() {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  const { data: branches, error } = await createAdminClient()
    .from('branches')
    .select('id, name, slug, is_active')
    .eq('is_active', true)
    .order('name')
  if (error) return NextResponse.json({ message: 'Could not load branches' }, { status: 500 })

  return NextResponse.json({
    staff,
    branches: (branches ?? []).filter((branch) => canAccessBranch(staff, branch.id)),
  })
}
