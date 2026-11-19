// Server-only: loyalty points for website checkout (/api/loyalty and /api/order).
import type { SupabaseClient } from '@supabase/supabase-js'

export interface LoyaltyOffer {
  available: boolean
  /** Points the customer holds. */
  balance: number
  /** Points usable on this cart (capped by the program's max % per order). */
  usablePoints: number
  /** Discount those points give, in paise. */
  usableValuePaise: number
  paisePerPoint: number
  maxRedeemPct: number
  currencyName: string
  programName: string
}

const NONE: LoyaltyOffer = { available: false, balance: 0, usablePoints: 0, usableValuePaise: 0, paisePerPoint: 0, maxRedeemPct: 0, currencyName: 'points', programName: '' }

/**
 * Balance and the most the customer can redeem on a food total (GST included, delivery fee excluded,
 * the same base the POS uses). Points are only ever looked up for a phone the server has verified.
 */
export async function loyaltyOffer(db: SupabaseClient, branchId: string, phone: string, foodTotalPaise: number): Promise<LoyaltyOffer & { customerId: string | null }> {
  const [{ data: program }, { data: customer }] = await Promise.all([
    db.from('loyalty_programs').select('name, currency_name, type, redemption_paise_per_point, max_redeem_pct_per_order, max_redeem_paise_per_day')
      .eq('branch_id', branchId).eq('is_active', true).maybeSingle(),
    db.from('customers').select('id').eq('branch_id', branchId).eq('phone', phone).maybeSingle(),
  ])
  if (!program || !customer || program.type === 'visit' || !(program.redemption_paise_per_point > 0)) return { ...NONE, customerId: customer?.id ?? null }
  const { data: account } = await db.from('loyalty_accounts').select('id, points_balance').eq('customer_id', customer.id).maybeSingle()
  const balance = Number(account?.points_balance ?? 0)
  const perPoint = Number(program.redemption_paise_per_point)
  const maxPct = Number(program.max_redeem_pct_per_order ?? 0)
  let maxPaise = Math.floor(Math.max(0, foodTotalPaise) * maxPct / 100)
  if (program.max_redeem_paise_per_day != null && account?.id) {
    const todayStart = new Date()
    todayStart.setHours(0, 0, 0, 0)
    const { data: todayTxns } = await db.from('loyalty_transactions')
      .select('points')
      .eq('account_id', account.id)
      .eq('type', 'redeem')
      .gte('created_at', todayStart.toISOString())
    const todayUsedPaise = (todayTxns ?? []).reduce((sum, t) => sum + Math.abs(t.points) * perPoint, 0)
    maxPaise = Math.min(maxPaise, Math.max(0, program.max_redeem_paise_per_day - todayUsedPaise))
  }
  // Whole rupees only (bills have no paise), so round the usable value down to a rupee.
  let usablePoints = Math.min(balance, Math.floor(maxPaise / perPoint))
  while (usablePoints > 0 && (usablePoints * perPoint) % 100 !== 0) usablePoints -= 1
  return {
    available: balance > 0,
    balance,
    usablePoints,
    usableValuePaise: usablePoints * perPoint,
    paisePerPoint: perPoint,
    maxRedeemPct: maxPct,
    currencyName: program.currency_name || 'points',
    programName: program.name || 'Fried King Rewards',
    customerId: customer.id,
  }
}

/** Phone proven by a WhatsApp link token, a verified (unused) OTP, or the signed login cookie. */
export async function verifiedPhone(db: SupabaseClient, opts: { linkToken?: string; verifySecret?: string; sessionPhone?: string | null }): Promise<string | null> {
  if (opts.linkToken && /^[0-9a-f]{32}$/.test(opts.linkToken)) {
    const { data } = await db.from('wa_links').select('phone').eq('token', opts.linkToken).gt('expires_at', new Date().toISOString()).maybeSingle()
    if (data?.phone) return data.phone as string
  }
  if (opts.verifySecret && /^[0-9a-f]{48}$/.test(opts.verifySecret)) {
    const { data } = await db.from('wa_verifications').select('phone, verified_at, consumed_at').eq('secret', opts.verifySecret).maybeSingle()
    if (data?.phone && data.verified_at && !data.consumed_at) return data.phone as string
  }
  return opts.sessionPhone ?? null
}

/** Give points back when an order that used them is cancelled. Safe to call twice (checks the ledger). */
export async function refundLoyalty(db: SupabaseClient, order: { id: string; order_number: number; customer_id: string; loyalty_points_redeemed?: number | null }, staff: string) {
  const points = Number(order.loyalty_points_redeemed ?? 0)
  if (points <= 0) return
  // Atomic version from friedking_whatsapp_loyalty.sql; the code below is the fallback until that file is run.
  const { error: rpcError } = await db.rpc('fk_loyalty_refund', { p_order: order.id, p_staff: staff })
  if (!rpcError) return
  const { data: account } = await db.from('loyalty_accounts').select('id, points_balance').eq('customer_id', order.customer_id).maybeSingle()
  if (!account) return
  const { data: moves } = await db.from('loyalty_transactions').select('points, type').eq('order_id', order.id).in('type', ['redeem', 'refund'])
  // Net redeemed for this order still outstanding (redeem rows are negative, refunds positive).
  const outstanding = -(moves ?? []).reduce((s, m) => s + Number(m.points), 0)
  const give = Math.min(points, outstanding)
  if (give <= 0) return
  const { data: updated, error } = await db.from('loyalty_accounts')
    .update({ points_balance: account.points_balance + give, updated_at: new Date().toISOString() })
    .eq('id', account.id).eq('points_balance', account.points_balance).select('points_balance').maybeSingle()
  if (error || !updated) { console.error('[loyalty] refund failed for order', order.order_number, error?.message ?? 'balance changed'); return }
  await db.from('loyalty_transactions').insert({
    account_id: account.id, points: give, reason: `Refund · order #${order.order_number} cancelled`, order_id: order.id,
    type: 'refund', balance_after: updated.points_balance, staff_name: staff,
  })
}
