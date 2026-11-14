'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { StaffContext } from '@/lib/auth/staff'
import { canSee, ROLE_LABEL, SECTIONS } from '@/lib/dashboard/access'
import type { DMeta, DOrder } from '@/lib/dashboard/types'
import { DashContext, istTime, makeApi, Toaster, type Dash } from './kit'
import NewOrderAlert from './NewOrderAlert'

type BranchOpt = { id: string; name: string; slug: string }

// ---------------------------------------------------------------- sound (Oceana's chime + siren)
let audio: AudioContext | null = null
function beep(freqs: number[], type: OscillatorType, gap: number, len: number, vol: number) {
  if (!audio) return
  freqs.forEach((f, i) => {
    const o = audio!.createOscillator(), g = audio!.createGain(), t = audio!.currentTime + i * gap
    o.connect(g); g.connect(audio!.destination); o.type = type; o.frequency.value = f
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t + len)
    o.start(t); o.stop(t + len + 0.04)
  })
}
const chime = () => beep([784, 1046, 1318], 'sine', 0.18, 0.26, 0.32)
const sirenBeat = () => { beep([988, 1318, 988], 'square', 0.22, 0.2, 0.34); navigator.vibrate?.([220, 110, 220]) }
const soundConsented = () => { try { return localStorage.getItem('fk_sound_ok') === '1' } catch { return false } }

export default function DashboardShell({ staff, children }: { staff: StaffContext; children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [, , slugFromUrl, sectionFromUrl] = pathname.split('/')
  const slug = slugFromUrl && !SECTIONS.some((s) => s.key === slugFromUrl) ? slugFromUrl : ''
  const api = useMemo(() => makeApi(slug), [slug])

  const [meta, setMeta] = useState<DMeta | null>(null)
  const [metaError, setMetaError] = useState('')
  const [branches, setBranches] = useState<BranchOpt[]>([])
  const [navOpen, setNavOpen] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const [soundOn, setSoundOn] = useState(false)
  const [gate, setGate] = useState(false)
  const busy = useRef(0)
  const handoff = useRef<Record<string, unknown> | null>(null)
  const toastTimer = useRef<number | undefined>(undefined)

  const toast = useCallback((msg: string) => {
    setToastMsg(msg)
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToastMsg(null), 3400)
  }, [])

  const reloadMeta = useCallback(async () => {
    if (!slug) return
    try {
      setMeta(await api.get<DMeta>('meta'))
      setMetaError('')
    } catch (e) {
      setMetaError(e instanceof Error ? e.message : 'Could not load the dashboard')
    }
  }, [api, slug])
  useEffect(() => { setMeta(null); void reloadMeta() }, [reloadMeta])

  useEffect(() => {
    fetch('/api/dashboard/me', { cache: 'no-store' })
      .then(async (r) => {
        const data = await r.json()
        if (!r.ok) throw new Error(data.message ?? 'Could not load branches')
        setBranches(data.branches ?? [])
      })
      .catch((error) => setMetaError(error instanceof Error ? error.message : 'Could not load branches'))
  }, [])

  // The root /dashboard route can briefly render before its server redirect completes.
  // Resolve it client-side as well so the shell never waits for a branch-less API URL.
  useEffect(() => {
    if (slug || branches.length === 0) return
    const section = SECTIONS.find((candidate) => canSee(staff.role, candidate.key))?.key ?? 'orders'
    router.replace(`/dashboard/${branches[0].slug}/${section}`)
  }, [branches, router, slug, staff.role])

  // ---- sound + wake lock + shift gate
  const enableSound = useCallback(() => {
    try {
      audio = audio ?? new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)()
      void audio.resume()
    } catch { /* no audio */ }
    setSoundOn(true)
    try { localStorage.setItem('fk_sound_ok', '1') } catch { /* storage blocked */ }
    try { if ('Notification' in window && Notification.permission === 'default') void Notification.requestPermission() } catch { /* unsupported */ }
  }, [])
  const keepAwake = useCallback(async () => {
    try { await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<unknown> } }).wakeLock?.request('screen') } catch { /* not allowed */ }
  }, [])
  useEffect(() => {
    if (soundConsented()) {
      // Audio needs one gesture per tab: the next tap anywhere unlocks it silently.
      const unlock = () => enableSound()
      document.addEventListener('pointerdown', unlock, { once: true })
      setSoundOn(true)
      return () => document.removeEventListener('pointerdown', unlock)
    }
    if (window.innerWidth <= 860) setGate(true)
  }, [enableSound])
  useEffect(() => {
    void keepAwake()
    const vis = () => { if (!document.hidden) void keepAwake() }
    document.addEventListener('visibilitychange', vis)
    return () => document.removeEventListener('visibilitychange', vis)
  }, [keepAwake])

  const ping = useCallback(() => { if (soundOn) chime() }, [soundOn])

  const dash = useMemo<Dash | null>(() => meta && slug ? {
    slug, api, branch: meta.branch, settings: meta.settings, riders: meta.riders, staff: meta.staff,
    toast, reloadMeta, busy, handoff,
    sound: { on: soundOn, enable: enableSound, ping },
    go: (section, state) => { handoff.current = state ?? null; router.push(`/dashboard/${slug}/${section}`) },
    updated: (when) => setUpdatedAt(when ?? new Date()),
  } : null, [meta, slug, api, toast, reloadMeta, soundOn, enableSound, ping, router])

  const nav = SECTIONS.filter((s) => canSee(staff.role, s.key))
  const active = SECTIONS.find((s) => s.key === sectionFromUrl) ?? nav[0]

  const signOut = async () => {
    await createClient().auth.signOut()
    router.replace('/dashboard/login')
    router.refresh()
  }

  const notify = useCallback((o: DOrder) => {
    try {
      if (!('Notification' in window) || Notification.permission !== 'granted') return
      const n = new Notification(`🔔 New ${o.order_type === 'pickup' ? 'takeaway' : o.order_type} order`, {
        body: `${o.customer?.name || 'Guest'} · ₹${(o.total_paise / 100).toFixed(0)}`, tag: `fk-${o.order_number}`, requireInteraction: true,
      })
      n.onclick = () => { window.focus(); n.close() }
    } catch { /* unsupported */ }
  }, [])

  return (
    <div className="fkd">
      {gate && (
        <div id="shiftgate">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-white.png" alt="Fried King" />
            <h1>Start your shift</h1>
            <p>This device will stay awake and ring on every new order for the rest of the shift. Tap once to begin.</p>
            <button className="btn" onClick={() => { enableSound(); chime(); void keepAwake(); setGate(false) }}>🔔 Start shift · enable sound</button>
            <button className="ghostbtn" onClick={() => setGate(false)}>Skip for now</button>
          </div>
        </div>
      )}
      <div className="shell">
        <aside className={navOpen ? 'open' : ''}>
          <div className="brandwrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-white.png" alt="Fried King" />
            <div className="kicker">ORDER HUB</div>
          </div>
          <div className="checker" />
          <nav aria-label="Dashboard">
            {nav.map((s) => (
              <Link key={s.key} href={slug ? `/dashboard/${slug}/${s.key}` : '/dashboard'} aria-current={active?.key === s.key ? 'page' : undefined} onClick={() => setNavOpen(false)}>
                <span aria-hidden style={{ width: 20, textAlign: 'center' }}>{s.icon}</span>{s.label}
              </Link>
            ))}
          </nav>
          <div className="side-foot">
            <span className="roletag">{(meta?.staff.name ?? staff.name)} · {ROLE_LABEL[staff.role]}</span>
            {staff.branchId === null && branches.length > 1 && (
              <select aria-label="Branch" value={slug} onChange={(e) => router.push(`/dashboard/${e.target.value}/${active?.key ?? 'orders'}`)}>
                {branches.map((b) => <option key={b.id} value={b.slug}>{b.name}</option>)}
              </select>
            )}
            <button onClick={() => { router.refresh(); window.dispatchEvent(new Event('fk-refresh')); toast('Refreshed') }}>↻ Refresh now</button>
            <button onClick={() => { enableSound(); chime() }} disabled={soundOn}>{soundOn ? '🔔 Sound on' : '🔔 Enable sound'}</button>
            <button onClick={signOut}>Sign out</button>
          </div>
        </aside>
        {navOpen && <div className="navbackdrop" onClick={() => setNavOpen(false)} />}
        <main>
          <div className="head">
            <button id="mmenu" aria-label="Open menu" onClick={() => setNavOpen(true)}>☰</button>
            <h1>{active ? `${active.icon} ${active.label}` : 'Dashboard'}</h1>
            <div className="pills">
              <span className="pilb ok">● Live</span>
              <span className="pilb deskonly">Updated {updatedAt ? istTime(updatedAt) : '—'}</span>
              {meta && <span className="pilb">{meta.branch.name}</span>}
              {!soundOn && <button className="pilb warn" onClick={() => { enableSound(); chime() }}>🔕 Tap to enable sound</button>}
            </div>
          </div>
          {metaError ? <div className="none">{metaError}</div>
            : !dash ? <div className="none">Loading…</div>
              : (
                <DashContext.Provider value={dash}>
                  {children}
                  <NewOrderAlert onNew={(o) => { notify(o); if (soundOn) chime() }} sirenBeat={() => { if (soundOn) sirenBeat() }} />
                  <Toaster msg={toastMsg} />
                </DashContext.Provider>
              )}
        </main>
      </div>
    </div>
  )
}
