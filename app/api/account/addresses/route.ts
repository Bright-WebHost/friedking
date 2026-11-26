import { NextRequest, NextResponse } from 'next/server'
import { getCustomerPhone } from '@/lib/customer/session'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/** POST { action: 'add', address, label? } | { action: 'delete', id } for the logged-in customer. */
export async function POST(req: NextRequest) {
  const branch = req.nextUrl.searchParams.get('branch')
  const phone = await getCustomerPhone(branch)
  if (!phone) return NextResponse.json({ message: 'Please log in.' }, { status: 401 })
  const b = await req.json().catch(() => ({}))
  const db = createAdminClient(branch)
  if (b.action === 'delete') {
    await db.from('customer_addresses').delete().eq('id', String(b.id ?? '')).eq('phone', phone)
    return NextResponse.json({ ok: true })
  }
  if (b.action === 'add') {
    const address = String(b.address ?? '').trim().slice(0, 400)
    const label = String(b.label ?? '').trim().slice(0, 30) || null
    if (!address) return NextResponse.json({ message: 'Enter an address' }, { status: 400 })
    const { count } = await db.from('customer_addresses').select('id', { count: 'exact', head: true }).eq('phone', phone)
    if ((count ?? 0) >= 10) return NextResponse.json({ message: 'You can save up to 10 addresses.' }, { status: 400 })
    const { data: dup } = await db.from('customer_addresses').select('id').eq('phone', phone).eq('address', address).maybeSingle()
    if (!dup) await db.from('customer_addresses').insert({ phone, label, address })
    return NextResponse.json({ ok: true })
  }
  return NextResponse.json({ message: 'Unknown action' }, { status: 400 })
}
