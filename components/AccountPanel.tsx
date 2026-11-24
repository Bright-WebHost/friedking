'use client'

import { useState } from 'react'
import { LogOut, MapPin, Trash2, X } from 'lucide-react'
import VerifyCard, { type VerifyState } from '@/components/VerifyCard'
import { formatPrice } from '@/lib/utils'

export interface Account {
  loggedIn: boolean
  phoneMasked?: string
  name?: string
  addresses?: Array<{ id: string; label: string | null; address: string }>
  orders?: Array<{ id: string; branches?: { name: string } | null; order_number: number; status: string; total_paise: number; created_at: string; order_type: string; order_items: Array<{ name_snapshot: string; quantity: number }> }>
}

const when = (t: string) => new Date(t).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

/** Slide-over: log in with a WhatsApp OTP, then see past orders and manage saved addresses. */
export default function AccountPanel({ account, branch, onClose, onChanged }: { account: Account; branch?: string | null; onClose: () => void; onChanged: () => void }) {
  const [msg, setMsg] = useState<string | null>(null)
  const [newAddr, setNewAddr] = useState('')

  const post = async (url: string, body?: unknown) => {
    const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body ?? {}) })
    const d = await res.json().catch(() => ({}))
    if (!res.ok) setMsg(d.message ?? 'Something went wrong.')
    return res.ok
  }

  const onVerify = async (s: VerifyState) => {
    if (s.verified && (await post('/api/account/session', { secret: s.secret }))) onChanged()
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/40" onClick={onClose}>
      <aside className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between bg-fk-red px-4 py-4 text-white">
          <h2 className="text-lg font-extrabold">{account.loggedIn ? 'My profile' : 'Log in'}</h2>
          <button onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full active:bg-white/20"><X className="h-5 w-5" /></button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-4">
          {!account.loggedIn ? (
            <>
              <p className="text-sm text-fk-muted">Log in with a WhatsApp OTP to see your past orders and save delivery addresses.</p>
              <VerifyCard branch={branch} onChange={onVerify} />
            </>
          ) : (
            <>
              <div>
                <p className="text-base font-bold">{account.name || 'Welcome back'}</p>
                <p className="text-sm text-fk-muted">{account.phoneMasked}</p>
              </div>

              <section>
                <h3 className="mb-2 text-sm font-extrabold uppercase tracking-wide">Saved addresses</h3>
                <div className="space-y-2">
                  {(account.addresses ?? []).map((a) => (
                    <div key={a.id} className="flex items-start gap-2 rounded-xl border border-fk-line px-3 py-2.5">
                      <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-fk-red" />
                      <p className="min-w-0 flex-1 text-sm">{a.label ? <b>{a.label}: </b> : null}{a.address}</p>
                      <button aria-label="Delete address" onClick={async () => { if (await post('/api/account/addresses', { action: 'delete', id: a.id })) onChanged() }}>
                        <Trash2 className="h-4 w-4 text-fk-muted" />
                      </button>
                    </div>
                  ))}
                  {!(account.addresses ?? []).length && <p className="text-sm text-fk-muted">No saved addresses yet.</p>}
                  <textarea className="w-full resize-none rounded-xl border border-fk-line px-3 py-2.5 text-base outline-none focus:border-fk-red sm:text-sm" rows={2} placeholder="Add an address with landmark" value={newAddr} onChange={(e) => setNewAddr(e.target.value)} />
                  <button
                    disabled={!newAddr.trim()}
                    onClick={async () => { if (await post('/api/account/addresses', { action: 'add', address: newAddr })) { setNewAddr(''); onChanged() } }}
                    className="rounded-xl bg-fk-red px-4 py-2 text-sm font-bold text-white disabled:opacity-50"
                  >Save address</button>
                </div>
              </section>

              <section>
                <h3 className="mb-2 text-sm font-extrabold uppercase tracking-wide">My orders</h3>
                <div className="space-y-2">
                  {(account.orders ?? []).map((o) => (
                    <div key={o.id} className="rounded-xl border border-fk-line px-3 py-2.5">
                      <div className="flex items-center justify-between text-sm">
                        <b>FK-{o.order_number}{o.branches?.name ? <span className="font-semibold text-fk-muted"> · {o.branches.name.replace(/^fried king\s*/i, '')}</span> : null}</b>
                        <span className="rounded-full bg-fk-bg px-2 py-0.5 text-xs font-semibold capitalize">{o.status === 'pending' ? 'placed' : o.status}</span>
                      </div>
                      <p className="mt-1 text-sm text-fk-muted">{o.order_items.map((i) => `${i.quantity} x ${i.name_snapshot}`).join(', ')}</p>
                      <p className="mt-1 flex justify-between text-xs text-fk-muted"><span>{when(o.created_at)}</span><b className="text-sm text-black">{formatPrice(o.total_paise)}</b></p>
                    </div>
                  ))}
                  {!(account.orders ?? []).length && <p className="text-sm text-fk-muted">No orders yet.</p>}
                </div>
              </section>

              <button
                onClick={async () => { if (await post('/api/account/logout')) onChanged() }}
                className="flex w-full items-center justify-center gap-2 rounded-xl border border-fk-line py-3 text-sm font-bold"
              ><LogOut className="h-4 w-4" /> Log out</button>
            </>
          )}
          {msg && <p className="text-sm font-semibold text-fk-red">{msg}</p>}
        </div>
      </aside>
    </div>
  )
}
