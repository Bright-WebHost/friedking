'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'

export interface VerifyState { enabled: boolean; secret: string; verified: boolean }

async function json(res: Response) {
  try { return await res.json() } catch { return {} }
}

/**
 * WhatsApp OTP: the customer sends "VERIFY <code>" to our number, the bot replies with a 6-digit OTP,
 * and they type it here. Reports { enabled, secret, verified } to the parent. enabled=false means the
 * feature is not installed yet (parent falls back to the plain phone field).
 */
export default function VerifyCard({ onChange }: { onChange: (s: VerifyState) => void }) {
  const [info, setInfo] = useState<{ secret: string; code: string; waUrl: string } | null>(null)
  const [sent, setSent] = useState(false)
  const [masked, setMasked] = useState<string | null>(null)
  const [verified, setVerified] = useState(false)
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const report = useRef(onChange)
  report.current = onChange

  const start = useCallback(async () => {
    setErr(null); setSent(false); setVerified(false); setOtp(''); setMasked(null)
    try {
      const d = await json(await fetch('/api/verify/start', { method: 'POST' }))
      if (d.enabled) { setInfo(d); report.current({ enabled: true, secret: d.secret, verified: false }) }
      else report.current({ enabled: false, secret: '', verified: false })
    } catch {
      report.current({ enabled: false, secret: '', verified: false })
    }
  }, [])
  useEffect(() => { void start() }, [start])

  const finish = useCallback((secret: string, m: string | null) => {
    setVerified(true); setMasked(m)
    report.current({ enabled: true, secret, verified: true })
  }, [])

  // wait for the WhatsApp message to arrive
  useEffect(() => {
    if (!info || sent || verified) return
    const t = setInterval(async () => {
      try {
        const d = await json(await fetch(`/api/verify/status?s=${info.secret}`))
        if (d.verified) finish(info.secret, d.phoneMasked)
        else if (d.sent) { setSent(true); setMasked(d.phoneMasked) }
      } catch { /* try again */ }
    }, 3000)
    return () => clearInterval(t)
  }, [info, sent, verified, finish])

  const confirm = async () => {
    if (!info || busy) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/verify/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret: info.secret, otp }) })
      const d = await json(res)
      if (!res.ok) setErr(d.message ?? 'Could not check the OTP.')
      else finish(info.secret, masked)
    } finally { setBusy(false) }
  }

  if (!info) return null

  if (verified) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
        <Check className="h-5 w-5 shrink-0 text-green-700" strokeWidth={3} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-green-900">OTP verified</p>
          {masked && <p className="truncate text-sm text-green-800">{masked}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-fk-line bg-white px-4 py-3">
      <p className="text-sm font-bold">Verify with a WhatsApp OTP</p>
      {!sent ? (
        <>
          <p className="mt-1 text-sm text-fk-muted">Tap the button and send the message that opens in WhatsApp. We will reply with a 6-digit OTP.</p>
          <a href={info.waUrl} target="_blank" rel="noopener noreferrer" className="mt-3 flex items-center justify-center gap-2 rounded-xl bg-[#25d366] px-4 py-3 text-sm font-bold text-white">
            Get OTP on WhatsApp
          </a>
          <p className="mt-2 flex items-center justify-center gap-1.5 text-center text-xs text-fk-muted">
            <Loader2 className="h-3 w-3 animate-spin" /> Or send <b>VERIFY {info.code}</b> to our WhatsApp number
          </p>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-fk-muted">We sent a 6-digit OTP to your WhatsApp{masked ? ` (${masked})` : ''}. Enter it below.</p>
          <div className="mt-3 flex gap-2">
            <input
              className="w-full rounded-xl border border-fk-line bg-white px-4 py-3 text-center text-lg font-bold tracking-[0.4em] outline-none focus:border-fk-red focus:ring-1 focus:ring-fk-red"
              inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••"
              value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter' && otp.length === 6) void confirm() }}
            />
            <button onClick={confirm} disabled={busy || otp.length !== 6} className="shrink-0 rounded-xl bg-fk-red px-5 text-sm font-bold text-white disabled:opacity-50">
              {busy ? '…' : 'Verify'}
            </button>
          </div>
        </>
      )}
      {err && <p className="mt-2 text-sm font-semibold text-fk-red">{err}</p>}
      <button onClick={start} className="mt-2 text-xs font-semibold text-fk-muted underline">Start again</button>
    </div>
  )
}
