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

/** "Fried King Falnir" -> "Falnir" (the brand is already in the sidebar logo). */
const shortBranch = (name: string) => name.replace(/^fried\s*king\s*/i, '').trim() || name

/** One colour per branch so staff never mistake one dashboard for another. Unknown branches get a stable colour from their slug. */
const BRANCH_COLORS: Record<string, string> = { pandeshwar: '#ec1c23', falnir: '#1d6fd1', kadri: '#1f8a4c' }
const FALLBACK_COLORS = ['#7b3fe4', '#d97706', '#0e8a8a', '#c2185b']
function branchColor(slug: string) {
  if (BRANCH_COLORS[slug]) return BRANCH_COLORS[slug]
  let h = 0
  for (const ch of slug) h = (h * 31 + ch.charCodeAt(0)) >>> 0
  return FALLBACK_COLORS[h % FALLBACK_COLORS.length]
}

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
  const [meta, setMeta] = useState<DMeta | null>(null)
  const [updatedAt, setUpdatedAt] = useState<Date | null>(null)
  const api = useMemo(() => makeApi(slug, () => setUpdatedAt(new Date())), [slug])
  const [metaError, setMetaError] = useState('')
  const [branches, setBranches] = useState<BranchOpt[]>([])
  const [navOpen, setNavOpen] = useState(false)
  const [toastMsg, setToastMsg] = useState<string | null>(null)
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
      const fresh = await api.get<DMeta>('meta')
      setMeta(fresh)
      setMetaError('')
      try { sessionStorage.setItem(`fk_meta_${slug}`, JSON.stringify(fresh)) } catch { /* storage blocked */ }
    } catch (e) {
      setMetaError(e instanceof Error ? e.message : 'Could not load the dashboard')
    }
  }, [api, slug])
  // Show the last known branch/settings straight away (refreshed in the background) so pages do not wait on /meta.
  useEffect(() => {
    let cached: DMeta | null = null
    try { const raw = slug ? sessionStorage.getItem(`fk_meta_${slug}`) : null; cached = raw ? JSON.parse(raw) : null } catch { /* ignore */ }
    setMeta(cached)
    void reloadMeta()
  }, [reloadMeta, slug])

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

  // Which branch am I in? Shown big in the header and the sidebar, and in the browser tab title.
  const branchLabel = shortBranch(meta?.branch.name ?? slug)
  const branchTone = branchColor(meta?.branch.slug ?? slug)
  const helpPhone = (meta?.settings?.help_phone ?? '').replace(/\D/g, '')
  useEffect(() => {
    if (branchLabel) document.title = `${branchLabel} · Fried King Dashboard`
  }, [branchLabel])

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
          <button className="navdrawer-close" aria-label="Close menu" onClick={() => setNavOpen(false)}>✕</button>
          <div className="brandwrap">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-white.png" alt="Fried King" />
            <div className="kicker">ORDER HUB</div>
          </div>
          <div className="checker" />
          <nav aria-label="Dashboard">
            {nav.map((s) => (
              <Link key={s.key} className={s.mobileOnly ? 'mobnav' : undefined} href={slug ? `/dashboard/${slug}/${s.key}` : '/dashboard'} aria-current={active?.key === s.key ? 'page' : undefined} onClick={() => setNavOpen(false)}>
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
        <main className={helpPhone ? 'hashelp' : undefined}>
          {helpPhone && (
            <div className="helpbar" role="note">
              <span>Need help?</span>
              <a href={`tel:+91${helpPhone}`}>📞 Call +91 {helpPhone.slice(0, 5)} {helpPhone.slice(5)}</a>
              <a href={`https://wa.me/91${helpPhone}`} target="_blank" rel="noopener noreferrer">💬 WhatsApp</a>
            </div>
          )}
          <div className="head">
            <button id="mmenu" aria-label="Open menu" onClick={() => setNavOpen(true)}>☰</button>
            <h1>{active ? `${active.icon} ${active.label}` : 'Dashboard'}</h1>
            <div className="pills">
              {branchLabel && <span className="pilb branch" style={{ '--bc': branchTone } as React.CSSProperties} title={meta?.branch.name}>📍 {branchLabel}</span>}
              <span className="pilb ok">● Live</span>
              <span className="pilb upd" title="Last time data was fetched">⟳ Updated {updatedAt ? istTime(updatedAt) : '…'}</span>
              {!soundOn && <button className="pilb warn" onClick={() => { enableSound(); chime() }}>🔕 Tap to enable sound</button>}
            </div>
            <div className="mobonly">
              <button className="btn sm ghost" title={soundOn ? 'Sound on' : 'Enable sound'} onClick={() => { enableSound(); chime() }}>{soundOn ? '🔔' : '🔕'}</button>
              <button className="btn sm ghost" title="Refresh" onClick={() => { router.refresh(); window.dispatchEvent(new Event('fk-refresh')); toast('Refreshed') }}>↻</button>
              <button className="btn sm ghost" title="Sign out" onClick={signOut}>⏻</button>
            </div>
          </div>
          {metaError ? <div className="none">{metaError}</div>
            : !dash ? <div className="none">Loading…</div>
              : (
                <DashContext.Provider value={dash}>
                  {children}
                  <footer className="dash-foot">Powered by Loopdot</footer>
                  <NewOrderAlert onNew={(o) => { notify(o); if (soundOn) chime() }} sirenBeat={() => { if (soundOn) sirenBeat() }} />
                  <Toaster msg={toastMsg} />
                </DashContext.Provider>
              )}
        </main>
      </div>
    </div>
  )
}
