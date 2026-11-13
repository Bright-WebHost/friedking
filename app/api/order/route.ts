import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { calcTotals, normalizePhone } from '@/lib/utils'
import type { PlaceOrderPayload, PlacedOrder } from '@/lib/types'

const MAX_QTY_PER_ITEM = 50

function bad(message: string, status = 400) {
  return NextResponse.json({ message }, { status })
}

/**
 * POST /api/order
 * The browser sends item ids + quantities only. Names and prices are read
 * from the database here, so a tampered request cannot change what is charged.
 */
export async function POST(req: NextRequest) {
  let body: PlaceOrderPayload
  try {
    body = await req.json()
  } catch {
    return bad('Invalid request')
  }

  const name = String(body.customerName ?? '').trim().slice(0, 80)
  const phone = normalizePhone(String(body.customerPhone ?? ''))
  const orderType = body.orderType
  const paymentMethod = body.paymentMethod
  const address = String(body.deliveryAddress ?? '').trim().slice(0, 400)
  const notes = String(body.specialInstructions ?? '').trim().slice(0, 400)
  const idempotencyKey = String(body.idempotencyKey ?? '').trim().slice(0, 100)
  const slug = String(body.branchSlug ?? '').trim().toLowerCase()

  if (!slug) return bad('Branch is required')
  if (!name) return bad('Please enter your name')
  if (!phone) return bad('Please enter a valid 10-digit mobile number')
  if (orderType !== 'pickup' && orderType !== 'delivery') return bad('Invalid order type')
  if (paymentMethod !== 'cash') return bad('Invalid payment method')
  if (orderType === 'delivery' && !address) return bad('Please enter your delivery address')
  if (!idempotencyKey) return bad('Invalid request')
  if (!Array.isArray(body.items) || body.items.length === 0) return bad('Your cart is empty')

  // Merge duplicate lines and validate quantities.
  const qtyById = new Map<string, number>()
  for (const line of body.items) {
    const qty = Number(line?.quantity)
    if (typeof line?.itemId !== 'string' || !Number.isInteger(qty) || qty < 1) return bad('Invalid cart')
    qtyById.set(line.itemId, (qtyById.get(line.itemId) ?? 0) + qty)
  }
  for (const qty of qtyById.values()) {
    if (qty > MAX_QTY_PER_ITEM) return bad(`Maximum ${MAX_QTY_PER_ITEM} of one item per order`)
  }

  try {
    const supabase = createAdminClient()

    // Same submit sent twice (double tap, retry on a bad network) -> return the first order.
    const { data: dup } = await supabase
      .from('orders')
      .select('id, order_number, total_paise')
      .eq('idempotency_key', idempotencyKey)
      .maybeSingle()
    if (dup) {
      const placed: PlacedOrder = { orderId: dup.id, orderNumber: dup.order_number, totalPaise: dup.total_paise }
      return NextResponse.json(placed, { status: 200 })
    }

    const { data: branch } = await supabase
      .from('branches')
      .select('id, name')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle()
    if (!branch) return bad('Branch not found', 404)

    // Authoritative names + prices.
    const { data: dbItems, error: itemsErr } = await supabase
      .from('menu_items')
      .select('id, name, price_paise')
      .eq('branch_id', branch.id)
      .eq('is_active', true)
      .in('id', [...qtyById.keys()])
    if (itemsErr) throw new Error(itemsErr.message)
    if ((dbItems ?? []).length !== qtyById.size) {
      return bad('Some items are no longer available. Please refresh the menu.', 409)
    }

    const lines = dbItems!.map((i) => ({
      id: i.id as string,
      name: i.name as string,
      pricePaise: i.price_paise as number,
      quantity: qtyById.get(i.id)!,
    }))
    const totals = calcTotals(lines)

    // Customer is unique per (branch, phone).
    const { data: customer, error: custErr } = await supabase
      .from('customers')
      .upsert({ branch_id: branch.id, phone, name }, { onConflict: 'branch_id,phone' })
      .select('id')
      .single()
    if (custErr || !customer) throw new Error(custErr?.message ?? 'customer upsert failed')

    const { data: order, error: orderErr } = await supabase
      .from('orders')
      .insert({
        branch_id: branch.id,
        customer_id: customer.id,
        status: 'pending',
        subtotal_paise: totals.subtotalPaise,
        gst_paise: totals.gstPaise,
        total_paise: totals.totalPaise,
        order_type: orderType,
        payment_method: paymentMethod,
        delivery_address: orderType === 'delivery' ? address : null,
        special_instructions: notes || null,
        idempotency_key: idempotencyKey,
      })
      .select('id, order_number')
      .single()
    if (orderErr || !order) throw new Error(orderErr?.message ?? 'order insert failed')

    const { error: linesErr } = await supabase.from('order_items').insert(
      lines.map((l) => ({
        order_id: order.id,
        menu_item_id: l.id,
        name_snapshot: l.name,
        unit_price_paise: l.pricePaise,
        quantity: l.quantity,
        line_total_paise: l.pricePaise * l.quantity,
      }))
    )
    if (linesErr) {
      // No transaction over REST: remove the empty order so the kitchen never sees it.
      await supabase.from('orders').delete().eq('id', order.id)
      throw new Error(linesErr.message)
    }

    // Outbox row: n8n picks this up and sends the WhatsApp confirmation.
    const { error: eventErr } = await supabase.from('order_events').insert({
      order_id: order.id,
      branch_id: branch.id,
      event_type: 'order_created',
      payload: {
        orderId: order.id,
        orderNumber: order.order_number,
        branchSlug: slug,
        branchName: branch.name,
        customerName: name,
        customerPhone: phone,
        orderType,
        paymentMethod,
        deliveryAddress: orderType === 'delivery' ? address : null,
        specialInstructions: notes || null,
        items: lines.map((l) => ({ name: l.name, quantity: l.quantity, unitPricePaise: l.pricePaise })),
        ...totals,
      },
    })
    if (eventErr) console.error('[POST /api/order] order_events (order still placed):', eventErr.message)

    const placed: PlacedOrder = { orderId: order.id, orderNumber: order.order_number, totalPaise: totals.totalPaise }
    return NextResponse.json(placed, { status: 201 })
  } catch (e) {
    console.error('[POST /api/order]', e instanceof Error ? e.message : e)
    return bad('Could not place your order. Please try again.', 500)
  }
}
