import type { SupabaseClient } from '@supabase/supabase-js'
import { getOrder, ordersHandler } from '@/lib/dashboard/handlers/orders'
import { check, HttpError, type Ctx } from '@/lib/dashboard/server'
import { normalizePhone } from '@/lib/utils'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Called by the authenticated n8n webhook after a rider taps Payment collected. */
export async function confirmRiderPayment(admin: SupabaseClient, input: {
  branchSlug?: unknown; riderPhone?: unknown; orderId?: unknown; messageId?: unknown
}) {
  const slug = String(input.branchSlug ?? 'pandeshwar').trim().toLowerCase()
  const phone = normalizePhone(String(input.riderPhone ?? ''))
  const orderId = String(input.orderId ?? '').trim()
  const messageId = String(input.messageId ?? '').trim().slice(0, 500)
  if (!phone || !/^[a-z0-9-]{1,80}$/.test(slug) || (orderId && !UUID.test(orderId)) || (!orderId && !messageId)) {
    throw new HttpError(400, 'Invalid rider payment confirmation')
  }

  const branch = check(await admin.from('branches').select('id, name, slug, address, phone, opens_at, closes_at')
    .eq('slug', slug).eq('is_active', true).maybeSingle(), 'load the branch')
  if (!branch) return { result: 'not_found' }
  const rider = check(await admin.from('riders').select('id, name')
    .eq('branch_id', branch.id).eq('phone', phone).maybeSingle(), 'load the rider')
  if (!rider) return { result: 'not_found' }

  let query = admin.from('orders').select('id').eq('branch_id', branch.id)
    .eq('rider_id', rider.id).eq('order_type', 'delivery')
  query = orderId ? query.eq('id', orderId) : query.eq('rider_wa_message_id', messageId)
  const matched = check(await query.maybeSingle(), 'find the delivery')
  if (!matched) return { result: 'not_found' }

  // The service-authenticated action uses the same completion, loyalty, outbox, and audit logic as staff.
  const ctx: Ctx = {
    admin, branch,
    staff: { userId: rider.id, name: `Rider ${rider.name} (WhatsApp)`, email: '', role: 'staff', branchId: branch.id },
  }
  let order = await getOrder(ctx, matched.id)
  if (order.rider_id !== rider.id) return { result: 'not_found' }
  if (order.status === 'cancelled') return { result: 'cancelled' }
  let result = order.status === 'delivered' && order.cash_collected ? 'already' : 'collected'
  if (result === 'collected') {
    try {
      await ordersHandler.actions!.done(ctx, { orderId: order.id, paymentCollected: true, sendInvoice: false, expectedRiderId: rider.id })
    } catch (error) {
      if (!(error instanceof HttpError) || error.status !== 409) throw error
      order = await getOrder(ctx, order.id)
      if (order.rider_id !== rider.id) return { result: 'not_found' }
      if (order.status !== 'delivered' || !order.cash_collected) throw error
      result = 'already'
    }
    order = await getOrder(ctx, order.id)
  }
  return {
    result,
    order: { order_number: `FK-${order.order_number}`, status: order.status, total: order.total_paise / 100, cash_amount: order.total_paise / 100 },
  }
}
