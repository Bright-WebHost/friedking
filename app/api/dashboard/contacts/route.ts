import { NextRequest, NextResponse } from 'next/server'
import { canAccessBranch, getStaffContext } from '@/lib/auth/staff'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  try {
    const branchSlug = req.nextUrl.searchParams.get('branch')?.trim().toLowerCase() || null
    const search = req.nextUrl.searchParams.get('q')?.trim().toLowerCase() || ''
    const admin = createAdminClient()

    let branchQuery = admin.from('branches').select('id, name, slug').eq('is_active', true)
    const { data: requestedBranch, error: branchError } = branchSlug
      ? await branchQuery.eq('slug', branchSlug).maybeSingle()
      : { data: null, error: null }
    if (branchError) throw branchError
    if (branchSlug && (!requestedBranch || !canAccessBranch(staff, requestedBranch.id))) {
      return NextResponse.json({ message: 'Branch access denied' }, { status: 403 })
    }

    const branchId = requestedBranch?.id ?? staff.branchId
    let customerQuery = admin
      .from('customers')
      .select('id, branch_id, name, phone, created_at, updated_at')
      .order('updated_at', { ascending: false })
      .limit(500)
    customerQuery = branchId ? customerQuery.eq('branch_id', branchId) : customerQuery
    const { data: customers, error: customerError } = search
      ? await customerQuery.or(`name.ilike.%${search}%,phone.ilike.%${search}%`)
      : await customerQuery
    if (customerError) throw customerError

    const customerRows = customers ?? []
    const customerIds = customerRows.map((customer) => customer.id)
    const [{ data: orders, error: ordersError }, { data: branches, error: branchesError }] = await Promise.all([
      customerIds.length
        ? admin.from('orders').select('id, customer_id, total_paise, status, created_at').in('customer_id', customerIds).order('created_at', { ascending: false })
        : Promise.resolve({ data: [], error: null }),
      admin.from('branches').select('id, name, slug').eq('is_active', true),
    ])
    if (ordersError || branchesError) throw ordersError ?? branchesError

    const branchById = new Map((branches ?? []).map((branch) => [branch.id, branch]))
    const ordersByCustomer = new Map<string, typeof orders>()
    for (const order of orders ?? []) {
      ordersByCustomer.set(order.customer_id, [...(ordersByCustomer.get(order.customer_id) ?? []), order])
    }

    const contacts = customerRows.map((customer) => {
      const customerOrders = ordersByCustomer.get(customer.id) ?? []
      return {
        ...customer,
        branch: branchById.get(customer.branch_id) ?? null,
        order_count: customerOrders.length,
        total_spent_paise: customerOrders.reduce((total, order) => total + order.total_paise, 0),
        last_order_at: customerOrders[0]?.created_at ?? null,
        last_order_status: customerOrders[0]?.status ?? null,
      }
    })

    return NextResponse.json({ contacts, total: contacts.length })
  } catch (error) {
    console.error('[GET /api/dashboard/contacts]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not load contacts' }, { status: 500 })
  }
}
