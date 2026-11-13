'use client'

import { FormEvent, useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export default function DashboardLoginPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('error') === 'unauthorized') {
      setError('You are not authorised for the staff dashboard.')
    }
  }, [])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    setLoading(true)
    setError('')
    const { error: signInError } = await createClient().auth.signInWithPassword({ email, password })
    if (signInError) {
      setError(signInError.message)
      setLoading(false)
      return
    }
    router.replace('/dashboard')
    router.refresh()
  }

  return (
    <main className="flex min-h-dvh items-center justify-center bg-fk-bg p-4">
      <form onSubmit={submit} className="w-full max-w-sm rounded-3xl border border-fk-line bg-white p-7 shadow-xl shadow-black/5">
        <div className="mb-7 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-red.png" alt="Fried King" className="mx-auto h-20 w-auto" />
          <h1 className="mt-4 font-display text-3xl font-extrabold uppercase">Staff dashboard</h1>
          <p className="mt-1 text-sm text-fk-muted">Sign in to manage orders and menu availability.</p>
        </div>
        {error && <p className="mb-4 rounded-xl bg-fk-tint px-3 py-2 text-sm font-medium text-fk-nonveg">{error}</p>}
        <div className="space-y-3">
          <input className="w-full rounded-xl border border-fk-line px-4 py-3 outline-none focus:border-fk-red" type="email" placeholder="Email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="w-full rounded-xl border border-fk-line px-4 py-3 outline-none focus:border-fk-red" type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button className="mt-5 w-full rounded-xl bg-fk-red py-3.5 font-bold text-white disabled:opacity-60" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
