import { NextRequest, NextResponse } from 'next/server'
import { canAccessBranch, getStaffContext } from '@/lib/auth/staff'
import { createAdminClient } from '@/lib/supabase/admin'

async function getBranch(staffBranchId: string | null, slug: string | null) {
  const admin = createAdminClient()
  const query = admin.from('branches').select('id, name, slug, address, phone, opens_at, closes_at').eq('is_active', true)
  return slug ? query.eq('slug', slug).maybeSingle() : staffBranchId ? query.eq('id', staffBranchId).maybeSingle() : Promise.resolve({ data: null, error: null })
}

export async function GET(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  try {
    const slug = req.nextUrl.searchParams.get('branch')?.trim().toLowerCase() || null
    const { data: branch, error } = await getBranch(staff.branchId, slug)
    if (error) throw error
    if (!branch || !canAccessBranch(staff, branch.id)) return NextResponse.json({ message: 'Branch access denied' }, { status: 403 })
    return NextResponse.json({ branch, role: staff.role })
  } catch (error) {
    console.error('[GET /api/dashboard/settings]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not load settings' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  if (staff.role === 'staff') return NextResponse.json({ message: 'Only managers can update settings' }, { status: 403 })
  try {
    const body = await req.json() as { branch?: string; name?: string; address?: string | null; phone?: string | null; opensAt?: string | null; closesAt?: string | null }
    const { data: branch, error: branchError } = await getBranch(staff.branchId, body.branch?.trim().toLowerCase() || null)
    if (branchError) throw branchError
    if (!branch || !canAccessBranch(staff, branch.id)) return NextResponse.json({ message: 'Branch access denied' }, { status: 403 })
    const updates = {
      name: typeof body.name === 'string' ? body.name.trim().slice(0, 100) : branch.name,
      address: body.address === null ? null : typeof body.address === 'string' ? body.address.trim().slice(0, 300) : branch.address,
      phone: body.phone === null ? null : typeof body.phone === 'string' ? body.phone.trim().slice(0, 30) : branch.phone,
      opens_at: body.opensAt ?? branch.opens_at,
      closes_at: body.closesAt ?? branch.closes_at,
    }
    if (!updates.name) return NextResponse.json({ message: 'Branch name is required' }, { status: 400 })
    const { data: updated, error } = await createAdminClient().from('branches').update(updates).eq('id', branch.id).select('id, name, slug, address, phone, opens_at, closes_at').single()
    if (error) throw error
    return NextResponse.json({ branch: updated })
  } catch (error) {
    console.error('[PATCH /api/dashboard/settings]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not update settings' }, { status: 500 })
  }
}
