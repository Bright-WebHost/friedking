import { NextRequest, NextResponse } from 'next/server'
import { canAccessBranch, getStaffContext } from '@/lib/auth/staff'
import { createAdminClient } from '@/lib/supabase/admin'
import { calcTotals, normalizePhone } from '@/lib/utils'

export async function POST(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as { branch?: string; customerName?: string; customerPhone?: string; items?: Array<{ itemId?: string; quantity?: number }> }
    const name = String(body.customerName ?? '').trim().slice(0, 80)
    const phone = normalizePhone(String(body.customerPhone ?? ''))
    const slug = String(body.branch ?? '').trim().toLowerCase()
    if (!name || !phone || !slug || !Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ message: 'Name, valid phone, branch, and items are required' }, { status: 400 })
    }

    const quantities = new Map<string, number>()
    for (const line of body.items) {
      const quantity = Number(line.quantity)
      if (typeof line.itemId !== 'string' || !Number.isInteger(quantity) || quantity < 1 || quantity > 50) {
        return NextResponse.json({ message: 'Invalid POS item quantity' }, { status: 400 })
      }
      quantities.set(line.itemId, (quantities.get(line.itemId) ?? 0) + quantity)
    }
    const admin = createAdminClient()
    const { data: branch, error: branchError } = await admin.from('branches').select('id, name, slug').eq('slug', slug).eq('is_active', true).maybeSingle()
    if (branchError) throw branchError
    if (!branch || !canAccessBranch(staff, branch.id)) return NextResponse.json({ message: 'Branch access denied' }, { status: 403 })

    const { data: dbItems, error: itemError } = await admin.from('menu_items').select('id, name, price_paise').eq('branch_id', branch.id).eq('is_active', true).in('id', [...quantities.keys()])
    if (itemError) throw itemError
    if ((dbItems ?? []).length !== quantities.size) return NextResponse.json({ message: 'Some items are unavailable' }, { status: 409 })
    const lines = (dbItems ?? []).map((item) => ({ id: item.id, name: item.name, pricePaise: item.price_paise, quantity: quantities.get(item.id)! }))
    const totals = calcTotals(lines)
    const { data: customer, error: customerError } = await admin.from('customers').upsert({ branch_id: branch.id, phone, name }, { onConflict: 'branch_id,phone' }).select('id').single()
    if (customerError || !customer) throw customerError ?? new Error('Customer creation failed')
    const { data: order, error: orderError } = await admin.from('orders').insert({
      branch_id: branch.id, customer_id: customer.id, status: 'pending', subtotal_paise: totals.subtotalPaise,
      gst_paise: totals.gstPaise, total_paise: totals.totalPaise, order_type: 'pickup', payment_method: 'cash',
      special_instructions: 'POS counter order', idempotency_key: `pos-${crypto.randomUUID()}`,
    }).select('id, order_number').single()
    if (orderError || !order) throw orderError ?? new Error('Order creation failed')
    const { error: lineError } = await admin.from('order_items').insert(lines.map((line) => ({
      order_id: order.id, menu_item_id: line.id, name_snapshot: line.name, unit_price_paise: line.pricePaise,
      quantity: line.quantity, line_total_paise: line.pricePaise * line.quantity,
    })))
    if (lineError) {
      await admin.from('orders').delete().eq('id', order.id)
      throw lineError
    }
    const { error: eventError } = await admin.from('order_events').insert({
      order_id: order.id, branch_id: branch.id, event_type: 'order_created',
      payload: { orderId: order.id, orderNumber: order.order_number, branchSlug: branch.slug, branchName: branch.name, customerName: name, customerPhone: phone, orderType: 'pickup', paymentMethod: 'cash', deliveryAddress: null, specialInstructions: 'POS counter order', items: lines.map((line) => ({ name: line.name, quantity: line.quantity, unitPricePaise: line.pricePaise })), ...totals },
    })
    if (eventError) console.error('[POST /api/dashboard/pos] order event:', eventError.message)
    return NextResponse.json({ orderId: order.id, orderNumber: order.order_number, totalPaise: totals.totalPaise }, { status: 201 })
  } catch (error) {
    console.error('[POST /api/dashboard/pos]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not create POS order' }, { status: 500 })
  }
}
