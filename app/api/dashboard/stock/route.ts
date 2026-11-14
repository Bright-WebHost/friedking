import { NextRequest, NextResponse } from 'next/server'
import { canAccessBranch, getStaffContext } from '@/lib/auth/staff'
import { createAdminClient } from '@/lib/supabase/admin'

async function branchFor(staffBranchId: string | null, slug: string | null) {
  const admin = createAdminClient()
  const query = admin.from('branches').select('id, name, slug').eq('is_active', true)
  const result = slug ? await query.eq('slug', slug).maybeSingle() : staffBranchId ? await query.eq('id', staffBranchId).maybeSingle() : { data: null, error: null }
  if (result.error) throw result.error
  return result.data
}

async function authorizedBranch(staffBranchId: string | null, slug: string | null) {
  const branch = await branchFor(staffBranchId, slug)
  return branch
}

export async function GET(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  try {
    const branchSlug = req.nextUrl.searchParams.get('branch')?.trim().toLowerCase() || null
    const branch = await authorizedBranch(staff.branchId, branchSlug)
    if (!branch || !canAccessBranch(staff, branch.id)) return NextResponse.json({ message: 'Branch access denied' }, { status: 403 })
    const { data, error } = await createAdminClient().from('stock_items').select('*').eq('branch_id', branch.id).eq('is_active', true).order('name')
    if (error) throw error
    return NextResponse.json({ branch, items: data ?? [] })
  } catch (error) {
    console.error('[GET /api/dashboard/stock]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not load stock' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  try {
    const body = await req.json() as { branch?: string; id?: string; name?: string; unit?: string; quantity?: number; reorderLevel?: number; costPaise?: number }
    const branch = await authorizedBranch(staff.branchId, body.branch?.trim().toLowerCase() || null)
    if (!branch || !canAccessBranch(staff, branch.id)) return NextResponse.json({ message: 'Branch access denied' }, { status: 403 })
    const name = String(body.name ?? '').trim().slice(0, 100)
    const unit = String(body.unit ?? 'unit').trim().slice(0, 30)
    const quantity = Number(body.quantity ?? 0)
    const reorderLevel = Number(body.reorderLevel ?? 0)
    const costPaise = Number(body.costPaise ?? 0)
    if (!name || !unit || ![quantity, reorderLevel, costPaise].every(Number.isFinite) || quantity < 0 || reorderLevel < 0 || costPaise < 0) {
      return NextResponse.json({ message: 'Name, unit, and valid non-negative values are required' }, { status: 400 })
    }
    const values = { branch_id: branch.id, name, unit, quantity, reorder_level: reorderLevel, cost_paise: Math.round(costPaise), is_active: true }
    const query = body.id
      ? createAdminClient().from('stock_items').update(values).eq('id', body.id).eq('branch_id', branch.id)
      : createAdminClient().from('stock_items').insert(values)
    const { data, error } = await query.select('*').single()
    if (error) throw error
    return NextResponse.json({ item: data }, { status: body.id ? 200 : 201 })
  } catch (error) {
    console.error('[POST /api/dashboard/stock]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not save stock item' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  try {
    const body = await req.json() as { id?: string }
    if (!body.id) return NextResponse.json({ message: 'Stock item id is required' }, { status: 400 })
    const admin = createAdminClient()
    const { data: item, error: itemError } = await admin.from('stock_items').select('id, branch_id').eq('id', body.id).maybeSingle()
    if (itemError) throw itemError
    if (!item || !canAccessBranch(staff, item.branch_id)) return NextResponse.json({ message: 'Stock access denied' }, { status: 403 })
    const { error } = await admin.from('stock_items').update({ is_active: false }).eq('id', item.id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[DELETE /api/dashboard/stock]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not remove stock item' }, { status: 500 })
  }
}
