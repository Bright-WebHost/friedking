import type { DOrder, OrderStatus } from './types'

/** Display-only totals. Actions on a table card must use its real rounds/session. */
export type BoardOrder = DOrder & { rounds?: DOrder[] }

export function tableOrderStatus(rounds: DOrder[]): OrderStatus {
  if (rounds.some((o) => o.status === 'pending')) return 'pending'
  if (rounds.some((o) => o.status === 'preparing' || o.status === 'confirmed')) return 'preparing'
  if (rounds.some((o) => o.status === 'ready')) return 'ready'
  return 'delivered'
}

export function buildOrderCards(orders: DOrder[]): BoardOrder[] {
  const sessions = new Map<string, DOrder[]>()
  const cards: BoardOrder[] = []
  for (const order of orders) {
    if (order.order_type !== 'dine-in' || !order.table_session_id || order.status === 'cancelled') {
      cards.push(order)
      continue
    }
    const rounds = sessions.get(order.table_session_id) ?? []
    rounds.push(order)
    sessions.set(order.table_session_id, rounds)
  }
  for (const rounds of sessions.values()) {
    rounds.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
    const sum = (key: 'total_paise' | 'subtotal_paise' | 'gst_paise' | 'discount_paise' | 'loyalty_discount_paise' | 'loyalty_points_redeemed') => rounds.reduce((total, o) => total + (o[key] ?? 0), 0)
    cards.push({
      ...rounds[0], rounds, status: tableOrderStatus(rounds),
      total_paise: sum('total_paise'), subtotal_paise: sum('subtotal_paise'), gst_paise: sum('gst_paise'),
      discount_paise: sum('discount_paise'), loyalty_discount_paise: sum('loyalty_discount_paise'), loyalty_points_redeemed: sum('loyalty_points_redeemed'),
      items: rounds.flatMap((o) => o.items), cash_collected: rounds.every((o) => o.cash_collected),
      cash_amount_paise: rounds.reduce((total, o) => total + (o.cash_amount_paise ?? 0), 0),
      updated_at: rounds.map((o) => o.updated_at).sort().at(-1)!,
      delivered_at: rounds.map((o) => o.delivered_at).filter((date): date is string => !!date).sort().at(-1) ?? null,
    })
  }
  return cards.sort((a, b) => b.created_at.localeCompare(a.created_at) || a.id.localeCompare(b.id))
}
