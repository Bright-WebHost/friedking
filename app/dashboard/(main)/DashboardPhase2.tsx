'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatPrice } from '@/lib/utils'

type StockItem = { id: string; name: string; unit: string; quantity: number; reorder_level: number; cost_paise: number }
type LoyaltyCustomer = { id: string; name: string | null; phone: string; loyalty_accounts: { id: string; points_balance: number; lifetime_points: number }[] | null }
type Campaign = { id: string; title: string; message: string; audience: string; status: string; scheduled_at: string | null }

export function StockBoard({ branchSlug }: { branchSlug: string | null }) {
  const [items, setItems] = useState<StockItem[]>([])
  const [form, setForm] = useState({ name: '', unit: 'unit', quantity: '0', reorderLevel: '0', costPaise: '0' })
  const [message, setMessage] = useState('')
  const load = useCallback(async () => {
    const response = await fetch(`/api/dashboard/stock?branch=${encodeURIComponent(branchSlug ?? '')}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? 'Could not load stock')
    setItems(data.items)
  }, [branchSlug])
  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : 'Could not load stock')) }, [load])
  const save = async (event: React.FormEvent) => {
    event.preventDefault(); setMessage('')
    const response = await fetch('/api/dashboard/stock', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branch: branchSlug, name: form.name, unit: form.unit, quantity: Number(form.quantity), reorderLevel: Number(form.reorderLevel), costPaise: Number(form.costPaise) }) })
    const data = await response.json()
    if (!response.ok) { setMessage(data.message ?? 'Could not save stock item'); return }
    setItems((current) => [...current, data.item].sort((a, b) => a.name.localeCompare(b.name))); setForm({ name: '', unit: 'unit', quantity: '0', reorderLevel: '0', costPaise: '0' }); setMessage('Stock item saved.')
  }
  const remove = async (id: string) => {
    const response = await fetch('/api/dashboard/stock', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) })
    if (!response.ok) { const data = await response.json(); setMessage(data.message ?? 'Could not remove stock item'); return }
    setItems((current) => current.filter((item) => item.id !== id))
  }
  return <section><Header title="Stock" description="Track ingredients, reorder levels, and stock value for this branch." />
    {message && <Notice text={message} />}
    <form onSubmit={save} className="mb-5 grid gap-2 rounded-2xl border border-fk-line bg-white p-4 sm:grid-cols-6">
      <input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Ingredient name" className="rounded-lg border border-fk-line px-3 py-2 text-sm sm:col-span-2" />
      <input required value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} placeholder="Unit (kg, pcs)" className="rounded-lg border border-fk-line px-3 py-2 text-sm" />
      <input required type="number" min="0" step="0.001" value={form.quantity} onChange={(e) => setForm({ ...form, quantity: e.target.value })} placeholder="Quantity" className="rounded-lg border border-fk-line px-3 py-2 text-sm" />
      <input required type="number" min="0" step="0.001" value={form.reorderLevel} onChange={(e) => setForm({ ...form, reorderLevel: e.target.value })} placeholder="Reorder at" className="rounded-lg border border-fk-line px-3 py-2 text-sm" />
      <button className="rounded-lg bg-fk-red px-3 py-2 text-sm font-bold text-white">Add item</button>
    </form>
    <div className="overflow-x-auto rounded-2xl border border-fk-line bg-white"><table className="w-full min-w-[620px] text-left text-sm"><thead className="border-b border-fk-line bg-fk-bg text-xs uppercase text-fk-muted"><tr><th className="px-4 py-3">Ingredient</th><th className="px-4 py-3">Quantity</th><th className="px-4 py-3">Reorder at</th><th className="px-4 py-3">Unit cost</th><th className="px-4 py-3" /></tr></thead><tbody>{items.map((item) => <tr key={item.id} className="border-b border-fk-line last:border-0"><td className="px-4 py-3 font-bold">{item.name}<span className="ml-1 text-xs font-normal text-fk-muted">/{item.unit}</span></td><td className={`px-4 py-3 font-bold ${Number(item.quantity) <= Number(item.reorder_level) ? 'text-fk-red' : ''}`}>{item.quantity}</td><td className="px-4 py-3">{item.reorder_level}</td><td className="px-4 py-3">{formatPrice(Number(item.cost_paise))}</td><td className="px-4 py-3 text-right"><button onClick={() => void remove(item.id)} className="text-xs font-bold text-fk-red">Remove</button></td></tr>)}</tbody></table>{!items.length && <p className="p-8 text-center text-sm text-fk-muted">No stock items configured.</p>}</div>
  </section>
}

export function LoyaltyBoard({ branchSlug }: { branchSlug: string | null }) {
  const [customers, setCustomers] = useState<LoyaltyCustomer[]>([])
  const [query, setQuery] = useState('')
  const [message, setMessage] = useState('')
  const load = useCallback(async () => { const response = await fetch(`/api/dashboard/loyalty?branch=${encodeURIComponent(branchSlug ?? '')}&q=${encodeURIComponent(query)}`, { cache: 'no-store' }); const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Could not load loyalty'); setCustomers(data.customers) }, [branchSlug, query])
  useEffect(() => { const timer = window.setTimeout(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : 'Could not load loyalty')) }, 250); return () => window.clearTimeout(timer) }, [load])
  const adjust = async (customerId: string, points: number) => { const reason = window.prompt('Reason for points adjustment'); if (!reason) return; const response = await fetch('/api/dashboard/loyalty', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ customerId, points, reason }) }); const data = await response.json(); if (!response.ok) { setMessage(data.message ?? 'Could not update points'); return }; setMessage('Points updated.'); await load() }
  return <section><Header title="Loyalty" description="Reward repeat customers with manually managed points." /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search customer or phone" className="mb-4 w-full rounded-xl border border-fk-line bg-white px-3 py-2 text-sm" />{message && <Notice text={message} />}<div className="overflow-x-auto rounded-2xl border border-fk-line bg-white"><table className="w-full min-w-[650px] text-left text-sm"><thead className="border-b border-fk-line bg-fk-bg text-xs uppercase text-fk-muted"><tr><th className="px-4 py-3">Customer</th><th className="px-4 py-3">Balance</th><th className="px-4 py-3">Lifetime</th><th className="px-4 py-3">Actions</th></tr></thead><tbody>{customers.map((customer) => { const account = customer.loyalty_accounts?.[0]; return <tr key={customer.id} className="border-b border-fk-line last:border-0"><td className="px-4 py-3"><p className="font-bold">{customer.name || 'Guest customer'}</p><p className="text-xs text-fk-muted">{customer.phone}</p></td><td className="px-4 py-3 font-bold">{account?.points_balance ?? 0} pts</td><td className="px-4 py-3">{account?.lifetime_points ?? 0} pts</td><td className="px-4 py-3"><div className="flex gap-2"><button onClick={() => void adjust(customer.id, 10)} className="rounded-lg bg-green-100 px-2 py-1 text-xs font-bold text-green-800">+10</button><button onClick={() => void adjust(customer.id, -10)} disabled={!account?.points_balance} className="rounded-lg bg-red-100 px-2 py-1 text-xs font-bold text-red-800 disabled:opacity-40">-10</button></div></td></tr> })}</tbody></table>{!customers.length && <p className="p-8 text-center text-sm text-fk-muted">No loyalty customers found.</p>}</div></section>
}

export function BroadcastBoard({ branchSlug }: { branchSlug: string | null }) {
  const [campaigns, setCampaigns] = useState<Campaign[]>([])
  const [editing, setEditing] = useState<Campaign | null>(null)
  const [message, setMessage] = useState('')
  const load = useCallback(async () => { const response = await fetch(`/api/dashboard/broadcasts?branch=${encodeURIComponent(branchSlug ?? '')}`, { cache: 'no-store' }); const data = await response.json(); if (!response.ok) throw new Error(data.message ?? 'Could not load broadcasts'); setCampaigns(data.campaigns) }, [branchSlug])
  useEffect(() => { load().catch((error) => setMessage(error instanceof Error ? error.message : 'Could not load broadcasts')) }, [load])
  const save = async (event: React.FormEvent<HTMLFormElement>) => { event.preventDefault(); const data = new FormData(event.currentTarget); const response = await fetch('/api/dashboard/broadcasts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ branch: branchSlug, id: editing?.id, title: data.get('title'), message: data.get('message'), audience: data.get('audience'), status: data.get('status'), scheduledAt: data.get('scheduledAt') || null }) }); const result = await response.json(); if (!response.ok) { setMessage(result.message ?? 'Could not save broadcast'); return }; setCampaigns((current) => [result.campaign, ...current.filter((item) => item.id !== result.campaign.id)]); setEditing(null); setMessage('Broadcast draft saved.') }
  const remove = async (id: string) => { const response = await fetch('/api/dashboard/broadcasts', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) }); if (!response.ok) { setMessage('Could not delete broadcast'); return }; setCampaigns((current) => current.filter((item) => item.id !== id)) }
  return <section><Header title="Broadcasts" description="Prepare customer campaigns. Sending activates after n8n and YCloud are connected." /><button onClick={() => setEditing({ id: '', title: '', message: '', audience: 'all', status: 'draft', scheduled_at: null })} className="mb-4 rounded-lg bg-fk-red px-3 py-2 text-sm font-bold text-white">New broadcast</button>{message && <Notice text={message} />}{editing && <form onSubmit={(e) => void save(e)} className="mb-5 grid gap-3 rounded-2xl border border-fk-line bg-white p-4"><input required name="title" defaultValue={editing.title} placeholder="Campaign title" className="rounded-lg border border-fk-line px-3 py-2 text-sm font-bold" /><textarea required name="message" defaultValue={editing.message} rows={4} placeholder="WhatsApp message text" className="rounded-lg border border-fk-line px-3 py-2 text-sm" /><div className="grid gap-3 sm:grid-cols-3"><select name="audience" defaultValue={editing.audience} className="rounded-lg border border-fk-line px-3 py-2 text-sm"><option value="all">All customers</option><option value="repeat_customers">Repeat customers</option><option value="inactive_customers">Inactive customers</option></select><select name="status" defaultValue={editing.status} className="rounded-lg border border-fk-line px-3 py-2 text-sm"><option value="draft">Draft</option><option value="scheduled">Scheduled</option><option value="cancelled">Cancelled</option></select><input name="scheduledAt" type="datetime-local" defaultValue={editing.scheduled_at?.slice(0, 16) ?? ''} className="rounded-lg border border-fk-line px-3 py-2 text-sm" /></div><div className="flex gap-2"><button className="rounded-lg bg-fk-red px-3 py-2 text-sm font-bold text-white">Save draft</button><button type="button" onClick={() => setEditing(null)} className="rounded-lg border border-fk-line px-3 py-2 text-sm font-bold">Cancel</button></div></form>}<div className="space-y-3">{campaigns.map((campaign) => <article key={campaign.id} className="rounded-2xl border border-fk-line bg-white p-4"><div className="flex items-start justify-between gap-3"><div><h2 className="font-display text-xl font-extrabold">{campaign.title}</h2><p className="mt-1 whitespace-pre-wrap text-sm text-fk-muted">{campaign.message}</p></div><span className="rounded-full bg-fk-yellow px-2.5 py-1 text-xs font-black uppercase">{campaign.status}</span></div><div className="mt-3 flex items-center justify-between border-t border-fk-line pt-3 text-xs text-fk-muted"><span>{campaign.audience.replace('_', ' ')}</span><div className="flex gap-2"><button onClick={() => setEditing(campaign)} className="font-bold text-fk-red">Edit</button><button onClick={() => void remove(campaign.id)} className="font-bold text-fk-red">Delete</button></div></div></article>)}{!campaigns.length && <p className="rounded-2xl border border-dashed border-fk-line bg-white p-8 text-center text-sm text-fk-muted">No broadcasts yet.</p>}</div></section>
}

export function IntegrationBoard({ title, description, dependency }: { title: string; description: string; dependency: string }) {
  return <section><Header title={title} description={description} /><div className="rounded-2xl border border-dashed border-fk-line bg-white p-10 text-center"><p className="text-4xl">💬</p><h2 className="mt-3 font-display text-2xl font-extrabold">Integration pending</h2><p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-fk-muted">{dependency}</p><span className="mt-5 inline-block rounded-full bg-fk-yellow px-3 py-1.5 text-xs font-black uppercase">Ready for connection</span></div></section>
}

function Header({ title, description }: { title: string; description: string }) { return <div className="mb-5"><h1 className="font-display text-3xl font-extrabold uppercase">{title}</h1><p className="text-sm text-fk-muted">{description}</p></div> }
function Notice({ text }: { text: string }) { return <p className="mb-4 rounded-xl bg-fk-tint px-3 py-2 text-sm font-medium">{text}</p> }
