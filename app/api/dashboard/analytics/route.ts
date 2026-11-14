import { NextRequest, NextResponse } from 'next/server'
import { canAccessBranch, getStaffContext } from '@/lib/auth/staff'
import { createAdminClient } from '@/lib/supabase/admin'

function startOfDay(days: number) {
  const date = new Date()
  date.setHours(0, 0, 0, 0)
  date.setDate(date.getDate() - days + 1)
  return date.toISOString()
}

export async function GET(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  try {
    const slug = req.nextUrl.searchParams.get('branch')?.trim().toLowerCase() || null
    const admin = createAdminClient()
    const { data: branch, error: branchError } = slug
      ? await admin.from('branches').select('id, name, slug').eq('slug', slug).eq('is_active', true).maybeSingle()
      : staff.branchId
        ? await admin.from('branches').select('id, name, slug').eq('id', staff.branchId).eq('is_active', true).maybeSingle()
        : { data: null, error: null }
    if (branchError) throw branchError
    if (slug && (!branch || !canAccessBranch(staff, branch.id))) return NextResponse.json({ message: 'Branch access denied' }, { status: 403 })

    let query = admin.from('orders')
      .select('id, status, order_type, total_paise, created_at, order_items(name_snapshot, quantity, line_total_paise)')
      .gte('created_at', startOfDay(30))
      .order('created_at', { ascending: true })
    query = branch ? query.eq('branch_id', branch.id) : staff.branchId ? query.eq('branch_id', staff.branchId) : query
    const { data: orders, error } = await query
    if (error) throw error

    const rows = (orders ?? []).filter((order) => order.status !== 'cancelled')
    const revenue = rows.reduce((sum, order) => sum + Number(order.total_paise), 0)
    const byType = { pickup: 0, delivery: 0 }
    const daily = new Map<string, { revenuePaise: number; orders: number }>()
    const items = new Map<string, number>()
    for (const order of rows) {
      const orderType = String(order.order_type) as keyof typeof byType
      if (orderType === 'pickup' || orderType === 'delivery') byType[orderType] += 1
      const day = order.created_at.slice(0, 10)
      const current = daily.get(day) ?? { revenuePaise: 0, orders: 0 }
      daily.set(day, { revenuePaise: current.revenuePaise + Number(order.total_paise), orders: current.orders + 1 })
      for (const item of order.order_items ?? []) items.set(item.name_snapshot, (items.get(item.name_snapshot) ?? 0) + Number(item.quantity))
    }

    return NextResponse.json({
      branch,
      summary: { revenuePaise: revenue, orders: rows.length, averagePaise: rows.length ? Math.round(revenue / rows.length) : 0 },
      byType,
      daily: [...daily.entries()].map(([date, value]) => ({ date, ...value })),
      topItems: [...items.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([name, quantity]) => ({ name, quantity })),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[GET /api/dashboard/analytics]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not load analytics' }, { status: 500 })
  }
}
