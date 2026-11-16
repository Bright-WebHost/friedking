import type { SupabaseClient } from '@supabase/supabase-js'

/** Delivery rules for one branch, read from Dashboard > Settings (branch_settings + delivery_pincodes). All money in paise. */
export interface DeliveryRules {
  pickup: boolean
  delivery: boolean
  dineIn: boolean
  /** Fee charged on delivery orders (0 = no fee). */
  feePaise: number
  minOrderPaise: number
  /** Delivery is free from this subtotal up. 0 = the offer is off (also off when the switch is off or there is no fee). */
  freeAbovePaise: number
  /** Active delivery pincodes. Empty = the branch has not restricted delivery. */
  pincodes: Array<{ pincode: string; area: string | null }>
}

const rupeesToPaise = (v: string | undefined) => Math.max(0, Math.round((Number(v) || 0) * 100))

/** True once friedking_delivery_fee.sql has been run (orders.delivery_fee_paise exists). Re-checked every minute while missing. */
let feeColumn: { ok: boolean; at: number } | null = null
async function feeColumnExists(db: SupabaseClient) {
  if (feeColumn && (feeColumn.ok || Date.now() - feeColumn.at < 60_000)) return feeColumn.ok
  const { error } = await db.from('orders').select('delivery_fee_paise').limit(1)
  feeColumn = { ok: !error, at: Date.now() }
  return feeColumn.ok
}

export async function loadDeliveryRules(db: SupabaseClient, branchId: string): Promise<DeliveryRules> {
  const [feeReady, { data: rows }, { data: pins }] = await Promise.all([
    feeColumnExists(db),
    db.from('branch_settings').select('key, value').eq('branch_id', branchId)
      .in('key', ['order_types', 'min_order', 'delivery_fee', 'free_delivery_enabled', 'free_delivery_above']),
    db.from('delivery_pincodes').select('pincode, area').eq('branch_id', branchId).eq('is_active', true).order('pincode'),
  ])
  const s = Object.fromEntries((rows ?? []).map((r) => [r.key as string, (r.value as string | null) ?? '']))
  const types = (s.order_types ?? 'Delivery, Pickup, Dine-in').toLowerCase()
  // Without the SQL the fee cannot be stored on the order, so it is not charged (and not shown) at all.
  const feePaise = feeReady ? rupeesToPaise(s.delivery_fee) : 0
  const freeOn = s.free_delivery_enabled === 'true'
  return {
    pickup: types.includes('pickup'),
    delivery: types.includes('delivery'),
    dineIn: types.includes('dine'),
    feePaise,
    minOrderPaise: rupeesToPaise(s.min_order),
    freeAbovePaise: freeOn && feePaise > 0 ? rupeesToPaise(s.free_delivery_above) : 0,
    pincodes: (pins ?? []).map((p) => ({ pincode: p.pincode as string, area: (p.area as string | null) ?? null })),
  }
}

/** Fee for a delivery order with this item subtotal. */
export function deliveryFeeFor(rules: DeliveryRules, subtotalPaise: number): number {
  if (rules.feePaise <= 0) return 0
  if (rules.freeAbovePaise > 0 && subtotalPaise >= rules.freeAbovePaise) return 0
  return rules.feePaise
}
