'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatPrice } from '@/lib/utils'

type Tab = 'orders' | 'tables' | 'menu'
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
  category_id: string
}
type MenuCategory = { id: string; name: string; is_active: boolean }

const STATUSES: OrderStatus[] = ['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled']

function labelStatus(status: OrderStatus) {
  return status.replace('_', ' ')
}

export default function DashboardClient({ branchSlug, tab }: { branchSlug: string | null; tab: Tab }) {
  if (tab === 'orders') return <OrdersBoard branchSlug={branchSlug} />
  if (tab === 'tables') return <TablesBoard branchSlug={branchSlug} />
  return <MenuBoard branchSlug={branchSlug} />
}

function OrdersBoard({ branchSlug }: { branchSlug: string | null }) {
  const [orders, setOrders] = useState<Order[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [updating, setUpdating] = useState<string | null>(null)
  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all')
  const [typeFilter, setTypeFilter] = useState<'all' | Order['order_type']>('all')
  const [query, setQuery] = useState('')

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

  const filteredOrders = useMemo(() => orders.filter((order) => {
    const text = `${order.order_number} ${order.customer?.name ?? ''} ${order.customer?.phone ?? ''}`.toLowerCase()
    return (statusFilter === 'all' || order.status === statusFilter) &&
      (typeFilter === 'all' || order.order_type === typeFilter) &&
      (!query.trim() || text.includes(query.trim().toLowerCase()))
  }), [orders, statusFilter, typeFilter, query])
  const groups = useMemo(() => [
    { key: 'preparing', label: 'Preparing', orders: filteredOrders.filter((order) => ['pending', 'confirmed', 'preparing'].includes(order.status)) },
    { key: 'ready', label: 'Ready', orders: filteredOrders.filter((order) => order.status === 'ready') },
    { key: 'done', label: 'Done', orders: filteredOrders.filter((order) => order.status === 'delivered') },
  ], [filteredOrders])

  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-3">
        <div><h1 className="dashboard-display text-3xl font-bold">Orders</h1><p className="text-sm text-fk-muted">Incoming orders refresh automatically.</p></div>
        <button onClick={() => void load()} className="rounded-[9px] border border-[#e6e9ee] bg-white px-3 py-2 text-sm font-bold">↻ Refresh</button>
      </div>
      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Summary label="Total" value={orders.length} tone="red" />
        <Summary label="Pending" value={orders.filter((order) => order.status === 'pending').length} tone="orange" />
        <Summary label="Preparing" value={orders.filter((order) => order.status === 'preparing').length} tone="blue" />
        <Summary label="Ready" value={orders.filter((order) => order.status === 'ready').length} tone="purple" />
      </div>
      <div className="mb-5 grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search order, customer or phone" className="rounded-xl border border-fk-line bg-white px-3 py-2 text-sm outline-none focus:border-fk-red" />
        <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as typeof statusFilter)} className="rounded-xl border border-fk-line bg-white px-3 py-2 text-sm font-semibold capitalize outline-none focus:border-fk-red"><option value="all">All statuses</option>{STATUSES.map((status) => <option key={status} value={status}>{labelStatus(status)}</option>)}</select>
        <select value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as typeof typeFilter)} className="rounded-xl border border-fk-line bg-white px-3 py-2 text-sm font-semibold capitalize outline-none focus:border-fk-red"><option value="all">All types</option><option value="pickup">Pickup</option><option value="delivery">Delivery</option></select>
      </div>
      {error && <p className="mb-4 rounded-xl bg-fk-tint px-3 py-2 text-sm font-medium text-fk-nonveg">{error}</p>}
      {loading ? <p className="text-sm text-fk-muted">Loading orders…</p> : filteredOrders.length === 0 ? <p className="rounded-2xl border border-dashed border-fk-line bg-white p-8 text-center text-sm text-fk-muted">No orders yet.</p> : (
        <div className="dashboard-board">
          {groups.map((group) => (
            <div key={group.key} className={`dashboard-column ${group.key}`}>
              <div className="dashboard-column-head"><span>{group.label}</span><span className="count">{group.orders.length}</span></div>
              {group.orders.map((order) => <OrderCard key={order.id} order={order} updating={updating === order.id} onStatus={updateStatus} />)}
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

function Summary({ label, value, tone }: { label: string; value: number; tone: 'red' | 'orange' | 'blue' | 'purple' }) {
  return <div className={`dashboard-stat ${tone}`}><span>{label}</span><b>{value}</b></div>
}

type TableRow = {
  id: string
  table_number: number
  seats: number
  session: { id: string; opened_at: string } | null
}

function TablesBoard({ branchSlug }: { branchSlug: string | null }) {
  const [tables, setTables] = useState<TableRow[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [seats, setSeats] = useState('4')

  const load = useCallback(async () => {
    const query = branchSlug ? `?branch=${encodeURIComponent(branchSlug)}` : ''
    const response = await fetch(`/api/dashboard/tables${query}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? 'Could not load tables')
    setTables(data.tables)
    setError('')
  }, [branchSlug])

  useEffect(() => {
    load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load tables')).finally(() => setLoading(false))
  }, [load])

  const act = async (tableId: string, action: 'open' | 'close') => {
    const response = await fetch('/api/dashboard/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: branchSlug, tableId, action }),
    })
    const data = await response.json()
    if (!response.ok) { setError(data.message ?? 'Could not update table'); return }
    await load()
  }

  const addTable = async () => {
    const response = await fetch('/api/dashboard/tables', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ branch: branchSlug, action: 'create', seats: Number(seats) }),
    })
    const data = await response.json()
    if (!response.ok) { setError(data.message ?? 'Could not add table'); return }
    await load()
  }

  return <section>
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div><h1 className="font-display text-3xl font-extrabold uppercase">Tables</h1><p className="text-sm text-fk-muted">Manage dine-in tables separately from incoming orders.</p></div>
      <div className="flex items-center gap-2"><select value={seats} onChange={(event) => setSeats(event.target.value)} className="rounded-lg border border-fk-line bg-white px-2 py-2 text-sm"><option value="2">2 seats</option><option value="4">4 seats</option><option value="6">6 seats</option><option value="8">8 seats</option></select><button onClick={() => void addTable()} className="rounded-lg bg-fk-red px-3 py-2 text-sm font-bold text-white">+ Add table</button></div>
    </div>
    {error && <p className="mb-4 rounded-xl bg-fk-tint px-3 py-2 text-sm font-medium text-fk-nonveg">{error}</p>}
    {loading ? <p className="text-sm text-fk-muted">Loading tables…</p> : <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {tables.map((table) => <article key={table.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${table.session ? 'border-fk-red' : 'border-fk-line'}`}>
        <div className="flex items-start justify-between"><div><p className="font-display text-2xl font-extrabold">Table {table.table_number}</p><p className="text-sm text-fk-muted">{table.seats} seats</p></div><span className={`rounded-full px-2 py-1 text-xs font-black uppercase ${table.session ? 'bg-fk-tint text-fk-red' : 'bg-green-100 text-green-800'}`}>{table.session ? 'Occupied' : 'Available'}</span></div>
        <p className="mt-4 text-sm text-fk-muted">{table.session ? `Opened ${new Date(table.session.opened_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : 'No open dine-in session'}</p>
        <button onClick={() => void act(table.id, table.session ? 'close' : 'open')} className={`mt-4 w-full rounded-lg px-3 py-2 text-sm font-bold ${table.session ? 'border border-fk-line bg-white' : 'bg-fk-red text-white'}`}>{table.session ? 'Close table' : 'Start dine-in session'}</button>
      </article>)}
      {!tables.length && <p className="col-span-full rounded-2xl border border-dashed border-fk-line bg-white p-8 text-center text-sm text-fk-muted">No tables configured. Run the tables migration first.</p>}
    </div>}
  </section>
}

function OrderCard({ order, updating, onStatus }: { order: Order; updating: boolean; onStatus: (order: Order, status: OrderStatus) => Promise<void> }) {
  return (
    <article className="dashboard-order-card">
      <div className="flex items-start justify-between gap-3">
        <div><h3 className="text-[15px] font-extrabold">#{order.order_number}</h3><p className="mt-0.5 text-xs text-fk-muted">{order.customer?.name ?? 'Guest'} · {order.customer?.phone ?? 'No phone'}</p></div>
        <span className="rounded-md bg-[#fff6e6] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[#9a6b00]">{order.order_type}</span>
      </div>
      <p className="mt-2 text-[13px] leading-5">{order.items.map((item) => `${item.quantity} × ${item.name_snapshot}`).join(' · ')}</p>
      {order.delivery_address && <p className="mt-1.5 text-xs text-fk-muted">Deliver to: {order.delivery_address}</p>}
      {order.special_instructions && <p className="mt-2 rounded-md bg-[#f1f3f6] px-2 py-1.5 text-xs text-fk-muted">Note: {order.special_instructions}</p>}
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[#e6e9ee] pt-3">
        <span className="font-black">{formatPrice(order.total_paise)}</span>
        <select className="rounded-lg border border-[#e6e9ee] px-2 py-1.5 text-xs font-bold capitalize outline-none focus:border-fk-red" value={order.status} disabled={updating} onChange={(event) => void onStatus(order, event.target.value as OrderStatus)}>
          {STATUSES.map((status) => <option key={status} value={status}>{labelStatus(status)}</option>)}
        </select>
      </div>
    </article>
  )
}

function MenuBoard({ branchSlug }: { branchSlug: string | null }) {
  const [items, setItems] = useState<MenuItem[]>([])
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)

  const load = useCallback(async () => {
    const query = branchSlug ? `?branch=${encodeURIComponent(branchSlug)}` : ''
    const response = await fetch(`/api/dashboard/menu${query}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? 'Could not load menu')
    setItems(data.items)
    setCategories(data.categories ?? [])
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

  const save = async (item: MenuItem, form: HTMLFormElement) => {
    const data = new FormData(form)
    const price = Number(data.get('price'))
    const image = data.get('image')
    setSaving(item.id)
    try {
      const response = await fetch('/api/dashboard/menu', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          itemId: item.id,
          name: String(data.get('name') ?? ''),
          description: String(data.get('description') ?? ''),
          pricePaise: Math.round(price * 100),
          categoryId: String(data.get('categoryId') ?? ''),
        }),
      })
      const result = await response.json()
      if (!response.ok) throw new Error(result.message ?? 'Could not save menu item')
      let updatedItem = result.item
      if (image instanceof File && image.size > 0) {
        const upload = new FormData()
        upload.set('itemId', item.id)
        upload.set('image', image)
        const uploadResponse = await fetch('/api/dashboard/menu', { method: 'POST', body: upload })
        const uploadResult = await uploadResponse.json()
        if (!uploadResponse.ok) throw new Error(uploadResult.message ?? 'Could not upload menu image')
        updatedItem = uploadResult.item
      }
      setItems((current) => current.map((row) => row.id === item.id ? { ...row, ...updatedItem } : row))
      setEditing(null)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save menu item')
    } finally {
      setSaving(null)
    }
  }

  return (
    <section>
      <div className="mb-5 flex items-end justify-between gap-3"><div><h1 className="font-display text-3xl font-extrabold uppercase">Menu</h1><p className="text-sm text-fk-muted">Edit item details, prices, categories, and availability.</p></div><button onClick={() => void load()} className="rounded-lg border border-fk-line bg-white px-3 py-2 text-sm font-bold">Refresh</button></div>
      {error && <p className="mb-4 rounded-xl bg-fk-tint px-3 py-2 text-sm font-medium text-fk-nonveg">{error}</p>}
      {loading ? <p className="text-sm text-fk-muted">Loading menu…</p> : <div className="overflow-hidden rounded-2xl border border-fk-line bg-white">
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-3 border-b border-fk-line p-3 last:border-0">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={item.image_url ?? '/brand/mark-red.png'} alt="" className="h-14 w-14 rounded-lg object-cover" />
            {editing === item.id ? (
              <form className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); void save(item, event.currentTarget) }}>
                <input name="name" defaultValue={item.name} className="rounded-lg border border-fk-line px-2 py-1.5 text-sm font-bold" aria-label="Item name" />
                <input name="price" type="number" min="0" step="0.01" defaultValue={(item.price_paise / 100).toFixed(2)} className="rounded-lg border border-fk-line px-2 py-1.5 text-sm" aria-label="Price in rupees" />
                <input name="description" defaultValue={item.description ?? ''} placeholder="Description" className="rounded-lg border border-fk-line px-2 py-1.5 text-sm sm:col-span-2" aria-label="Description" />
                <label className="flex items-center gap-2 rounded-lg border border-dashed border-fk-line px-2 py-1.5 text-xs font-semibold text-fk-muted sm:col-span-2">
                  <span>Replace image</span>
                  <input name="image" type="file" accept="image/png,image/jpeg,image/webp" className="min-w-0 text-xs" aria-label={`Upload image for ${item.name}`} />
                </label>
                <select name="categoryId" defaultValue={item.category_id} className="rounded-lg border border-fk-line px-2 py-1.5 text-sm" aria-label="Category">
                  {categories.filter((category) => category.is_active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
                </select>
                <div className="flex gap-2">
                  <button disabled={saving === item.id} className="rounded-lg bg-fk-red px-3 py-1.5 text-xs font-bold text-white">{saving === item.id ? 'Saving…' : 'Save'}</button>
                  <button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-fk-line px-3 py-1.5 text-xs font-bold">Cancel</button>
                </div>
              </form>
            ) : (
              <div className="min-w-0 flex-1"><p className="truncate font-bold">{item.name}</p><p className="text-xs text-fk-muted">{formatPrice(item.price_paise)} · {categories.find((category) => category.id === item.category_id)?.name ?? 'Uncategorised'}</p></div>
            )}
            {editing !== item.id && <><button onClick={() => setEditing(item.id)} className="rounded-lg border border-fk-line px-3 py-1.5 text-xs font-bold">Edit</button><button onClick={() => void toggle(item)} className={`rounded-full px-3 py-1.5 text-xs font-black ${item.is_active ? 'bg-green-100 text-green-800' : 'bg-fk-tint text-fk-nonveg'}`}>{item.is_active ? 'Available' : 'Sold out'}</button></>}
          </div>
        ))}
      </div>}
    </section>
  )
}
