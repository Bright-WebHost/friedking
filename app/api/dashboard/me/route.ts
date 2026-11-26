import { NextRequest, NextResponse } from 'next/server'
import { canAccessBranch, getStaffContext } from '@/lib/auth/staff'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSecondaryBranch } from '@/lib/supabase/project'

export async function GET(req: NextRequest) {
  const branchSlug = req.nextUrl.searchParams.get('branch')
  const staff = await getStaffContext(branchSlug)
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  const { data: branches, error } = await createAdminClient(branchSlug)
    .from('branches')
    .select('id, name, slug, is_active')
    .eq('is_active', true)
    .order('name')
  if (error) return NextResponse.json({ message: 'Could not load branches' }, { status: 500 })

  return NextResponse.json({
    staff,
    branches: (branches ?? []).filter((branch) => isSecondaryBranch(branch.slug) === isSecondaryBranch(branchSlug) && canAccessBranch(staff, branch.id)),
  })
}
