import { NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Branch } from '@/lib/types'

export const dynamic = 'force-dynamic'

export async function GET() {
  let supabase: ReturnType<typeof createAdminClient>
  try {
    supabase = createAdminClient()
  } catch (e) {
    console.error('[GET /api/branches]', e instanceof Error ? e.message : e)
    return NextResponse.json({ message: 'Unable to load branches' }, { status: 500 })
  }

  const { data, error } = await supabase
    .from('branches')
    .select('id, slug, name, address, phone, opens_at, closes_at')
    .eq('is_active', true)
    .order('name', { ascending: true })

  if (error) {
    console.error('[GET /api/branches]', error.message)
    return NextResponse.json({ message: 'Unable to load branches' }, { status: 500 })
  }

  const branches: Branch[] = (data ?? []).map((b) => ({
    id: b.id,
    slug: b.slug,
    name: b.name,
    address: b.address,
    phone: b.phone,
    opensAt: b.opens_at,
    closesAt: b.closes_at,
  }))

  return NextResponse.json({ branches }, { headers: { 'Cache-Control': 'no-store' } })
}
