import { NextRequest, NextResponse } from 'next/server'
import { verificationEnabled } from '@/lib/verify'
import { deliveryFeeFor, loadDeliveryRules } from '@/lib/delivery'
import { findTable, openSession } from '@/lib/tables'
import { createAdminClient } from '@/lib/supabase/admin'
import { calcTotals, normalizePhone } from '@/lib/utils'
import type { PlaceOrderPayload, PlacedOrder } from '@/lib/types'

const MAX_QTY_PER_ITEM = 50
const MAX_ROUNDS_PER_TABLE = 40


/** Look up an unexpired WhatsApp link token (see wa_links in friedking_whatsapp_bot.sql). */
async function findLink(token: string) {
  const { data } = await createAdminClient().from('wa_links').select('phone, name').eq('token', token).gt('expires_at', new Date().toISOString()).maybeSingle()
  return data ? { phone: data.phone as string, name: (data.name as string | null) ?? '' } : null
}

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

  // A valid WhatsApp link token decides who is ordering; the browser cannot override the number.
  const linkToken = String(body.linkToken ?? '').trim()
  const link = /^[0-9a-f]{32}$/.test(linkToken) ? await findLink(linkToken) : null
  const isDineIn = body.orderType === 'dine-in'
  const tableNumber = Number(body.tableNumber)
  let phone = link ? link.phone : normalizePhone(String(body.customerPhone ?? ''))
  const verifySecret = /^[0-9a-f]{48}$/.test(String(body.verifySecret ?? '')) ? String(body.verifySecret) : ''
  const name = String((link?.name || body.customerName) ?? '').trim().slice(0, 80)
  const orderType = body.orderType
  const paymentMethod = body.paymentMethod
  const address = String(body.deliveryAddress ?? '').trim().slice(0, 400)
  const notes = String(body.specialInstructions ?? '').trim().slice(0, 400)
  const idempotencyKey = String(body.idempotencyKey ?? '').trim().slice(0, 100)
  const pincode = String(body.deliveryPincode ?? '').trim()
  const slug = String(body.branchSlug ?? '').trim().toLowerCase()

  if (!slug) return bad('Branch is required')
  if (!name) return bad('Please enter your name')
  if (orderType !== 'pickup' && orderType !== 'delivery' && orderType !== 'dine-in') return bad('Invalid order type')
  if (isDineIn && (!Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > 999)) return bad('Invalid table')
  if (!isDineIn && !phone && !verifySecret) return bad('Please enter a valid 10-digit mobile number')
  if (orderType === 'delivery' && pincode && !/^\d{6}$/.test(pincode)) return bad('Please enter a valid 6-digit pincode, or leave it blank')
  if (paymentMethod !== 'cash') return bad('Invalid payment method')
  if (orderType === 'delivery' && !address) return bad('Please enter your delivery address')
  if (!idempotencyKey) return bad('Invalid request')
  if (!Array.isArray(body.items) || body.items.length === 0) return bad('Your cart is empty')

  // Merge duplicate lines and validate quantities.
  const qtyById = new Map<string, number>()
  const noteById = new Map<string, string>()
  for (const line of body.items) {
    const qty = Number(line?.quantity)
    if (typeof line?.itemId !== 'string' || !Number.isInteger(qty) || qty < 1) return bad('Invalid cart')
    qtyById.set(line.itemId, (qtyById.get(line.itemId) ?? 0) + qty)
    const note = String(line?.note ?? '').trim().slice(0, 300)
    if (note) noteById.set(line.itemId, note)
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

    // WhatsApp link tokens already prove the phone. External website orders still require OTP.
    let verificationId: string | null = null
    if (!isDineIn && link) {
      phone = link.phone
    } else if (!isDineIn && await verificationEnabled(supabase)) {
      const { data: v } = verifySecret
        ? await supabase.from('wa_verifications').select('id, phone, verified_at, consumed_at').eq('secret', verifySecret).maybeSingle()
        : { data: null }
      if (!v || !v.verified_at || v.consumed_at || !v.phone) return bad('Please verify your WhatsApp number first.', 403)
      if (link && v.phone !== link.phone) return bad('Please verify from the same WhatsApp number you chatted with.', 403)
      phone = v.phone as string
      verificationId = v.id as string
    } else if (!phone && !isDineIn) {
      return bad('Please enter a valid 10-digit mobile number')
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

    // Branch rules from Dashboard > Settings: order types, delivery area, minimum order, delivery fee / free delivery.
    const rules = await loadDeliveryRules(supabase, branch.id)
    let deliveryFeePaise = 0
    if (orderType === 'pickup' && !rules.pickup) return bad('Takeaway is not available right now.')
    if (isDineIn && !rules.dineIn) return bad('Dine-in ordering is not available right now.')
    if (orderType === 'delivery') {
      if (!rules.delivery) return bad('Delivery is not available right now.')
      if (pincode && rules.pincodes.length && !rules.pincodes.some((p) => p.pincode === pincode)) return bad(`Sorry, we do not deliver to ${pincode} yet.`)
      if (totals.subtotalPaise < rules.minOrderPaise) return bad(`Minimum order for delivery is ₹${rules.minOrderPaise / 100}.`)
      deliveryFeePaise = deliveryFeeFor(rules, totals.subtotalPaise)
    }
    const grandTotalPaise = totals.totalPaise + deliveryFeePaise

    // Dine-in: attach to the open tab of the table (or open it). No OTP: the customer is sitting at the table.
    let sessionId: string | null = null
    if (isDineIn) {
      const table = await findTable(supabase, branch.id, tableNumber)
      if (!table) return bad(`Table ${tableNumber} was not found. Please ask the staff.`, 404)
      const open = await openSession(supabase, table.id)
      if (open) {
        const { count } = await supabase.from('orders').select('id', { count: 'exact', head: true }).eq('table_session_id', open.id)
        if ((count ?? 0) >= MAX_ROUNDS_PER_TABLE) return bad('This table has too many orders. Please ask the staff.', 429)
        const sessionPhone = open.phone ?? phone
        if (!open.phone || !open.customer_name) {
          await supabase.from('table_sessions').update({ phone: sessionPhone, customer_name: open.customer_name ?? name }).eq('id', open.id)
        }
        phone = sessionPhone
        sessionId = open.id
      } else {
        if (!phone) return bad('Please enter a valid 10-digit WhatsApp number. Your bill is sent there.')
        const { data: created, error: sessErr } = await supabase.from('table_sessions').insert({
          branch_id: branch.id, table_id: table.id, status: 'open', opened_by_name: 'Website', customer_name: name, phone,
        }).select('id').single()
        if (sessErr || !created) {
          // Someone opened the same table a moment ago: join that tab.
          const again = await openSession(supabase, table.id)
          if (!again) throw new Error(sessErr?.message ?? 'table session failed')
          sessionId = again.id
          phone = again.phone ?? phone
        } else sessionId = created.id
      }
      if (!phone) return bad('Please enter a valid 10-digit WhatsApp number. Your bill is sent there.')
    }

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
        total_paise: grandTotalPaise,
        order_type: orderType,
        payment_method: paymentMethod,
        delivery_address: orderType === 'delivery' ? address : null,
        delivery_pincode: orderType === 'delivery' ? pincode : null,
        ...(deliveryFeePaise > 0 ? { delivery_fee_paise: deliveryFeePaise } : {}),
        ...(isDineIn ? { table_session_id: sessionId, table_number: tableNumber } : {}),
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
        notes: noteById.get(l.id) ?? null,
      }))
    )
    if (linesErr) {
      // No transaction over REST: remove the empty order so the kitchen never sees it.
      await supabase.from('orders').delete().eq('id', order.id)
      throw new Error(linesErr.message)
    }

    // Outbox row: n8n picks this up and sends the WhatsApp confirmation.
    let tableRunningTotalPaise: number | null = null
    if (sessionId) {
      const { data: tableOrders, error: tableTotalError } = await supabase
        .from('orders').select('total_paise').eq('table_session_id', sessionId).neq('status', 'cancelled')
      if (tableTotalError) console.error('[POST /api/order] table total:', tableTotalError.message)
      else tableRunningTotalPaise = (tableOrders ?? []).reduce((sum, row) => sum + Number(row.total_paise ?? 0), 0)
    }

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
        // Added later (additive): pincode, delivery fee and table number. totalPaise includes the delivery fee.
        deliveryPincode: orderType === 'delivery' ? pincode : null,
        deliveryFeePaise,
        tableNumber: isDineIn ? tableNumber : null,
        specialInstructions: notes || null,
        items: lines.map((l) => ({ name: l.name, quantity: l.quantity, unitPricePaise: l.pricePaise })),
        ...totals,
        totalPaise: grandTotalPaise,
        ...(sessionId ? { customerNotification: { kind: 'table_round_added', windowOnly: true, tableNumber, roundTotalPaise: grandTotalPaise, tableRunningTotalPaise } } : {}),
      },
    })
    if (eventErr) console.error('[POST /api/order] order_events (order still placed):', eventErr.message)

    if (verificationId) await supabase.from('wa_verifications').update({ consumed_at: new Date().toISOString() }).eq('id', verificationId)

    const placed: PlacedOrder = { orderId: order.id, orderNumber: order.order_number, totalPaise: grandTotalPaise }
    return NextResponse.json(placed, { status: 201 })
  } catch (e) {
    console.error('[POST /api/order]', e instanceof Error ? e.message : e)
    return bad('Could not place your order. Please try again.', 500)
  }
}
