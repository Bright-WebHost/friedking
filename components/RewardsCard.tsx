'use client'

import { useEffect, useRef, useState } from 'react'
import { Gift, Loader2 } from 'lucide-react'
import { formatPrice } from '@/lib/utils'

interface Offer {
  available: boolean
  balance?: number
  usablePoints?: number
  usableValuePaise?: number
  paisePerPoint?: number
  maxRedeemPct?: number
  currencyName?: string
  programName?: string
}

/**
 * "Use my reward points" at checkout. Shown once the number is proven (WhatsApp link, verified OTP or login).
 * The balance comes from /api/loyalty; the server decides the real discount again when the order is placed.
 * Reports the discount it expects (0 when switched off) so the page can show the new total.
 */
export default function RewardsCard({ branchSlug, linkToken, verifySecret, loggedIn, items, onChange }: {
  branchSlug: string
  linkToken: string | null
  verifySecret: string | null
  loggedIn: boolean
  items: Array<{ itemId: string; quantity: number }>
  onChange: (s: { use: boolean; valuePaise: number; points: number }) => void
}) {
  const [offer, setOffer] = useState<Offer | null>(null)
  const [loading, setLoading] = useState(false)
  const [use, setUse] = useState(true)
  const report = useRef(onChange)
  report.current = onChange
  const identity = !!(linkToken || verifySecret || loggedIn)
  const cartKey = items.map((i) => `${i.itemId}:${i.quantity}`).join(',')

  useEffect(() => {
    if (!identity || !items.length) { setOffer(null); return }
    let live = true
    setLoading(true)
    const t = setTimeout(() => {
      fetch('/api/loyalty', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store',
        body: JSON.stringify({ branchSlug, linkToken, verifySecret, items }),
      }).then((r) => r.json()).then((d: Offer) => { if (live) setOffer(d) })
        .catch(() => { if (live) setOffer(null) })
        .finally(() => { if (live) setLoading(false) })
    }, 350)
    return () => { live = false; clearTimeout(t) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity, branchSlug, linkToken, verifySecret, cartKey])

  const points = offer?.available ? offer.usablePoints ?? 0 : 0
  const value = offer?.available ? offer.usableValuePaise ?? 0 : 0
  useEffect(() => {
    report.current({ use: use && points > 0, valuePaise: use && points > 0 ? value : 0, points: use ? points : 0 })
  }, [use, points, value])

  if (!identity) return null
  if (loading && !offer) {
    return (
      <div className="flex items-center gap-2 rounded-2xl border border-fk-line bg-white px-4 py-3 text-sm text-fk-muted">
        <Loader2 className="h-4 w-4 animate-spin" /> Checking your reward points…
      </div>
    )
  }
  if (!offer?.available) return null

  const unit = offer.currencyName || 'points'
  return (
    <div className={`rounded-2xl border-2 p-4 transition ${use && points > 0 ? 'border-amber-400 bg-amber-50' : 'border-fk-line bg-white'}`}>
      <div className="flex items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-amber-400 text-white"><Gift className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-extrabold">{offer.programName || 'Fried King Rewards'}</p>
          <p className="text-[13px] text-fk-muted">You have <b className="text-fk-ink">{offer.balance} {unit}</b></p>
          {points > 0 ? (
            <p className="mt-1 text-[13px] font-semibold text-amber-800">Use {points} {unit} to save {formatPrice(value)} on this order</p>
          ) : (
            <p className="mt-1 text-[12.5px] text-fk-muted">Add a little more to your order to use your {unit}.</p>
          )}
          {!!offer.maxRedeemPct && <p className="mt-0.5 text-[11.5px] text-fk-muted">Up to {offer.maxRedeemPct}% of an order can be paid with {unit}.</p>}
        </div>
        {points > 0 && (
          <button type="button" role="switch" aria-checked={use} aria-label={`Use ${unit}`} onClick={() => setUse((u) => !u)}
            className={`relative mt-1 h-7 w-12 shrink-0 rounded-full transition ${use ? 'bg-amber-500' : 'bg-gray-300'}`}>
            <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${use ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        )}
      </div>
    </div>
  )
}
