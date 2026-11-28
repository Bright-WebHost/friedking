/** Row shapes the dashboard API returns (snake_case, straight from Postgres). */
import type { SettingKey } from './settings'
import type { StaffRole } from './access'

export type OrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'delivered' | 'cancelled'
export type OrderType = 'pickup' | 'delivery' | 'dine-in'

export interface DOrderItem {
  id: string
  menu_item_id: string | null
  name_snapshot: string
  unit_price_paise: number
  quantity: number
  line_total_paise: number
  notes: string | null
  menu_item?: { description: string | null } | null
}

export interface DOrder {
  id: string
  order_number: number
  token_number: number | null
  status: OrderStatus
  order_type: OrderType
  source: 'web' | 'pos' | 'whatsapp'
  payment_method: string
  subtotal_paise: number
  gst_paise: number
  total_paise: number
  discount_paise: number
  discount_reason: string | null
  loyalty_points_redeemed: number
  loyalty_discount_paise: number
  delivery_address: string | null
  delivery_pincode: string | null
  special_instructions: string | null
  created_at: string
  updated_at: string
  accepted_at: string | null
  accepted_by: string | null
  prep_minutes: number | null
  ready_at: string | null
  delivered_at: string | null
  cancelled_at: string | null
  cancelled_by: string | null
  cancel_reason: string | null
  taken_by: string | null
  rider_id: string | null
  rider_assigned_at: string | null
  cash_collected: boolean
  cash_amount_paise: number | null
  cash_collected_at: string | null
  payment_taken_by: string | null
  printed_at: string | null
  amendment_count: number
  table_session_id: string | null
  table_number: number | null
  customer_id: string
  customer: { id: string; name: string | null; phone: string } | null
  items: DOrderItem[]
}

export interface DBranch {
  id: string
  name: string
  slug: string
  address: string | null
  phone: string | null
  opens_at: string | null
  closes_at: string | null
}

export interface DRider { id: string; name: string; phone: string; is_active: boolean; created_at?: string }
export interface DRiderPayment { id: string; rider_id: string; amount_paise: number; note: string | null; received_by: string | null; created_at: string }

export interface DMeta {
  branch: DBranch
  settings: Record<SettingKey, string>
  staff: { name: string; email: string; role: StaffRole; branchId: string | null }
  riders: DRider[]
  serverTime: string
}

export interface DCategory { id: string; name: string; sort_order: number; is_active: boolean; image_url: string | null }

export interface DMenuItem {
  id: string
  category_id: string
  name: string
  description: string | null
  price_paise: number
  image_url: string | null
  is_veg: boolean
  is_active: boolean
  sort_order: number
  featured: boolean
  track_stock: boolean
  stock_qty: number
  low_stock_threshold: number | null
  par_level: number | null
  stock_updated_at: string | null
  stock_updated_by: string | null
}

export interface DIngredient {
  id: string
  name: string
  category: string | null
  unit: string
  quantity: number
  reorder_level: number | null
  par_level: number | null
  cost_paise: number | null
  track_stock: boolean
  nearest_expiry: string | null
  updated_at: string
  stock_updated_by: string | null
}

export interface DRecipeLine { id: string; menu_item_id: string; stock_item_id: string; qty_per_item: number }

export interface DMovement {
  id: string
  entity_type: 'menu_item' | 'ingredient'
  entity_id: string
  entity_name: string
  reason: string
  qty_change: number
  balance_after: number
  unit: string | null
  supplier_name: string | null
  cost_per_unit_paise: number | null
  note: string | null
  staff: string | null
  created_at: string
}

export interface DCustomer {
  id: string
  phone: string
  name: string | null
  created_at: string
  opted_out: boolean
  source: string
  total_orders: number
  last_order_at: string | null
  /** Promotions WhatsApp accepted for this contact (needs friedking_promo_stats.sql). */
  promo_count?: number
  last_promo_at?: string | null
  points_balance: number
  lifetime_points: number
  tier: string | null
}

export interface DProgram {
  id: string
  name: string
  currency_name: string
  type: 'points' | 'visit' | 'cashback'
  earn_rate_per_rupee: number
  earn_rate_per_visit: number
  redemption_paise_per_point: number
  min_spend_to_earn_paise: number
  max_redeem_pct_per_order: number
  max_redeem_paise_per_day: number | null
  points_expiry_days: number | null
  tiers: Array<{ name: string; min_lifetime_points: number; perk: string }>
}

export interface DTable { id: string; table_number: number; seats: number; section: string | null; sort_order: number }
export interface DSession {
  id: string
  table_id: string
  status: 'open' | 'closed'
  customer_name: string | null
  phone: string | null
  opened_at: string
  opened_by_name: string | null
}

export interface DExpense { id: string; expense_date: string; category: string; amount_paise: number; note: string | null; recorded_by: string | null }
