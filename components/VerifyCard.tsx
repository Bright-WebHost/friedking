'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'

export interface VerifyState { enabled: boolean; secret: string; verified: boolean }

type Method = 'otp' | 'message'
interface Caps { enabled: boolean; otp: boolean; message: boolean }

async function json(res: Response) {
  try { return await res.json() } catch { return {} }
}

/**
 * Proves the customer's WhatsApp number. Two ways, depending on what the branch supports:
 *  - OTP: we send a 6-digit OTP on WhatsApp and the customer types it here (needs an approved WhatsApp template when the
 *    customer has not messaged the branch in the last 24 hours).
 *  - WhatsApp message: the customer taps a button that opens WhatsApp with "VERIFY ABC123" ready to send to the branch
 *    number. Sending it opens the free 24-hour window and proves the number; this page notices on its own. No template needed.
 * Reports { enabled, secret, verified } to the parent. enabled=false means verification is not installed yet
 * (the parent falls back to the plain phone field).
 */
export default function VerifyCard({ onChange, linkToken, fixedMasked, useSession, branch }: {
  onChange: (s: VerifyState) => void
  /** Number is decided by the WhatsApp link: nothing to type. */
  linkToken?: string | null
  /** Shown instead of the input when the number is fixed (link or login). */
  fixedMasked?: string | null
  /** Use the logged-in customer's number. */
  useSession?: boolean
  /** Branch slug: each branch has its own WhatsApp number and its own verification settings. */
  branch?: string | null
}) {
  const [caps, setCaps] = useState<Caps | null>(null)
  const [method, setMethod] = useState<Method>('otp')
  const [phone, setPhone] = useState('')
  const [secret, setSecret] = useState('')
  const [sentTo, setSentTo] = useState<string | null>(null)
  const [otp, setOtp] = useState('')
  const [verified, setVerified] = useState<null | { how: Method; masked: string | null }>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [wait, setWait] = useState(0)
  // message method
  const [msg, setMsg] = useState<null | { secret: string; code: string; waLink: string; whatsapp: string }>(null)
  const [expired, setExpired] = useState(false)
  const report = useRef(onChange)
  report.current = onChange
  const fixed = !!(linkToken || (useSession && fixedMasked))
  const branchQ = branch ? `?branch=${encodeURIComponent(branch)}` : ''

  useEffect(() => {
    let live = true
    fetch(`/api/verify/start${branchQ}`, { cache: 'no-store' }).then(json).then((d) => {
      if (!live) return
      const c: Caps = { enabled: !!d.enabled, otp: !!d.otp, message: !!d.message }
      setCaps(c)
      setMethod(c.otp ? 'otp' : 'message')
      report.current({ enabled: c.enabled, secret: '', verified: false })
    }).catch(() => { if (live) { setCaps({ enabled: false, otp: false, message: false }); report.current({ enabled: false, secret: '', verified: false }) } })
    return () => { live = false }
  }, [branchQ])

  useEffect(() => {
    if (wait <= 0) return
    const t = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(t)
  }, [wait])

  // ── OTP method ──────────────────────────────────────────────────────────────
  const send = useCallback(async () => {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/verify/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'otp', branch: branch || undefined, phone, linkToken: linkToken || null, useSession: !!useSession }),
      })
      const d = await json(res)
      if (!res.ok) { setErr(d.message ?? 'Could not send the OTP.'); return }
      if (!d.enabled) { setCaps({ enabled: false, otp: false, message: false }); report.current({ enabled: false, secret: '', verified: false }); return }
      setSecret(d.secret); setSentTo(d.phoneMasked); setOtp(''); setWait(30)
      report.current({ enabled: true, secret: d.secret, verified: false })
    } catch {
      setErr('Network problem. Please try again.')
    } finally { setBusy(false) }
  }, [busy, phone, linkToken, useSession, branch])

  const confirm = async () => {
    if (busy || otp.length !== 6) return
    setBusy(true); setErr(null)
    try {
      const res = await fetch('/api/verify/confirm', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ secret, otp }) })
      const d = await json(res)
      if (!res.ok) setErr(d.message ?? 'Could not check the OTP.')
      else { setVerified({ how: 'otp', masked: sentTo }); report.current({ enabled: true, secret, verified: true }) }
    } finally { setBusy(false) }
  }

  // ── WhatsApp message method ─────────────────────────────────────────────────
  const startMessage = useCallback(async () => {
    if (busy) return
    setBusy(true); setErr(null); setExpired(false)
    try {
      const res = await fetch('/api/verify/start', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'message', branch: branch || undefined }),
      })
      const d = await json(res)
      if (!res.ok) { setErr(d.message ?? 'Could not start the verification.'); return }
      setMsg({ secret: d.secret, code: d.code, waLink: d.waLink, whatsapp: d.whatsapp })
      report.current({ enabled: true, secret: d.secret, verified: false })
    } catch {
      setErr('Network problem. Please try again.')
    } finally { setBusy(false) }
  }, [busy, branch])

  // Wait for the customer's message: check every 2 s while the page is visible, and straight away when they come back from WhatsApp.
  useEffect(() => {
    if (!msg || verified || expired) return
    let stop = false
    const check = async () => {
      if (stop || document.visibilityState === 'hidden') return
      try {
        const res = await fetch(`/api/verify/status?secret=${msg.secret}`, { cache: 'no-store' })
        const d = await json(res)
        if (stop) return
        if (d.verified) { setVerified({ how: 'message', masked: d.phoneMasked ?? null }); report.current({ enabled: true, secret: msg.secret, verified: true }) }
        else if (d.expired) setExpired(true)
      } catch { /* network blip: the next tick tries again */ }
    }
    const timer = setInterval(check, 2000)
    const onVisible = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => { stop = true; clearInterval(timer); document.removeEventListener('visibilitychange', onVisible); window.removeEventListener('focus', onVisible) }
  }, [msg, verified, expired])

  if (!caps?.enabled) return null

  if (verified) {
    return (
      <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
        <Check className="h-5 w-5 shrink-0 text-green-700" strokeWidth={3} />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-bold text-green-900">{verified.how === 'otp' ? 'OTP verified' : 'WhatsApp number verified'}</p>
          {verified.masked && <p className="truncate text-sm text-green-800">{verified.masked}</p>}
        </div>
      </div>
    )
  }

  if (!caps.otp && !caps.message) {
    return (
      <div className="rounded-xl border border-fk-line bg-white px-4 py-3">
        <p className="text-sm font-bold">Verify your WhatsApp number</p>
        <p className="mt-1 text-sm text-fk-muted">Verification is not available for this branch right now. Please try again later.</p>
      </div>
    )
  }

  // ── WhatsApp message UI ─────────────────────────────────────────────────────
  if (method === 'message') {
    return (
      <div className="rounded-xl border border-fk-line bg-white px-4 py-3">
        <p className="text-sm font-bold">Verify your WhatsApp number</p>
        {!msg ? (
          <>
            <p className="mt-1 text-sm text-fk-muted">Tap the button, then press <b>Send</b> on the message that WhatsApp opens. Your number is verified in a moment.</p>
            <button onClick={startMessage} disabled={busy} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#25d366] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Verify on WhatsApp
            </button>
          </>
        ) : expired ? (
          <>
            <p className="mt-1 text-sm font-semibold text-fk-red">This code has expired.</p>
            <button onClick={startMessage} disabled={busy} className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#25d366] px-4 py-3 text-sm font-bold text-white disabled:opacity-50">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Get a new code
            </button>
          </>
        ) : (
          <>
            <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-fk-muted">
              <li>Tap <b>Open WhatsApp</b> below.</li>
              <li>Press <b>Send</b> on the message that is ready to go.</li>
              <li>Come back here. We will continue by ourselves.</li>
            </ol>
            <a href={msg.waLink} target="_blank" rel="noopener noreferrer" className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[#25d366] px-4 py-3 text-sm font-bold text-white">
              Open WhatsApp
            </a>
            <p className="mt-3 flex items-center justify-center gap-2 text-xs font-semibold text-fk-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Waiting for your message…
            </p>
            <p className="mt-2 text-center text-xs text-fk-muted">
              Button not working? Send <b className="tracking-wider text-black">VERIFY {msg.code}</b> to +{msg.whatsapp.slice(0, 2)} {msg.whatsapp.slice(2)} from your WhatsApp.
            </p>
          </>
        )}
        {caps.otp && (
          <p className="mt-3 text-center text-xs font-semibold">
            <button onClick={() => { setMethod('otp'); setErr(null) }} className="text-fk-muted underline">Get an OTP instead</button>
          </p>
        )}
        {err && <p className="mt-2 text-sm font-semibold text-fk-red">{err}</p>}
      </div>
    )
  }

  // ── OTP UI ──────────────────────────────────────────────────────────────────
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
      {caps.message && (
        <p className="mt-3 text-center text-xs font-semibold">
          <button onClick={() => { setMethod('message'); setErr(null) }} className="text-fk-muted underline">{err ? 'Verify by WhatsApp message instead' : 'No OTP? Verify by WhatsApp message'}</button>
        </p>
      )}
      {err && <p className="mt-2 text-sm font-semibold text-fk-red">{err}</p>}
    </div>
  )
}
