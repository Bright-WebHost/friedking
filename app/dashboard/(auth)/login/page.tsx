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
    <main className="flex min-h-dvh items-center justify-center bg-white p-6">
      <form onSubmit={submit} className="w-full max-w-[330px]">
        <div className="mb-[22px]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-red.png" alt="Fried King" className="h-16 w-auto" />
          <h1 className="mt-2 font-display text-[34px] font-extrabold uppercase leading-none text-fk-red">Fried King</h1>
          <p className="mt-0 text-sm text-fk-muted">Staff dashboard</p>
        </div>
        {error && <p className="mb-2 rounded-[9px] border border-[#f5c6cb] bg-fk-tint px-3 py-2 text-sm font-medium text-fk-nonveg">{error}</p>}
        <div className="space-y-3">
          <input className="w-full rounded-[10px] border border-[#e6e9ee] bg-white p-3 outline-none focus:border-fk-red" type="email" placeholder="Email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required />
          <input className="w-full rounded-[10px] border border-[#e6e9ee] bg-white p-3 outline-none focus:border-fk-red" type="password" placeholder="Password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        <button className="mt-1 w-full rounded-[10px] bg-fk-red p-3 font-bold text-white disabled:opacity-60" disabled={loading}>
          {loading ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </main>
  )
}
