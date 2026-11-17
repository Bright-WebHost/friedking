'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { calcTotals, formatPrice } from '@/lib/utils'

type Item = { id: string; name: string; price_paise: number; image_url: string | null; is_active: boolean }
type CartLine = Item & { quantity: number }

export default function DashboardPOS({ branchSlug }: { branchSlug: string | null }) {
  const [items, setItems] = useState<Item[]>([])
  const [cart, setCart] = useState<CartLine[]>([])
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    const response = await fetch(`/api/dashboard/menu${branchSlug ? `?branch=${encodeURIComponent(branchSlug)}` : ''}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? 'Could not load menu')
    setItems(data.items.filter((item: Item) => item.is_active))
  }, [branchSlug])
  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : 'Could not load menu')).finally(() => setLoading(false)) }, [load])

  const visible = useMemo(() => items.filter((item) => item.name.toLowerCase().includes(query.toLowerCase())), [items, query])
  const totals = calcTotals(cart.map((item) => ({ id: item.id, name: item.name, pricePaise: item.price_paise, quantity: item.quantity })))
  const add = (item: Item) => setCart((current) => current.some((line) => line.id === item.id) ? current.map((line) => line.id === item.id ? { ...line, quantity: line.quantity + 1 } : line) : [...current, { ...item, quantity: 1 }])
  const remove = (id: string) => setCart((current) => current.flatMap((line) => line.id !== id ? [line] : line.quantity > 1 ? [{ ...line, quantity: line.quantity - 1 }] : []))
  const submit = async () => {
    setSaving(true); setMessage('')
    try {
      const response = await fetch('/api/dashboard/pos', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branch: branchSlug, customerName: name, customerPhone: phone, items: cart.map((line) => ({ itemId: line.id, quantity: line.quantity })) }) })
      const data = await response.json()
      if (!response.ok) throw new Error(data.message ?? 'Could not create order')
      setMessage(`Order #${data.orderNumber} created for ${formatPrice(data.totalPaise)}.`); setCart([]); setName(''); setPhone('')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not create order') } finally { setSaving(false) }
  }

  return <section>
    <div className="mb-5"><h1 className="font-display text-3xl font-extrabold uppercase">POS</h1><p className="text-sm text-fk-muted">Create cash pickup orders at the counter.</p></div>
    {message && <p className="mb-4 rounded-xl bg-fk-tint px-3 py-2 text-sm font-medium">{message}</p>}
    <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
      <div><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search menu items" className="mb-3 w-full rounded-xl border border-fk-line bg-white px-3 py-2 text-sm outline-none focus:border-fk-red" />{loading ? <p className="text-sm text-fk-muted">Loading menu…</p> : <div className="grid gap-2 sm:grid-cols-2">{visible.map((item) => <button key={item.id} onClick={() => add(item)} className="flex items-center justify-between rounded-xl border border-fk-line bg-white p-3 text-left hover:border-fk-red"><span className="font-bold">{item.name}</span><span className="text-sm font-black">{formatPrice(item.price_paise)}</span></button>)}</div>}</div>
      <aside className="rounded-2xl border border-fk-line bg-white p-4"><h2 className="font-display text-xl font-extrabold uppercase">Current order</h2><div className="my-3 space-y-2 border-y border-fk-line py-3">{cart.length ? cart.map((line) => <div key={line.id} className="flex items-center justify-between gap-2 text-sm"><span>{line.quantity} × {line.name}</span><button onClick={() => remove(line.id)} className="font-black text-fk-red">Remove</button></div>) : <p className="text-sm text-fk-muted">Add items from the menu.</p>}</div><div className="mb-3 space-y-1 text-sm"><p className="flex justify-between"><span>Subtotal (incl. GST)</span><span>{formatPrice(totals.subtotalPaise)}</span></p><p className="flex justify-between text-fk-muted"><span>GST included (5%)</span><span>{formatPrice(totals.gstPaise)}</span></p><p className="flex justify-between font-black"><span>Total</span><span>{formatPrice(totals.totalPaise)}</span></p></div><input value={name} onChange={(event) => setName(event.target.value)} placeholder="Customer name" className="mb-2 w-full rounded-lg border border-fk-line px-3 py-2 text-sm" /><input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="Phone number" className="mb-3 w-full rounded-lg border border-fk-line px-3 py-2 text-sm" /><button disabled={saving || !cart.length} onClick={() => void submit()} className="w-full rounded-lg bg-fk-red px-3 py-2.5 text-sm font-bold text-white disabled:opacity-50">{saving ? 'Creating…' : 'Create cash order'}</button></aside>
    </div>
  </section>
}
