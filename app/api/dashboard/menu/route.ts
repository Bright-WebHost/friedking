import { NextRequest, NextResponse } from 'next/server'
import { canAccessBranch, getStaffContext } from '@/lib/auth/staff'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  const slug = req.nextUrl.searchParams.get('branch')?.trim().toLowerCase() || null
  const admin = createAdminClient()
  let branchQuery = admin.from('branches').select('id, name, slug').eq('is_active', true)
  const { data: branch, error: branchError } = slug
    ? await branchQuery.eq('slug', slug).maybeSingle()
    : staff.branchId
      ? await branchQuery.eq('id', staff.branchId).maybeSingle()
      : { data: null, error: null }
  if (branchError) return NextResponse.json({ message: 'Could not load branch' }, { status: 500 })
  if (slug && (!branch || !canAccessBranch(staff, branch.id))) return NextResponse.json({ message: 'Branch access denied' }, { status: 403 })

  let query = admin.from('menu_items').select('id, branch_id, category_id, name, description, price_paise, image_url, is_veg, is_active, sort_order').order('sort_order')
  query = branch ? query.eq('branch_id', branch.id) : staff.branchId ? query.eq('branch_id', staff.branchId) : query
  const { data: items, error } = await query
  if (error) return NextResponse.json({ message: 'Could not load menu' }, { status: 500 })
  return NextResponse.json({ branch, items: items ?? [] })
}

export async function PATCH(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as { itemId?: string; isActive?: boolean }
    if (!body.itemId || typeof body.isActive !== 'boolean') {
      return NextResponse.json({ message: 'Invalid menu update' }, { status: 400 })
    }
    const admin = createAdminClient()
    const { data: item, error: itemError } = await admin.from('menu_items').select('id, branch_id').eq('id', body.itemId).maybeSingle()
    if (itemError) throw itemError
    if (!item || !canAccessBranch(staff, item.branch_id)) return NextResponse.json({ message: 'Menu access denied' }, { status: 403 })
    const { data: updated, error } = await admin.from('menu_items').update({ is_active: body.isActive }).eq('id', item.id).select('id, is_active').single()
    if (error) throw error
    return NextResponse.json({ item: updated })
  } catch (error) {
    console.error('[PATCH /api/dashboard/menu]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not update menu item' }, { status: 500 })
  }
}
