import { NextRequest, NextResponse } from 'next/server'
import { canAccessBranch, getStaffContext } from '@/lib/auth/staff'
import { createAdminClient } from '@/lib/supabase/admin'

const STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled'] as const
type OrderStatus = (typeof STATUSES)[number]

async function getBranch(staffBranchId: string | null, slug: string | null) {
  const admin = createAdminClient()
  if (slug) {
    const { data, error } = await admin.from('branches').select('id, name, slug').eq('is_active', true).eq('slug', slug).maybeSingle()
    if (error) throw error
    return data
  }
  const { data, error } = await admin.from('branches').select('id, name, slug').eq('is_active', true)
  if (error) throw error
  return staffBranchId ? (data ?? []).find((branch) => branch.id === staffBranchId) ?? null : null
}

export async function GET(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  try {
    const branchSlug = req.nextUrl.searchParams.get('branch')?.trim().toLowerCase() || null
    const branch = await getBranch(staff.branchId, branchSlug)
    if (branchSlug && (!branch || !canAccessBranch(staff, branch.id))) {
      return NextResponse.json({ message: 'Branch access denied' }, { status: 403 })
    }

    const admin = createAdminClient()
    let orderQuery = admin
      .from('orders')
      .select('id, order_number, branch_id, customer_id, status, order_type, payment_method, subtotal_paise, gst_paise, total_paise, delivery_address, special_instructions, created_at')
      .order('created_at', { ascending: false })
      .limit(100)
    orderQuery = branch ? orderQuery.eq('branch_id', branch.id) : staff.branchId ? orderQuery.eq('branch_id', staff.branchId) : orderQuery
    const { data: orders, error } = await orderQuery
    if (error) throw error

    const orderRows = orders ?? []
    const orderIds = orderRows.map((order) => order.id)
    const customerIds = orderRows.map((order) => order.customer_id).filter(Boolean)
    const [{ data: customers, error: customerError }, { data: items, error: itemError }] = await Promise.all([
      customerIds.length ? admin.from('customers').select('id, name, phone').in('id', customerIds) : Promise.resolve({ data: [], error: null }),
      orderIds.length ? admin.from('order_items').select('order_id, name_snapshot, unit_price_paise, quantity, line_total_paise').in('order_id', orderIds) : Promise.resolve({ data: [], error: null }),
    ])
    if (customerError || itemError) throw customerError ?? itemError

    const customerById = new Map((customers ?? []).map((customer) => [customer.id, customer]))
    const itemsByOrder = new Map<string, typeof items>()
    for (const item of items ?? []) itemsByOrder.set(item.order_id, [...(itemsByOrder.get(item.order_id) ?? []), item])

    return NextResponse.json({
      orders: orderRows.map((order) => ({
        ...order,
        branch: branch ?? null,
        customer: customerById.get(order.customer_id) ?? null,
        items: itemsByOrder.get(order.id) ?? [],
      })),
    })
  } catch (error) {
    console.error('[GET /api/dashboard/orders]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not load orders' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as { orderId?: string; status?: string }
    const nextStatus = body.status as OrderStatus
    if (!body.orderId || !STATUSES.includes(nextStatus)) {
      return NextResponse.json({ message: 'Invalid order status update' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: order, error: orderError } = await admin
      .from('orders')
      .select('id, order_number, branch_id, status')
      .eq('id', body.orderId)
      .maybeSingle()
    if (orderError) throw orderError
    if (!order || !canAccessBranch(staff, order.branch_id)) return NextResponse.json({ message: 'Order access denied' }, { status: 403 })
    if (order.status === nextStatus) return NextResponse.json({ order })

    const { data: branch } = await admin.from('branches').select('slug').eq('id', order.branch_id).maybeSingle()
    const { data: updated, error: updateError } = await admin
      .from('orders')
      .update({ status: nextStatus })
      .eq('id', order.id)
      .eq('status', order.status)
      .select('id, order_number, branch_id, status')
      .single()
    if (updateError || !updated) throw updateError ?? new Error('Order changed before update')

    const { error: eventError } = await admin.from('order_events').insert({
      order_id: order.id,
      branch_id: order.branch_id,
      event_type: 'order_status_changed',
      payload: {
        orderId: order.id,
        orderNumber: order.order_number,
        branchSlug: branch?.slug ?? null,
        status: nextStatus,
        previousStatus: order.status,
      },
    })
    if (eventError) throw eventError

    return NextResponse.json({ order: updated })
  } catch (error) {
    console.error('[PATCH /api/dashboard/orders]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not update order status' }, { status: 500 })
  }
}
