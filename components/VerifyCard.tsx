'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'

export interface VerifyState { enabled: boolean; secret: string; verified: boolean }

async function json(res: Response) {
  try { return await res.json() } catch { return {} }
}

/**
 * WhatsApp OTP. The customer types their number (or it is fixed by the WhatsApp link / login), taps Send OTP,
 * receives the OTP on WhatsApp and types it here. Reports { enabled, secret, verified } to the parent.
 * enabled=false means OTP is not installed yet (the parent falls back to the plain phone field).
 */
export default function VerifyCard({ onChange, linkToken, fixedMasked, useSession }: {
  onChange: (s: VerifyState) => void
  /** Number is decided by the WhatsApp link: nothing to type. */
  linkToken?: string | null
  /** Shown instead of the input when the number is fixed (link or login). */
  fixedMasked?: string | null
  /** Use the logged-in customer's number. */
  useSession?: boolean
}) {
  const [enabled, setEnabled] = useState<boolean | null>(null)
  const [phone, setPhone] = useState('')
  const [secret, setSecret] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [otp, setOtp] = useState('')
  const [verified, setVerified] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [wait, setWait] = useState(0)
  const report = useRef(onChange)
  report.current = onChange
  const fixed = !!(linkToken || (useSession && fixedMasked))

  useEffect(() => {
    let live = true
    fetch('/api/verify/start', { cache: 'no-store' }).then(json).then((d) => {
      if (!live) return
      setEnabled(!!d.enabled)
      report.current({ enabled: !!d.enabled, secret: '', verified: false })
    }).catch(() => { if (live) { setEnabled(false); report.current({ enabled: false, secret: '', verified: false }) } })
    return () => { live = false }
  }, [])

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  const send = useCallback(async () => {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/verify/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, linkToken: linkToken || null, useSession: !!useSession }),
      })
      const d = await json(res)
      if (!res.ok) { setErr(d.message ?? 'Could not send the OTP.'); return }
      if (!d.enabled) { setEnabled(false); report.current({ enabled: false, secret: '', verified: false }); return }
      setSecret(d.secret); setSentTo(d.phoneMasked); setOtp(''); setWait(30)
      report.current({ enabled: true, secret: d.secret, verified: false })
    } catch {
      setErr('Network problem. Please try again.')
    } finally { setBusy(false) }
  }, [busy, phone, linkToken, useSession])

  const confirm = async () => {
    if (busy || otp.length !== 6) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/verify/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, otp }) })
      const d = await json(res)
      if (!res.ok) setErr(d.message ?? 'Could not check the OTP.')
      else { setVerified(true); report.current({ enabled: true, secret, verified: true }) }
    } finally { setBusy(false) }
  }

  if (!enabled) return null

  if (verified) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
        <Check className="h-5 w-5 shrink-0 text-green-700" strokeWidth={3} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-green-900">OTP verified</p>
          {sentTo && <p className="truncate text-sm text-green-800">{sentTo}</p>}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-xl border border-fk-line bg-white px-4 py-3">
      <p className="text-sm font-bold">Verify with a WhatsApp OTP</p>
      {!sentTo ? (
        <>
          {fixed ? (
            <p className="mt-1 text-sm text-fk-muted">We will send an OTP to your WhatsApp{fixedMasked ? ` (${fixedMasked})` : ''}.</p>
          ) : (
            <div className="mt-3 flex items-center rounded-xl border border-fk-line bg-white focus-within:border-fk-red focus-within:ring-1 focus-within:ring-fk-red">
              <span className="pl-4 text-base font-medium text-fk-muted sm:text-sm">+91</span>
              <input
                className="w-full bg-transparent px-3 py-3.5 text-base outline-none placeholder:text-fk-muted/70 sm:text-sm"
                placeholder="WhatsApp number" inputMode="numeric" autoComplete="tel-national" maxLength={10}
                value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
              />
            </div>
          )}
          <button onClick={send} disabled={busy || (!fixed && phone.length !== 10)} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#25d366] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
            {busy && <Loader2 className="h-4 w-4 animate-spin" />} Send OTP on WhatsApp
          </button>
        </>
      ) : (
        <>
          <p className="mt-1 text-sm text-fk-muted">We sent a 6-digit OTP to your WhatsApp ({sentTo}). Enter it below.</p>
          <div className="mt-3 flex gap-2">
            <input
              className="w-full rounded-xl border border-fk-line bg-white px-4 py-3 text-center text-lg font-bold tracking-[0.4em] outline-none focus:border-fk-red focus:ring-1 focus:ring-fk-red"
              inputMode="numeric" autoComplete="one-time-code" maxLength={6} placeholder="••••••"
              value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              onKeyDown={(e) => { if (e.key === 'Enter') void confirm() }}
            />
            <button onClick={confirm} disabled={busy || otp.length !== 6} className="shrink-0 rounded-xl bg-fk-red px-5 text-sm font-bold text-white disabled:opacity-50">
              {busy ? '…' : 'Verify'}
            </button>
          </div>
          <div className="mt-2 flex justify-between text-xs font-semibold text-fk-muted">
            <button onClick={send} disabled={wait > 0 || busy} className="underline disabled:no-underline disabled:opacity-60">{wait > 0 ? `Resend OTP in ${wait}s` : 'Resend OTP'}</button>
            {!fixed && <button onClick={() => { setSentTo(null); setSecret(''); setOtp(''); setErr(null) }} className="underline">Change number</button>}
          </div>
        </>
      )}
      {err && <p className="mt-2 text-sm font-semibold text-fk-red">{err}</p>}
    </div>
  )
}
