import type { OrderTotals } from '@/lib/types'

export const GST_RATE = 0.05

/** 7900 -> "₹79", 7950 -> "₹79.50" */
export function formatPrice(paise: number): string {
  const rupees = paise / 100
  return `₹${Number.isInteger(rupees) ? rupees : rupees.toFixed(2)}`
}

/** Order totals where menu prices are before 5% GST. Used by browser and server. */
export function calcTotals(lines: Array<{ pricePaise: number; quantity: number }>): OrderTotals {
  const subtotalPaise = lines.reduce((sum, l) => sum + l.pricePaise * l.quantity, 0)
  const gstPaise = Math.round(subtotalPaise * GST_RATE)
  return { subtotalPaise, gstPaise, totalPaise: subtotalPaise + gstPaise }
}

/**
 * Normalise an Indian mobile number to E.164 (+91XXXXXXXXXX).
 * Accepts "9876543210", "919876543210", "+91 98765 43210", "09876543210".
 * Returns null when it is not a valid 10-digit mobile number.
 */
export function normalizePhone(raw: string): string | null {
  let digits = raw.replace(/\D/g, '')
  if (digits.length === 12 && digits.startsWith('91')) digits = digits.slice(2)
  if (digits.length === 11 && digits.startsWith('0')) digits = digits.slice(1)
  return /^[6-9]\d{9}$/.test(digits) ? `+91${digits}` : null
}

/** "12:00:00" -> "12:00 PM" */
export function formatTime(time: string | null): string {
  if (!time) return ''
  const [h, m] = time.split(':').map(Number)
  const suffix = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${suffix}`
}
