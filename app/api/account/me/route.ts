import { NextResponse } from 'next/server'
import { getCustomerPhone } from '@/lib/customer/session'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/** GET -> { loggedIn, phoneMasked, name, addresses, orders } for the logged-in customer. */
export async function GET() {
  const phone = await getCustomerPhone()
  if (!phone) return NextResponse.json({ loggedIn: false }, { headers: { 'Cache-Control': 'no-store' } })
  const phoneMasked = `+91 ${phone.slice(3, 5)}•••••${phone.slice(-3)}`
  try {
    const db = createAdminClient()
    const [{ data: custs }, { data: addresses }] = await Promise.all([
      db.from('customers').select('id, name, created_at').eq('phone', phone).order('created_at', { ascending: false }),
      db.from('customer_addresses').select('id, label, address').eq('phone', phone).order('created_at', { ascending: false }).limit(10),
    ])
    const ids = (custs ?? []).map((c) => c.id)
    const { data: orders } = ids.length
      ? await db.from('orders').select('order_number, status, total_paise, created_at, order_type, order_items(name_snapshot, quantity)')
          .in('customer_id', ids).neq('status', 'draft').order('created_at', { ascending: false }).limit(20)
      : { data: [] }
    return NextResponse.json({
      loggedIn: true,
      phoneMasked,
      name: (custs ?? []).find((c) => c.name)?.name ?? '',
      addresses: addresses ?? [],
      orders: orders ?? [],
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[account/me]', e instanceof Error ? e.message : e)
    return NextResponse.json({ loggedIn: true, phoneMasked, name: '', addresses: [], orders: [] })
  }
}
