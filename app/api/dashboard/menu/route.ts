import { NextRequest, NextResponse } from 'next/server'
import { canAccessBranch, getStaffContext } from '@/lib/auth/staff'
import { createAdminClient } from '@/lib/supabase/admin'

export async function GET(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  const slug = req.nextUrl.searchParams.get('branch')?.trim().toLowerCase() || null
  const admin = createAdminClient()
  let branchQuery = admin.from('branches').select('id, name, slug').eq('is_active', true)
  const { data: branch, error: branchError } = slug
    ? await branchQuery.eq('slug', slug).maybeSingle()
    : staff.branchId
      ? await branchQuery.eq('id', staff.branchId).maybeSingle()
      : { data: null, error: null }
  if (branchError) return NextResponse.json({ message: 'Could not load branch' }, { status: 500 })
  if (slug && (!branch || !canAccessBranch(staff, branch.id))) return NextResponse.json({ message: 'Branch access denied' }, { status: 403 })

  let query = admin.from('menu_items').select('id, branch_id, category_id, name, description, price_paise, image_url, is_veg, is_active, sort_order').order('sort_order')
  query = branch ? query.eq('branch_id', branch.id) : staff.branchId ? query.eq('branch_id', staff.branchId) : query
  const [{ data: items, error }, { data: categories, error: categoryError }] = await Promise.all([
    query,
    branch
      ? admin.from('menu_categories').select('id, name, sort_order, is_active').eq('branch_id', branch.id).order('sort_order')
      : staff.branchId
        ? admin.from('menu_categories').select('id, name, sort_order, is_active').eq('branch_id', staff.branchId).order('sort_order')
        : Promise.resolve({ data: [], error: null }),
  ])
  if (error || categoryError) return NextResponse.json({ message: 'Could not load menu' }, { status: 500 })
  return NextResponse.json({ branch, items: items ?? [], categories: categories ?? [] })
}

export async function PATCH(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  try {
    const body = await req.json() as {
      itemId?: string
      isActive?: boolean
      name?: string
      description?: string | null
      pricePaise?: number
      categoryId?: string
    }

    if (!body.itemId) {
      return NextResponse.json({ message: 'Invalid menu update' }, { status: 400 })
    }
    const admin = createAdminClient()
    const { data: item, error: itemError } = await admin.from('menu_items').select('id, branch_id').eq('id', body.itemId).maybeSingle()
    if (itemError) throw itemError
    if (!item || !canAccessBranch(staff, item.branch_id)) return NextResponse.json({ message: 'Menu access denied' }, { status: 403 })
    const updates: Record<string, unknown> = {}
    if (typeof body.isActive === 'boolean') updates.is_active = body.isActive
    if (typeof body.name === 'string') {
      const name = body.name.trim()
      if (!name) return NextResponse.json({ message: 'Item name is required' }, { status: 400 })
      updates.name = name
    }
    if (body.description !== undefined) updates.description = body.description?.trim() || null
    if (body.pricePaise !== undefined) {
      if (!Number.isInteger(body.pricePaise) || body.pricePaise < 0) return NextResponse.json({ message: 'Price must be a non-negative whole number of paise' }, { status: 400 })
      updates.price_paise = body.pricePaise
    }
    if (body.categoryId !== undefined) {
      const { data: category } = await admin.from('menu_categories').select('id').eq('id', body.categoryId).eq('branch_id', item.branch_id).maybeSingle()
      if (!category) return NextResponse.json({ message: 'Invalid menu category' }, { status: 400 })
      updates.category_id = body.categoryId
    }
    if (!Object.keys(updates).length) return NextResponse.json({ message: 'No menu changes provided' }, { status: 400 })
    const { data: updated, error } = await admin.from('menu_items').update(updates).eq('id', item.id).select('id, category_id, name, description, price_paise, is_active').single()
    if (error) throw error
    return NextResponse.json({ item: updated })
  } catch (error) {
    console.error('[PATCH /api/dashboard/menu]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not update menu item' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const staff = await getStaffContext()
  if (!staff) return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })

  try {
    const form = await req.formData()
    const itemId = String(form.get('itemId') ?? '').trim()
    const file = form.get('image')
    if (!itemId || !(file instanceof File)) {
      return NextResponse.json({ message: 'Item and image are required' }, { status: 400 })
    }
    if (!file.type.startsWith('image/')) {
      return NextResponse.json({ message: 'Please upload an image file' }, { status: 400 })
    }
    if (file.size > 5 * 1024 * 1024) {
      return NextResponse.json({ message: 'Image must be 5MB or smaller' }, { status: 400 })
    }

    const admin = createAdminClient()
    const { data: item, error: itemError } = await admin
      .from('menu_items')
      .select('id, branch_id')
      .eq('id', itemId)
      .maybeSingle()
    if (itemError) throw itemError
    if (!item || !canAccessBranch(staff, item.branch_id)) {
      return NextResponse.json({ message: 'Menu access denied' }, { status: 403 })
    }

    const extension = file.type.split('/')[1]?.replace('jpeg', 'jpg') || 'jpg'
    const path = `items/${item.branch_id}/${item.id}.${extension}`
    const { error: uploadError } = await admin.storage.from('menu').upload(
      path,
      Buffer.from(await file.arrayBuffer()),
      { contentType: file.type, cacheControl: '3600', upsert: true },
    )
    if (uploadError) throw uploadError

    const { data: publicUrl } = admin.storage.from('menu').getPublicUrl(path)
    const { data: updated, error: updateError } = await admin
      .from('menu_items')
      .update({ image_url: publicUrl.publicUrl })
      .eq('id', item.id)
      .select('id, category_id, name, description, price_paise, image_url, is_active')
      .single()
    if (updateError) throw updateError
    return NextResponse.json({ item: updated })
  } catch (error) {
    console.error('[POST /api/dashboard/menu]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not upload menu image' }, { status: 500 })
  }
}
