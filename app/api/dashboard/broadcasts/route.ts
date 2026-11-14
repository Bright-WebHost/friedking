import { NextRequest, NextResponse } from 'next/server'
import { canAccessBranch, getStaffContext } from '@/lib/auth/staff'
import { createAdminClient } from '@/lib/supabase/admin'

async function getBranch(staffBranchId: string | null, slug: string | null) {
  const admin = createAdminClient()
  const query = admin.from('branches').select('id, name, slug').eq('is_active', true)
  const result = slug ? await query.eq('slug', slug).maybeSingle() : staffBranchId ? await query.eq('id', staffBranchId).maybeSingle() : { data: null, error: null }
  if (result.error) throw result.error
  return result.data
}

export async function GET(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  try {
    const slug = req.nextUrl.searchParams.get('branch')?.trim().toLowerCase() || null
    const branch = await getBranch(staff.branchId, slug)
    if (!branch || !canAccessBranch(staff, branch.id)) return NextResponse.json({ message: 'Branch access denied' }, { status: 403 })
    const { data, error } = await createAdminClient().from('broadcast_campaigns').select('*').eq('branch_id', branch.id).order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ campaigns: data ?? [] })
  } catch (error) {
    console.error('[GET /api/dashboard/broadcasts]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not load broadcasts' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  try {
    const body = await req.json() as { branch?: string; id?: string; title?: string; message?: string; audience?: string; status?: string; scheduledAt?: string | null }
    const branch = await getBranch(staff.branchId, body.branch?.trim().toLowerCase() || null)
    if (!branch || !canAccessBranch(staff, branch.id)) return NextResponse.json({ message: 'Branch access denied' }, { status: 403 })
    const title = String(body.title ?? '').trim().slice(0, 100)
    const message = String(body.message ?? '').trim().slice(0, 2000)
    const audience = ['all', 'repeat_customers', 'inactive_customers'].includes(String(body.audience)) ? body.audience : 'all'
    const status = ['draft', 'scheduled', 'cancelled'].includes(String(body.status)) ? body.status : 'draft'
    const scheduledAt = body.scheduledAt || null
    if (!title || !message) return NextResponse.json({ message: 'Title and message are required' }, { status: 400 })
    if (status === 'scheduled' && !scheduledAt) return NextResponse.json({ message: 'Scheduled broadcasts need a date and time' }, { status: 400 })
    const values = { branch_id: branch.id, title, message, audience, status, scheduled_at: scheduledAt, created_by: staff.userId, updated_at: new Date().toISOString() }
    const query = body.id ? createAdminClient().from('broadcast_campaigns').update(values).eq('id', body.id).eq('branch_id', branch.id) : createAdminClient().from('broadcast_campaigns').insert(values)
    const { data, error } = await query.select('*').single()
    if (error) throw error
    return NextResponse.json({ campaign: data }, { status: body.id ? 200 : 201 })
  } catch (error) {
    console.error('[POST /api/dashboard/broadcasts]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not save broadcast' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  try {
    const body = await req.json() as { id?: string }
    if (!body.id) return NextResponse.json({ message: 'Broadcast id is required' }, { status: 400 })
    const admin = createAdminClient()
    const { data: campaign, error: findError } = await admin.from('broadcast_campaigns').select('id, branch_id').eq('id', body.id).maybeSingle()
    if (findError) throw findError
    if (!campaign || !canAccessBranch(staff, campaign.branch_id)) return NextResponse.json({ message: 'Broadcast access denied' }, { status: 403 })
    const { error } = await admin.from('broadcast_campaigns').delete().eq('id', campaign.id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[DELETE /api/dashboard/broadcasts]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not delete broadcast' }, { status: 500 })
  }
}
