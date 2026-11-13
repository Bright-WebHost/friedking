export type OrderType = 'pickup' | 'delivery'
export type PaymentMethod = 'cash'

export interface Branch {
  id: string
  slug: string
  name: string
  address: string | null
  phone: string | null
  /** "12:00:00" (Postgres time) */
  opensAt: string | null
  closesAt: string | null
}

export interface MenuCategory {
  id: string
  name: string
}

export interface MenuItem {
  id: string
  name: string
  description: string | null
  /** Price in paise (Rs 1 = 100 paise) */
  pricePaise: number
  imageUrl: string | null
  isVeg: boolean
  categoryId: string
}

export interface CartItem {
  item: MenuItem
  quantity: number
}

export interface OrderTotals {
  subtotalPaise: number
  gstPaise: number
  totalPaise: number
}

/** What the browser sends to POST /api/order. Prices are NOT sent: the server reads them from the DB. */
export interface PlaceOrderPayload {
  branchSlug: string
  customerName: string
  customerPhone: string
  orderType: OrderType
  deliveryAddress: string | null
  paymentMethod: PaymentMethod
  specialInstructions: string | null
  idempotencyKey: string
  items: Array<{ itemId: string; quantity: number }>
}

export interface PlacedOrder {
  orderId: string
  orderNumber: number
  totalPaise: number
}
