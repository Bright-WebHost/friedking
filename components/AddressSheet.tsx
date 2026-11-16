'use client'

import { useState } from 'react'
import { motion } from 'framer-motion'
import { Briefcase, Check, Home, MapPin, X } from 'lucide-react'
import type { DeliveryRules } from '@/lib/delivery'
import type { DeliveryAddress } from '@/lib/address'

const CITY = 'Mangaluru'
const input =
  'w-full rounded-xl border border-fk-line bg-white px-4 py-3.5 text-base sm:text-sm placeholder:text-fk-muted/70 outline-none transition focus:border-fk-red focus:ring-1 focus:ring-fk-red'

/**
 * "Add delivery address" bottom sheet, laid out like Zomato / Swiggy: pincode first (checked against the branch's delivery area),
 * then flat / building, area, landmark and a Home / Work / Other tag.
 */
export default function AddressSheet({ rules, initial, onSave, onClose }: {
  rules: DeliveryRules | null
  initial?: Partial<DeliveryAddress> | null
  onSave: (a: DeliveryAddress) => void
  onClose: () => void
}) {
  const [pincode, setPincode] = useState(initial?.pincode ?? '')
  const [house, setHouse] = useState('')
  const [area, setArea] = useState(initial?.text ?? '')
  const [landmark, setLandmark] = useState('')
  const known = ['Home', 'Work']
  const [tag, setTag] = useState(initial?.label && !known.includes(initial.label) ? 'Other' : initial?.label || 'Home')
  const [other, setOther] = useState(initial?.label && !known.includes(initial.label) ? initial.label : '')
  const [error, setError] = useState('')

  const restricted = (rules?.pincodes.length ?? 0) > 0
  const match = rules?.pincodes.find((p) => p.pincode === pincode)
  const complete = /^\d{6}$/.test(pincode)
  const deliverable = !complete ? null : restricted ? Boolean(match) : true

  const save = () => {
    if (!complete) return setError('Enter the 6-digit pincode.')
    if (deliverable === false) return setError(`Sorry, we do not deliver to ${pincode} yet.`)
    if (!house.trim() && !initial?.text) return setError('Enter your flat / house number or building name.')
    if (!area.trim()) return setError('Enter your area or street.')
    const text = [house.trim(), area.trim(), landmark.trim() ? `Near ${landmark.trim()}` : '', CITY].filter(Boolean).join(', ')
    onSave({ label: tag === 'Other' ? other.trim().slice(0, 30) || 'Other' : tag, text, pincode })
  }

  return (
    <motion.div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/60 sm:items-center sm:p-5"
      initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
      <motion.div role="dialog" aria-modal="true" aria-label="Add delivery address"
        className="flex max-h-[92dvh] w-full max-w-md flex-col overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-3xl"
        initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }} transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 pb-3 pt-5">
          <h2 className="font-display text-2xl font-extrabold uppercase">Add address</h2>
          <button onClick={onClose} aria-label="Close" className="rounded-full border border-fk-line p-2 text-fk-muted"><X className="h-[18px] w-[18px]" /></button>
        </div>
        <div className="fk-checker-sm" />

        <div className="space-y-3 overflow-y-auto px-5 py-4">
          <div>
            <label className="mb-1.5 block text-xs font-bold uppercase tracking-wide text-fk-muted" htmlFor="addr-pin">Pincode</label>
            <div className={`flex items-center rounded-xl border bg-white transition focus-within:ring-1 ${deliverable === false ? 'border-red-400 ring-red-300' : deliverable ? 'border-green-500 ring-green-400' : 'border-fk-line focus-within:border-fk-red focus-within:ring-fk-red'}`}>
              <MapPin className="ml-3.5 h-4 w-4 shrink-0 text-fk-red" />
              <input id="addr-pin" className="w-full bg-transparent px-3 py-3.5 text-base outline-none placeholder:text-fk-muted/70 sm:text-sm" inputMode="numeric" autoComplete="postal-code"
                maxLength={6} placeholder="6-digit pincode" value={pincode}
                onChange={(e) => { setPincode(e.target.value.replace(/\D/g, '').slice(0, 6)); setError('') }} />
              {deliverable && <Check className="mr-3.5 h-4 w-4 shrink-0 text-green-600" strokeWidth={3} />}
            </div>
            {deliverable === true && <p className="mt-1.5 text-xs font-semibold text-green-700">✓ We deliver here{match?.area ? ` · ${match.area}` : ''}, {CITY}</p>}
            {deliverable === false && <p className="mt-1.5 text-xs font-semibold text-red-600">Sorry, we do not deliver to this pincode yet.</p>}
            {restricted && !complete && <p className="mt-1.5 text-xs text-fk-muted">We deliver to: {rules!.pincodes.map((p) => p.pincode).join(', ')}</p>}
          </div>

          <input className={input} placeholder="Flat / House no. / Building name *" autoComplete="address-line1" value={house} onChange={(e) => { setHouse(e.target.value); setError('') }} />
          <input className={input} placeholder="Area / Street / Locality *" autoComplete="address-line2" value={area} onChange={(e) => { setArea(e.target.value); setError('') }} />
          <input className={input} placeholder="Landmark (optional)" value={landmark} onChange={(e) => setLandmark(e.target.value)} />
          <p className="text-xs text-fk-muted">City: {CITY}, Karnataka</p>

          <div>
            <p className="mb-2 text-xs font-bold uppercase tracking-wide text-fk-muted">Save as</p>
            <div className="flex flex-wrap gap-2">
              {[{ k: 'Home', icon: <Home className="h-3.5 w-3.5" /> }, { k: 'Work', icon: <Briefcase className="h-3.5 w-3.5" /> }, { k: 'Other', icon: <MapPin className="h-3.5 w-3.5" /> }].map(({ k, icon }) => (
                <button key={k} type="button" onClick={() => setTag(k)} aria-pressed={tag === k}
                  className={`flex items-center gap-1.5 rounded-full border px-4 py-2 text-sm font-bold transition ${tag === k ? 'border-fk-red bg-fk-tint text-fk-red' : 'border-fk-line text-fk-muted'}`}>
                  {icon} {k}
                </button>
              ))}
            </div>
            {tag === 'Other' && <input className={`${input} mt-2`} placeholder="Name this place (e.g. Mom's house)" maxLength={30} value={other} onChange={(e) => setOther(e.target.value)} />}
          </div>
          {error && <p role="alert" className="rounded-xl border border-red-200 bg-fk-tint px-4 py-2.5 text-sm font-medium text-fk-red-dark">{error}</p>}
        </div>

        <div className="border-t border-fk-line px-5 pb-5 pt-3">
          <button onClick={save} className="w-full rounded-[14px] bg-fk-red py-4 font-bold text-white transition hover:bg-fk-red-dark">Save address</button>
        </div>
      </motion.div>
    </motion.div>
  )
}
