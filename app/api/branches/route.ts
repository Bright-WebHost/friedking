import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSecondaryBranch, secondaryBranches } from '@/lib/supabase/project'
import type { Branch } from '@/lib/types'

export const dynamic = 'force-dynamic'

async function loadBranches(branch?: string): Promise<Branch[]> {
  const { data, error } = await createAdminClient(branch)
    .from('branches')
    .select('id, slug, name, address, phone, opens_at, closes_at')
    .eq('is_active', true)
    .order('name', { ascending: true })
    .abortSignal(AbortSignal.timeout(2500))

  if (error) throw new Error(error.message)
  return (data ?? [])
    .filter((row) => isSecondaryBranch(row.slug) === isSecondaryBranch(branch))
    .map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      address: row.address,
      phone: row.phone,
      opensAt: row.opens_at,
      closesAt: row.closes_at,
    }))
}

export async function GET() {
  const secondary = secondaryBranches[0]
  const results = await Promise.allSettled([loadBranches(), ...(secondary ? [loadBranches(secondary)] : [])])
  const branches = results.flatMap((result) => result.status === 'fulfilled' ? result.value : [])
    .sort((a, b) => a.name.localeCompare(b.name))
  if (results.every((result) => result.status === 'rejected')) {
    return NextResponse.json({ message: 'Unable to load branches' }, { status: 503 })
  }
  return NextResponse.json({ branches }, { headers: { 'Cache-Control': 'no-store' } })
}
