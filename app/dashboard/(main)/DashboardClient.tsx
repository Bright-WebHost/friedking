'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatPrice } from '@/lib/utils'

type Tab = 'orders' | 'menu'
type OrderStatus = 'pending' | 'confirmed' | 'preparing' | 'ready' | 'delivered' | 'cancelled'
type Order = {
  id: string
  order_number: number
  status: OrderStatus
  order_type: 'pickup' | 'delivery'
  total_paise: number
  delivery_address: string | null
  special_instructions: string | null
  created_at: string
  branch: { name: string; slug: string } | null
  customer: { name: string; phone: string } | null
  items: Array<{ name_snapshot: string; quantity: number; line_total_paise: number }>
}
type MenuItem = {
  id: string
  name: string
  description: string | null
  price_paise: number
  image_url: string | null
  is_veg: boolean
  is_active: boolean
}

const STATUSES: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled']

function labelStatus(status: OrderStatus) {
  return status.replace('_', ' ')
}

export default function DashboardClient({ branchSlug, tab }: { branchSlug: string | null; tab: Tab }) {
  return tab === 'orders' ? <OrdersBoard branchSlug={branchSlug} /> : <MenuBoard branchSlug={branchSlug} />
}

function OrdersBoard({ branchSlug }: { branchSlug: string | null }) {
  const [orders, setOrders] = useState<Order[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)

  const load = useCallback(async () => {
    const query = branchSlug ? `?branch=${encodeURIComponent(branchSlug)}` : ''
    const response = await fetch(`/api/dashboard/orders${query}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? 'Could not load orders')
    setOrders(data.orders)
    setError('')
  }, [branchSlug])

  useEffect(() => {
    setLoading(true)
    load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load orders')).finally(() => setLoading(false))
    const timer = window.setInterval(() => { load().catch(() => undefined) }, 10000)
    return () => window.clearInterval(timer)
  }, [load])

  const updateStatus = async (order: Order, status: OrderStatus) => {
    setUpdating(order.id)
    try {
      const response = await fetch('/api/dashboard/orders', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orderId: order.id, status }),
      })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message ?? 'Could not update order')
      setOrders((current) => current.map((item) => item.id === order.id ? { ...item, status } : item))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not update order')
    } finally {
      setUpdating(null)
    }
  }

  const groups = useMemo(() => STATUSES.map((status) => ({ status, orders: orders.filter((order) => order.status === status) })).filter((group) => group.orders.length), [orders])

  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-3">
        <div><h1 className="font-display text-3xl font-extrabold uppercase">Orders</h1><p className="text-sm text-fk-muted">Incoming orders refresh automatically.</p></div>
        <button onClick={() => void load()} className="rounded-lg border border-fk-line bg-white px-3 py-2 text-sm font-bold">Refresh</button>
      </div>
      {error && <p className="mb-4 rounded-xl bg-fk-tint px-3 py-2 text-sm font-medium text-fk-nonveg">{error}</p>}
      {loading ? <p className="text-sm text-fk-muted">Loading orders…</p> : groups.length === 0 ? <p className="rounded-2xl border border-dashed border-fk-line bg-white p-8 text-center text-sm text-fk-muted">No orders yet.</p> : (
        <div className="space-y-5">
          {groups.map((group) => (
            <div key={group.status}>
              <h2 className="mb-2 flex items-center gap-2 font-display text-xl font-extrabold uppercase"><span className="h-4 w-1.5 rounded-full bg-fk-red" />{labelStatus(group.status)} <span className="font-sans text-xs text-fk-muted">({group.orders.length})</span></h2>
              <div className="grid gap-3 lg:grid-cols-2">
                {group.orders.map((order) => <OrderCard key={order.id} order={order} updating={updating === order.id} onStatus={updateStatus} />)}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function OrderCard({ order, updating, onStatus }: { order: Order; updating: boolean; onStatus: (order: Order, status: OrderStatus) => Promise<void> }) {
  return (
    <article className="rounded-2xl border border-fk-line bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="font-display text-2xl font-extrabold">#{order.order_number}</h3><p className="text-xs text-fk-muted">{order.customer?.name ?? 'Guest'} · {order.customer?.phone ?? 'No phone'}</p></div>
        <span className="rounded-full bg-fk-yellow px-2.5 py-1 text-xs font-black uppercase">{order.order_type}</span>
      </div>
      <p className="mt-3 text-sm font-semibold">{order.items.map((item) => `${item.quantity} × ${item.name_snapshot}`).join(' · ')}</p>
      {order.delivery_address && <p className="mt-2 text-xs text-fk-muted">Deliver to: {order.delivery_address}</p>}
      {order.special_instructions && <p className="mt-2 rounded-lg bg-fk-bg px-2.5 py-2 text-xs text-fk-muted">Note: {order.special_instructions}</p>}
      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-fk-line pt-3">
        <span className="font-black">{formatPrice(order.total_paise)}</span>
        <select className="rounded-lg border border-fk-line px-2 py-2 text-xs font-bold capitalize outline-none focus:border-fk-red" value={order.status} disabled={updating} onChange={(event) => void onStatus(order, event.target.value as OrderStatus)}>
          {STATUSES.map((status) => <option key={status} value={status}>{labelStatus(status)}</option>)}
        </select>
      </div>
    </article>
  )
}

function MenuBoard({ branchSlug }: { branchSlug: string | null }) {
  const [items, setItems] = useState<MenuItem[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const query = branchSlug ? `?branch=${encodeURIComponent(branchSlug)}` : ''
    const response = await fetch(`/api/dashboard/menu${query}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? 'Could not load menu')
    setItems(data.items)
  }, [branchSlug])

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load menu')).finally(() => setLoading(false))
  }, [load])

  const toggle = async (item: MenuItem) => {
    const response = await fetch('/api/dashboard/menu', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId: item.id, isActive: !item.is_active }),
    })
    const data = await response.json()
    if (!response.ok) { setError(data.message ?? 'Could not update menu item'); return }
    setItems((current) => current.map((row) => row.id === item.id ? { ...row, is_active: !item.is_active } : row))
  }

  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-3"><div><h1 className="font-display text-3xl font-extrabold uppercase">Menu</h1><p className="text-sm text-fk-muted">Turn items on or off for customers.</p></div><button onClick={() => void load()} className="rounded-lg border border-fk-line bg-white px-3 py-2 text-sm font-bold">Refresh</button></div>
      {error && <p className="mb-4 rounded-xl bg-fk-tint px-3 py-2 text-sm font-medium text-fk-nonveg">{error}</p>}
      {loading ? <p className="text-sm text-fk-muted">Loading menu…</p> : <div className="overflow-hidden rounded-2xl border border-fk-line bg-white">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 border-b border-fk-line p-3 last:border-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.image_url ?? '/brand/mark-red.png'} alt="" className="h-14 w-14 rounded-lg object-cover" />
            <div className="min-w-0 flex-1"><p className="truncate font-bold">{item.name}</p><p className="text-xs text-fk-muted">{formatPrice(item.price_paise)}</p></div>
            <button onClick={() => void toggle(item)} className={`rounded-full px-3 py-1.5 text-xs font-black ${item.is_active ? 'bg-green-100 text-green-800' : 'bg-fk-tint text-fk-nonveg'}`}>{item.is_active ? 'Available' : 'Sold out'}</button>
          </div>
        ))}
      </div>}
    </section>
  )
}
