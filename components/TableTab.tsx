'use client'

import { Check, ChefHat, Clock, Plus, Receipt } from 'lucide-react'
import { formatPrice } from '@/lib/utils'

export interface TableRound {
  orderNumber: number
  status: string
  createdAt: string
  totalPaise: number
  items: Array<{ name: string; quantity: number }>
}

export interface TableInfo {
  exists: boolean
  open: boolean
  hasContact?: boolean
  customerName?: string
  rounds: TableRound[]
  totalPaise: number
}

const STATUS: Record<string, { label: string; cls: string; icon: React.ReactNode }> = {
  pending: { label: 'Waiting for the kitchen', cls: 'bg-amber-50 text-amber-700 border-amber-200', icon: <Clock className="h-3.5 w-3.5" /> },
  confirmed: { label: 'Being prepared', cls: 'bg-blue-50 text-blue-700 border-blue-200', icon: <ChefHat className="h-3.5 w-3.5" /> },
  preparing: { label: 'Being prepared', cls: 'bg-blue-50 text-blue-700 border-blue-200', icon: <ChefHat className="h-3.5 w-3.5" /> },
  ready: { label: 'Ready', cls: 'bg-green-50 text-green-700 border-green-200', icon: <Check className="h-3.5 w-3.5" /> },
  delivered: { label: 'Served', cls: 'bg-green-50 text-green-700 border-green-200', icon: <Check className="h-3.5 w-3.5" /> },
  cancelled: { label: 'Cancelled', cls: 'bg-red-50 text-red-700 border-red-200', icon: <Clock className="h-3.5 w-3.5" /> },
}

/** The diner's table tab: every round sent to the kitchen, its progress, the running total, and a button to add another round. */
export default function TableTab({ table, info, branchName, onAddMore, onNewTab }: {
  table: number
  info: TableInfo | null
  branchName: string
  onAddMore: () => void
  onNewTab: () => void
}) {
  const closed = info !== null && !info.open
  return (
    <main className="flex min-h-dvh justify-center p-4">
      <div className="h-fit w-full max-w-md overflow-hidden rounded-[24px] border border-fk-line bg-white shadow-xl shadow-black/5">
        <div className="bg-fk-red px-6 pb-6 pt-8 text-center text-white">
          <p className="text-xs font-bold uppercase tracking-[0.25em] text-white/80">Fried King · {branchName}</p>
          <h1 className="mt-2 font-display text-4xl font-extrabold uppercase leading-none">Table {table}</h1>
          <p className="mt-2 text-sm text-white/85">{closed ? 'Your table is closed' : 'Your orders on this table'}</p>
        </div>
        <div className="fk-checker" />

        <div className="space-y-3 p-5">
          {info === null && <p className="py-6 text-center text-sm text-fk-muted">Loading your orders…</p>}

          {closed && (
            <div className="rounded-2xl border border-green-200 bg-green-50 p-5 text-center">
              <Check className="mx-auto h-8 w-8 text-green-600" strokeWidth={3} />
              <p className="mt-2 font-bold text-green-900">Thank you for dining with us!</p>
              <p className="mt-1 text-sm text-green-800">Your bill is on its way to your WhatsApp.</p>
              <button onClick={onNewTab} className="mt-4 w-full rounded-[14px] bg-fk-red py-3.5 font-bold text-white">Start a new order</button>
            </div>
          )}

          {info?.open && info.rounds.length === 0 && <p className="py-4 text-center text-sm text-fk-muted">No orders yet. Add something tasty.</p>}

          {info?.open && info.rounds.map((r, i) => {
            const st = STATUS[r.status] ?? STATUS.pending
            return (
              <section key={r.orderNumber} className={`rounded-2xl border border-fk-line p-4 ${r.status === 'cancelled' ? 'opacity-60' : ''}`}>
                <div className="flex items-center justify-between gap-2">
                  <p className="font-display text-lg font-extrabold uppercase">Round {i + 1} <span className="font-sans text-xs font-semibold normal-case text-fk-muted">· #{r.orderNumber}</span></p>
                  <span className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-bold ${st.cls}`}>{st.icon} {st.label}</span>
                </div>
                <ul className="mt-2 space-y-1 text-sm">
                  {r.items.map((it, k) => <li key={k} className="flex justify-between gap-3"><span>{it.quantity} × {it.name}</span></li>)}
                </ul>
                <p className="mt-2 text-right text-sm font-bold">{formatPrice(r.totalPaise)}</p>
              </section>
            )
          })}

          {info?.open && info.rounds.length > 0 && (
            <>
              <div className="flex items-center justify-between rounded-2xl bg-fk-bg px-4 py-3">
                <span className="flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-fk-muted"><Receipt className="h-4 w-4" /> Running total</span>
                <span className="text-xl font-extrabold text-fk-red">{formatPrice(info.totalPaise)}</span>
              </div>
              <p className="text-center text-xs text-fk-muted">Incl. 5% GST. Pay at the counter when you are done. Your bill comes to your WhatsApp after the staff close the table.</p>
            </>
          )}

          {info?.open && (
            <button onClick={onAddMore} className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-fk-red py-4 font-bold text-white transition hover:bg-fk-red-dark">
              <Plus className="h-5 w-5" strokeWidth={3} /> {info.rounds.length ? 'Add another round' : 'Browse the menu'}
            </button>
          )}
        </div>
      </div>
    </main>
  )
}
