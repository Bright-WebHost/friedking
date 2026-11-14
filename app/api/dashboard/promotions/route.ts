import { NextRequest, NextResponse } from 'next/server'
import { canAccessBranch, getStaffContext } from '@/lib/auth/staff'
import { createAdminClient } from '@/lib/supabase/admin'

async function getBranch(staffBranchId: string | null, slug: string | null) {
  const admin = createAdminClient()
  const query = admin.from('branches').select('id, name, slug').eq('is_active', true)
  return slug ? query.eq('slug', slug).maybeSingle() : staffBranchId ? query.eq('id', staffBranchId).maybeSingle() : Promise.resolve({ data: null, error: null })
}

export async function GET(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  try {
    const slug = req.nextUrl.searchParams.get('branch')?.trim().toLowerCase() || null
    const { data: branch, error: branchError } = await getBranch(staff.branchId, slug)
    if (branchError) throw branchError
    if (!branch || !canAccessBranch(staff, branch.id)) return NextResponse.json({ message: 'Branch access denied' }, { status: 403 })
    const { data, error } = await createAdminClient()
      .from('menu_promotions')
      .select('id, branch_id, title, description, image_url, is_active, starts_at, ends_at')
      .eq('branch_id', branch.id)
      .order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ promotions: data ?? [] })
  } catch (error) {
    console.error('[GET /api/dashboard/promotions]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not load offer banners' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  if (staff.role === 'staff') return NextResponse.json({ message: 'Only managers can manage offer banners' }, { status: 403 })

  try {
    const form = await req.formData()
    const id = String(form.get('id') ?? '').trim() || null
    const slug = String(form.get('branch') ?? '').trim().toLowerCase() || null
    const title = String(form.get('title') ?? '').trim().slice(0, 120)
    const description = String(form.get('description') ?? '').trim().slice(0, 240) || null
    const startsAt = String(form.get('startsAt') ?? '').trim() || null
    const endsAt = String(form.get('endsAt') ?? '').trim() || null
    const isActive = form.get('isActive') !== 'false'
    const file = form.get('image')
    if (!title) return NextResponse.json({ message: 'Banner title is required' }, { status: 400 })

    const { data: branch, error: branchError } = await getBranch(staff.branchId, slug)
    if (branchError) throw branchError
    if (!branch || !canAccessBranch(staff, branch.id)) return NextResponse.json({ message: 'Branch access denied' }, { status: 403 })

    const admin = createAdminClient()
    let imageUrl: string | null | undefined
    if (file instanceof File && file.size > 0) {
      if (!file.type.startsWith('image/')) return NextResponse.json({ message: 'Please upload an image file' }, { status: 400 })
      if (file.size > 5 * 1024 * 1024) return NextResponse.json({ message: 'Image must be 5MB or smaller' }, { status: 400 })
      const extension = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
      const path = `banners/${branch.id}/${id ?? crypto.randomUUID()}.${extension}`
      const { error: uploadError } = await admin.storage.from('menu').upload(path, Buffer.from(await file.arrayBuffer()), {
        contentType: file.type,
        cacheControl: '3600',
        upsert: true,
      })
      if (uploadError) throw uploadError
      imageUrl = admin.storage.from('menu').getPublicUrl(path).data.publicUrl
    }

    const values = {
      branch_id: branch.id,
      title,
      description,
      is_active: isActive,
      starts_at: startsAt,
      ends_at: endsAt,
      ...(imageUrl !== undefined ? { image_url: imageUrl } : {}),
      updated_at: new Date().toISOString(),
    }
    const query = id
      ? admin.from('menu_promotions').update(values).eq('id', id).eq('branch_id', branch.id)
      : admin.from('menu_promotions').insert(values)
    const { data, error } = await query.select('id, branch_id, title, description, image_url, is_active, starts_at, ends_at').single()
    if (error) throw error
    return NextResponse.json({ promotion: data })
  } catch (error) {
    console.error('[POST /api/dashboard/promotions]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not save offer banner' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  if (staff.role === 'staff') return NextResponse.json({ message: 'Only managers can manage offer banners' }, { status: 403 })
  try {
    const body = await req.json() as { id?: string }
    if (!body.id) return NextResponse.json({ message: 'Banner id is required' }, { status: 400 })
    const admin = createAdminClient()
    const { data: promotion } = await admin.from('menu_promotions').select('branch_id').eq('id', body.id).maybeSingle()
    if (!promotion || !canAccessBranch(staff, promotion.branch_id)) return NextResponse.json({ message: 'Banner access denied' }, { status: 403 })
    const { error } = await admin.from('menu_promotions').delete().eq('id', body.id)
    if (error) throw error
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[DELETE /api/dashboard/promotions]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not delete offer banner' }, { status: 500 })
  }
}
