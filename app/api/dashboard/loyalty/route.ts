import { NextRequest, NextResponse } from 'next/server'
import { canAccessBranch, getStaffContext } from '@/lib/auth/staff'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  try {
    const slug = req.nextUrl.searchParams.get('branch')?.trim().toLowerCase() || null
    const search = req.nextUrl.searchParams.get('q')?.trim().toLowerCase() || ''
    const admin = createAdminClient()
    const { data: branches, error: branchError } = await admin.from('branches').select('id, name, slug').eq('is_active', true)
    if (branchError) throw branchError
    const branch = slug ? (branches ?? []).find((item) => item.slug === slug) : staff.branchId ? (branches ?? []).find((item) => item.id === staff.branchId) : null
    if (slug && (!branch || !canAccessBranch(staff, branch.id))) return NextResponse.json({ message: 'Branch access denied' }, { status: 403 })
    const customerQuery = admin.from('customers').select('id, branch_id, name, phone, loyalty_accounts(id, points_balance, lifetime_points)').order('updated_at', { ascending: false }).limit(500)
    const scoped = branch ? customerQuery.eq('branch_id', branch.id) : staff.branchId ? customerQuery.eq('branch_id', staff.branchId) : customerQuery
    const { data: customers, error } = search ? await scoped.or(`name.ilike.%${search}%,phone.ilike.%${search}%`) : await scoped
    if (error) throw error
    return NextResponse.json({ customers: customers ?? [] })
  } catch (error) {
    console.error('[GET /api/dashboard/loyalty]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not load loyalty accounts' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  try {
    const body = await req.json() as { customerId?: string; points?: number; reason?: string }
    const points = Number(body.points)
    const reason = String(body.reason ?? '').trim().slice(0, 120)
    if (!body.customerId || !Number.isInteger(points) || points === 0 || !reason) return NextResponse.json({ message: 'Customer, non-zero points, and reason are required' }, { status: 400 })
    const admin = createAdminClient()
    const { data: customer, error: customerError } = await admin.from('customers').select('id, branch_id').eq('id', body.customerId).maybeSingle()
    if (customerError) throw customerError
    if (!customer || !canAccessBranch(staff, customer.branch_id)) return NextResponse.json({ message: 'Customer access denied' }, { status: 403 })
    const { data: account, error: accountError } = await admin.from('loyalty_accounts').upsert({ customer_id: customer.id }, { onConflict: 'customer_id' }).select('id, points_balance, lifetime_points').single()
    if (accountError || !account) throw accountError ?? new Error('Loyalty account creation failed')
    const nextBalance = Number(account.points_balance) + points
    if (nextBalance < 0) return NextResponse.json({ message: 'Points balance cannot be negative' }, { status: 400 })
    const { data: updated, error: updateError } = await admin.from('loyalty_accounts').update({ points_balance: nextBalance, lifetime_points: Number(account.lifetime_points) + Math.max(points, 0), updated_at: new Date().toISOString() }).eq('id', account.id).select('id, points_balance, lifetime_points').single()
    if (updateError || !updated) throw updateError ?? new Error('Loyalty account update failed')
    const { error: transactionError } = await admin.from('loyalty_transactions').insert({ account_id: account.id, points, reason, created_by: staff.userId })
    if (transactionError) throw transactionError
    return NextResponse.json({ account: updated })
  } catch (error) {
    console.error('[POST /api/dashboard/loyalty]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not update loyalty points' }, { status: 500 })
  }
}
