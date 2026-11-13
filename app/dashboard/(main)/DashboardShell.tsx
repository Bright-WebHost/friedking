'use client'

import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import type { StaffContext } from '@/lib/auth/staff'

type Branch = { id: string; name: string; slug: string }

export default function DashboardShell({ staff, children }: { staff: StaffContext; children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const [branches, setBranches] = useState<Branch[]>([])

  useEffect(() => {
    fetch('/api/dashboard/me', { cache: 'no-store' })
      .then(async (res) => {
        if (!res.ok) throw new Error('Unable to load dashboard')
        return res.json()
      })
      .then((data: { branches: Branch[] }) => setBranches(data.branches))
      .catch(() => undefined)
  }, [])

  const selectedBranch = pathname.split('/')[2] && !['orders', 'menu'].includes(pathname.split('/')[2])
    ? pathname.split('/')[2]
    : null
  const activeBranch = selectedBranch ? branches.find((branch) => branch.slug === selectedBranch) : null
  const defaultBranch = staff.branchId ? branches.find((branch) => branch.id === staff.branchId) : null
  const branchSlug = activeBranch?.slug ?? defaultBranch?.slug ?? null
  const base = branchSlug ? `/dashboard/${branchSlug}` : '/dashboard'

  const nav = useMemo(() => [
    { href: `${base}/orders`, label: 'Orders', icon: '▣' },
    { href: `${base}/menu`, label: 'Menu', icon: '☷' },
  ], [base])

  const signOut = async () => {
    await createClient().auth.signOut()
    router.replace('/dashboard/login')
    router.refresh()
  }

  return (
    <div className="min-h-dvh bg-fk-bg">
      <header className="sticky top-0 z-30 border-b border-fk-line bg-white">
        <div className="mx-auto flex h-16 max-w-6xl items-center gap-4 px-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-red.png" alt="Fried King" className="h-10 w-auto" />
          <span className="hidden font-display text-xl font-extrabold uppercase sm:block">Staff dashboard</span>
          <div className="ml-auto flex items-center gap-2">
            {staff.branchId === null && branches.length > 0 && (
              <select
                className="max-w-[150px] rounded-lg border border-fk-line bg-white px-2 py-2 text-sm font-semibold outline-none focus:border-fk-red"
                value={activeBranch?.slug ?? ''}
                onChange={(event) => router.push(event.target.value ? `/dashboard/${event.target.value}/orders` : '/dashboard/orders')}
              >
                <option value="">All branches</option>
                {branches.map((branch) => <option key={branch.id} value={branch.slug}>{branch.name}</option>)}
              </select>
            )}
            <button onClick={signOut} className="rounded-lg border border-fk-line px-3 py-2 text-sm font-bold hover:bg-fk-bg">Sign out</button>
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-6xl gap-6 px-4 py-5">
        <aside className="hidden w-44 shrink-0 md:block">
          <nav className="sticky top-[84px] space-y-1">
            {nav.map((item) => (
              <Link key={item.href} href={item.href} className={`flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold ${pathname.startsWith(item.href) ? 'bg-fk-red text-white' : 'text-fk-ink hover:bg-white'}`}>
                <span aria-hidden>{item.icon}</span>{item.label}
              </Link>
            ))}
          </nav>
          <p className="mt-6 break-all px-3 text-xs text-fk-muted">{staff.email}</p>
        </aside>
        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  )
}
