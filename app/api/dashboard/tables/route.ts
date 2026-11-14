import { NextRequest, NextResponse } from 'next/server'
import { canAccessBranch, getStaffContext } from '@/lib/auth/staff'
import { createAdminClient } from '@/lib/supabase/admin'

async function findBranch(staffBranchId: string | null, slug: string | null) {
  const admin = createAdminClient()
  if (slug) {
    const { data, error } = await admin.from('branches').select('id, name, slug').eq('slug', slug).eq('is_active', true).maybeSingle()
    if (error) throw error
    return data
  }
  if (!staffBranchId) return null
  const { data, error } = await admin.from('branches').select('id, name, slug').eq('id', staffBranchId).eq('is_active', true).maybeSingle()
  if (error) throw error
  return data
}

export async function GET(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  try {
    const slug = req.nextUrl.searchParams.get('branch')?.trim().toLowerCase() || null
    const branch = await findBranch(staff.branchId, slug)
    if (!branch || !canAccessBranch(staff, branch.id)) return NextResponse.json({ message: 'Branch access denied' }, { status: 403 })

    const admin = createAdminClient()
    const [{ data: tables, error: tableError }, { data: sessions, error: sessionError }] = await Promise.all([
      admin.from('restaurant_tables').select('id, table_number, seats, is_active').eq('branch_id', branch.id).eq('is_active', true).order('table_number'),
      admin.from('table_sessions').select('id, table_id, status, opened_at').eq('branch_id', branch.id).eq('status', 'open'),
    ])
    if (tableError || sessionError) throw tableError ?? sessionError

    const openByTable = new Map((sessions ?? []).map((session) => [session.table_id, session]))
    return NextResponse.json({
      branch,
      tables: (tables ?? []).map((table) => ({ ...table, session: openByTable.get(table.id) ?? null })),
    }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    console.error('[GET /api/dashboard/tables]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not load tables. Run the tables migration first.' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as { branch?: string; action?: string; tableId?: string; seats?: number }
    const branch = await findBranch(staff.branchId, body.branch?.trim().toLowerCase() || null)
    if (!branch || !canAccessBranch(staff, branch.id)) return NextResponse.json({ message: 'Branch access denied' }, { status: 403 })
    const admin = createAdminClient()

    if (body.action === 'create') {
      const seats = Number(body.seats)
      if (!Number.isInteger(seats) || seats < 1 || seats > 30) return NextResponse.json({ message: 'Seats must be between 1 and 30' }, { status: 400 })
      const { data: last } = await admin.from('restaurant_tables').select('table_number').eq('branch_id', branch.id).order('table_number', { ascending: false }).limit(1).maybeSingle()
      const { data, error } = await admin.from('restaurant_tables').insert({ branch_id: branch.id, table_number: (last?.table_number ?? 0) + 1, seats }).select('id, table_number, seats, is_active').single()
      if (error) throw error
      return NextResponse.json({ table: data }, { status: 201 })
    }

    if (!body.tableId || !['open', 'close'].includes(body.action ?? '')) return NextResponse.json({ message: 'Invalid table action' }, { status: 400 })
    const { data: table, error: tableError } = await admin.from('restaurant_tables').select('id, table_number').eq('id', body.tableId).eq('branch_id', branch.id).eq('is_active', true).maybeSingle()
    if (tableError) throw tableError
    if (!table) return NextResponse.json({ message: 'Table not found' }, { status: 404 })

    if (body.action === 'open') {
      const { data, error } = await admin.from('table_sessions').insert({ branch_id: branch.id, table_id: table.id, opened_by: staff.userId }).select('id, table_id, status, opened_at').single()
      if (error) throw error
      return NextResponse.json({ session: data }, { status: 201 })
    }

    const { data, error } = await admin.from('table_sessions').update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: staff.userId }).eq('table_id', table.id).eq('status', 'open').select('id, table_id, status, closed_at').single()
    if (error) throw error
    return NextResponse.json({ session: data })
  } catch (error) {
    console.error('[POST /api/dashboard/tables]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not update table' }, { status: 500 })
  }
}
