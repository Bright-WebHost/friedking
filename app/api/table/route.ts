import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { findTable, openSession } from '@/lib/tables'

export const dynamic = 'force-dynamic'
const noStore = { 'Cache-Control': 'no-store' }

/**
 * GET /api/table?branch=pandeshwar&table=3
 * -> { exists, open, hasContact, customerName, rounds: [{ orderNumber, status, createdAt, totalPaise, items }], totalPaise }
 * What a diner sees on the website: the rounds on their table's open tab and the running total. No phone number is returned.
 */
export async function GET(req: NextRequest) {
  const slug = (req.nextUrl.searchParams.get('branch') ?? '').trim().toLowerCase()
  const tableNumber = Number(req.nextUrl.searchParams.get('table'))
  if (!slug || !Number.isInteger(tableNumber) || tableNumber < 1 || tableNumber > 999) {
    return NextResponse.json({ exists: false }, { status: 400, headers: noStore })
  }
  const db = createAdminClient(slug)
  const { data: branch } = await db.from('branches').select('id').eq('slug', slug).eq('is_active', true).maybeSingle()
  if (!branch) return NextResponse.json({ exists: false }, { status: 404, headers: noStore })
  const table = await findTable(db, branch.id, tableNumber)
  if (!table) return NextResponse.json({ exists: false }, { headers: noStore })
  const session = await openSession(db, table.id)
  if (!session) return NextResponse.json({ exists: true, open: false, rounds: [], totalPaise: 0 }, { headers: noStore })

  const { data: orders } = await db.from('orders')
    .select('order_number, status, created_at, total_paise, items:order_items(name_snapshot, quantity)')
    .eq('table_session_id', session.id).in('status', ['pending', 'confirmed', 'preparing', 'ready', 'delivered', 'cancelled']).order('created_at')
  const rounds = (orders ?? []).map((o) => ({
    orderNumber: o.order_number as number,
    status: o.status as string,
    createdAt: o.created_at as string,
    totalPaise: o.total_paise as number,
    items: ((o.items ?? []) as Array<{ name_snapshot: string; quantity: number }>).map((i) => ({ name: i.name_snapshot, quantity: i.quantity })),
  }))
  const totalPaise = rounds.filter((r) => r.status !== 'cancelled').reduce((s, r) => s + r.totalPaise, 0)
  return NextResponse.json({
    exists: true, open: true, hasContact: Boolean(session.phone), customerName: session.customer_name ?? '', rounds, totalPaise,
  }, { headers: noStore })
}
