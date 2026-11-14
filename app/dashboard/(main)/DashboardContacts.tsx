'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatPrice } from '@/lib/utils'

type Contact = {
  id: string
  name: string | null
  phone: string
  created_at: string
  branch: { name: string; slug: string } | null
  order_count: number
  total_spent_paise: number
  last_order_at: string | null
  last_order_status: string | null
}

export default function DashboardContacts({ branchSlug }: { branchSlug: string | null }) {
  const [contacts, setContacts] = useState<Contact[]>([])
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    const params = new URLSearchParams()
    if (branchSlug) params.set('branch', branchSlug)
    if (query.trim()) params.set('q', query.trim())
    const response = await fetch(`/api/dashboard/contacts?${params.toString()}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? 'Could not load contacts')
    setContacts(data.contacts)
    setError('')
  }, [branchSlug, query])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setLoading(true)
      load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load contacts')).finally(() => setLoading(false))
    }, 250)
    return () => window.clearTimeout(timer)
  }, [load])

  const repeatCustomers = useMemo(() => contacts.filter((contact) => contact.order_count > 1).length, [contacts])
  const totalRevenue = useMemo(() => contacts.reduce((total, contact) => total + contact.total_spent_paise, 0), [contacts])

  return (
    <section>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div><h1 className="font-display text-3xl font-extrabold uppercase">Contacts</h1><p className="text-sm text-fk-muted">Customers and their ordering history for this branch.</p></div>
        <button onClick={() => void load()} className="rounded-lg border border-fk-line bg-white px-3 py-2 text-sm font-bold">Refresh</button>
      </div>
      <div className="mb-4 grid gap-2 sm:grid-cols-3">
        <Summary label="Customers" value={contacts.length.toString()} />
        <Summary label="Repeat customers" value={repeatCustomers.toString()} />
        <Summary label="Customer revenue" value={formatPrice(totalRevenue)} />
      </div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name or phone" className="mb-4 w-full rounded-xl border border-fk-line bg-white px-3 py-2 text-sm outline-none focus:border-fk-red" />
      {error && <p className="mb-4 rounded-xl bg-fk-tint px-3 py-2 text-sm font-medium text-fk-nonveg">{error}</p>}
      {loading ? <p className="text-sm text-fk-muted">Loading contacts…</p> : contacts.length === 0 ? <p className="rounded-2xl border border-dashed border-fk-line bg-white p-8 text-center text-sm text-fk-muted">No customers found.</p> : (
        <div className="overflow-x-auto rounded-2xl border border-fk-line bg-white">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-fk-line bg-fk-bg text-xs uppercase text-fk-muted">
              <tr><th className="px-4 py-3 font-black">Customer</th><th className="px-4 py-3 font-black">Branch</th><th className="px-4 py-3 font-black">Orders</th><th className="px-4 py-3 font-black">Spent</th><th className="px-4 py-3 font-black">Last order</th></tr>
            </thead>
            <tbody>
              {contacts.map((contact) => (
                <tr key={contact.id} className="border-b border-fk-line last:border-0">
                  <td className="px-4 py-3"><p className="font-bold">{contact.name || 'Guest customer'}</p><p className="text-xs text-fk-muted">{contact.phone}</p></td>
                  <td className="px-4 py-3 text-fk-muted">{contact.branch?.name ?? 'Unknown branch'}</td>
                  <td className="px-4 py-3 font-bold">{contact.order_count}</td>
                  <td className="px-4 py-3 font-bold">{formatPrice(contact.total_spent_paise)}</td>
                  <td className="px-4 py-3 text-fk-muted">{contact.last_order_at ? new Date(contact.last_order_at).toLocaleDateString() : 'No orders'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function Summary({ label, value }: { label: string; value: string }) {
  return <div className="rounded-xl border border-fk-line bg-white px-3 py-2"><p className="text-xs font-bold uppercase text-fk-muted">{label}</p><p className="font-display text-2xl font-extrabold">{value}</p></div>
}
