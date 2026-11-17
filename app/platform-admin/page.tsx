'use client'

import { FormEvent, useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

interface Branch {
  id: string
  name: string
  slug: string
  blastMonthlyLimit: number
  blastSentThisMonth: number
  blastRemaining: number
}

interface AuditRow {
  id: string
  branch_id: string | null
  action: string
  from_value: string | null
  to_value: string | null
  detail: string | null
  created_at: string
}

interface AdminData {
  adminName: string
  branches: Branch[]
  audit: AuditRow[]
}

export default function PlatformAdminPage() {
  const [data, setData] = useState<AdminData | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const load = async () => {
    const response = await fetch('/api/platform-admin', { cache: 'no-store' })
    if (response.ok) {
      setData(await response.json() as AdminData)
    } else if (response.status !== 403) {
      const result = await response.json().catch(() => null) as { message?: string } | null
      setError(result?.message || 'Could not load platform settings')
    }
  }

  useEffect(() => {
    void (async () => {
      const { data: session } = await createClient().auth.getSession()
      if (session.session) await load()
    })()
  }, [])

  const signIn = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setBusy(true); setError('')
    const { error: signInError } = await createClient().auth.signInWithPassword({ email, password })
    if (signInError) {
      setError(signInError.message)
    } else {
      await load()
      setError('')
    }
    setBusy(false)
  }

  const save = async (branchId: string, value: string) => {
    setBusy(true); setError(''); setMessage('')
    try {
      const response = await fetch('/api/platform-admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ branchId, monthlyLimit: value }),
      })
      const result = await response.json() as { message?: string }
      if (!response.ok) throw new Error(result.message || 'Could not save the limit')
      setMessage('Blast limit updated and audit logged.')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save the limit')
    } finally { setBusy(false) }
  }

  const signOut = async () => {
    await createClient().auth.signOut()
    setData(null)
  }

  if (!data) return (
    <main className="flex min-h-dvh items-center justify-center bg-[#fffaf7] p-6">
      <form onSubmit={(event) => void signIn(event)} className="w-full max-w-[360px] rounded-2xl bg-white p-7 shadow-sm">
        <h1 className="font-display text-3xl font-extrabold uppercase text-fk-red">Platform admin</h1>
        <p className="mt-1 mb-5 text-sm text-fk-muted">Internal controls</p>
        {error && <p className="mb-3 rounded-lg bg-fk-tint px-3 py-2 text-sm text-fk-nonveg">{error}</p>}
        <input className="mb-3 w-full rounded-lg border border-[#e6e9ee] p-3" type="email" placeholder="Email" value={email} onChange={(event) => setEmail(event.target.value)} required />
        <input className="mb-3 w-full rounded-lg border border-[#e6e9ee] p-3" type="password" placeholder="Password" value={password} onChange={(event) => setPassword(event.target.value)} required />
        <button className="w-full rounded-lg bg-fk-red p-3 font-bold text-white disabled:opacity-60" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
    </main>
  )

  return (
    <main className="min-h-dvh bg-[#fffaf7] p-6 text-[#242424]">
      <div className="mx-auto max-w-4xl">
        <header className="mb-6 flex items-start justify-between gap-4">
          <div><h1 className="font-display text-3xl font-extrabold uppercase text-fk-red">Platform admin</h1><p className="text-sm text-fk-muted">Signed in as {data.adminName}</p></div>
          <button className="rounded-lg border border-[#e6e9ee] bg-white px-3 py-2 text-sm font-bold" onClick={() => void signOut()}>Sign out</button>
        </header>
        {error && <p className="mb-3 rounded-lg bg-fk-tint px-3 py-2 text-sm text-fk-nonveg">{error}</p>}
        {message && <p className="mb-3 rounded-lg bg-[#e7f6ed] px-3 py-2 text-sm text-[#1f8a4c]">{message}</p>}
        <section className="rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-1 text-lg font-bold">Monthly promotion limits</h2>
          <p className="mb-4 text-sm text-fk-muted">Changes apply to the selected branch and are recorded in the platform audit log.</p>
          <div className="space-y-3">
            {data.branches.map((branch) => <BranchLimit key={branch.id} branch={branch} disabled={busy} onSave={save} />)}
          </div>
        </section>
        <section className="mt-6 rounded-2xl bg-white p-5 shadow-sm">
          <h2 className="mb-3 text-lg font-bold">Recent changes</h2>
          {data.audit.length ? <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b"><th className="p-2">When</th><th className="p-2">Change</th><th className="p-2">Details</th></tr></thead><tbody>
            {data.audit.map((row) => <tr key={row.id} className="border-b last:border-0"><td className="p-2 whitespace-nowrap">{new Date(row.created_at).toLocaleString('en-IN')}</td><td className="p-2">{row.from_value} → {row.to_value}</td><td className="p-2">{row.detail || row.action}</td></tr>)}
          </tbody></table></div> : <p className="text-sm text-fk-muted">No changes yet.</p>}
        </section>
      </div>
    </main>
  )
}

function BranchLimit({ branch, disabled, onSave }: { branch: Branch; disabled: boolean; onSave: (id: string, value: string) => Promise<void> }) {
  const [value, setValue] = useState(String(branch.blastMonthlyLimit))
  useEffect(() => { setValue(String(branch.blastMonthlyLimit)) }, [branch.blastMonthlyLimit])
  return <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[#e6e9ee] p-3">
    <div className="min-w-[180px] flex-1"><b>{branch.name}</b><div className="text-xs text-fk-muted">{branch.slug}</div><div className="mt-1 text-xs font-semibold text-fk-muted">Used {branch.blastSentThisMonth} · Remaining {branch.blastRemaining}</div></div>
    <input className="w-36 rounded-lg border border-[#e6e9ee] p-2" type="number" min="0" max="1000000" value={value} onChange={(event) => setValue(event.target.value)} />
    <button className="rounded-lg bg-fk-red px-4 py-2 text-sm font-bold text-white disabled:opacity-60" disabled={disabled} onClick={() => void onSave(branch.id, value)}>Save</button>
  </div>
}

