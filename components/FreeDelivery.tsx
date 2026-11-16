'use client'

import { useEffect, useMemo } from 'react'
import { motion } from 'framer-motion'
import { formatPrice } from '@/lib/utils'

/** "Add ₹55 more for FREE delivery" with a progress bar. Turns green once the food total reaches the target. */
export function FreeDeliveryProgress({ subtotalPaise, targetPaise, className = '' }: { subtotalPaise: number; targetPaise: number; className?: string }) {
  const unlocked = subtotalPaise >= targetPaise
  const percent = Math.min(100, Math.round((subtotalPaise / targetPaise) * 100))
  return (
    <div className={`rounded-xl border px-3 py-2 ${unlocked ? 'border-green-200 bg-green-50' : 'border-orange-200 bg-[#fff7ed]'} ${className}`}>
      <p className={`flex items-center gap-1.5 text-[12.5px] font-semibold ${unlocked ? 'text-green-700' : 'text-orange-800'}`}>
        <span aria-hidden>{unlocked ? '🎉' : '🛵'}</span>
        {unlocked
          ? <span>Yay! You&apos;ve unlocked <b className="font-extrabold">FREE delivery</b></span>
          : <span>Add <b className="font-extrabold">{formatPrice(targetPaise - subtotalPaise)}</b> more to get <b className="font-extrabold">FREE delivery</b></span>}
      </p>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded-full bg-black/10" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100}>
        <div className={`h-full rounded-full transition-all duration-500 ${unlocked ? 'bg-green-500' : 'bg-orange-500'}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  )
}

const COLORS = ['#ec1c23', '#ffde05', '#1f8a3b', '#ff8a00', '#2d7ff9', '#ffffff']

/** A short burst of confetti plus a banner. Shown once each time the customer unlocks free delivery. */
export function Celebration({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const t = window.setTimeout(onDone, 2600)
    return () => window.clearTimeout(t)
  }, [onDone])
  const pieces = useMemo(() => Array.from({ length: 44 }, (_, i) => ({
    id: i,
    x: (Math.random() - 0.5) * 520,
    y: -(120 + Math.random() * 380),
    fall: 160 + Math.random() * 260,
    rotate: Math.random() * 720 - 360,
    size: 6 + Math.random() * 8,
    color: COLORS[i % COLORS.length],
    delay: Math.random() * 0.12,
    round: i % 3 === 0,
  })), [])
  return (
    <div className="pointer-events-none fixed inset-0 z-[70] overflow-hidden" aria-hidden>
      <div className="absolute left-1/2 top-[62%]">
        {pieces.map((p) => (
          <motion.span
            key={p.id}
            className="absolute block"
            style={{ width: p.size, height: p.round ? p.size : p.size * 0.5, background: p.color, borderRadius: p.round ? 999 : 2 }}
            initial={{ x: 0, y: 0, opacity: 1, rotate: 0, scale: 0.6 }}
            animate={{ x: p.x, y: [0, p.y, p.y + p.fall], opacity: [1, 1, 0], rotate: p.rotate, scale: 1 }}
            transition={{ duration: 2.1, delay: p.delay, ease: 'easeOut', times: [0, 0.45, 1] }}
          />
        ))}
      </div>
      <motion.div
        initial={{ y: -60, opacity: 0, scale: 0.9 }} animate={{ y: 0, opacity: 1, scale: 1 }} exit={{ opacity: 0 }}
        transition={{ type: 'spring', damping: 14, stiffness: 220 }}
        className="absolute left-1/2 top-20 -translate-x-1/2 whitespace-nowrap rounded-full bg-green-600 px-5 py-2.5 text-sm font-extrabold text-white shadow-xl"
      >
        🎉 Free delivery unlocked!
      </motion.div>
    </div>
  )
}
