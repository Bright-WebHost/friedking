import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { loadDeliveryRules } from '@/lib/delivery'

export const dynamic = 'force-dynamic'

/** GET /api/rules?branch=pandeshwar -> delivery rules for the checkout (fee, free-delivery offer, minimum, pincodes, order types). */
export async function GET(req: NextRequest) {
  const slug = (req.nextUrl.searchParams.get('branch') ?? '').trim().toLowerCase()
  if (!slug) return NextResponse.json({ message: 'branch is required' }, { status: 400 })
  const db = createAdminClient(slug)
  const { data: b } = await db.from('branches').select('id').eq('slug', slug).eq('is_active', true).maybeSingle()
  if (!b) return NextResponse.json({ message: 'Branch not found' }, { status: 404 })
  const rules = await loadDeliveryRules(db, b.id)
  return NextResponse.json({ rules }, { headers: { 'Cache-Control': 'no-store' } })
}
