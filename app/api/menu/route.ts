import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import type { Branch, MenuCategory, MenuItem } from '@/lib/types'

export const dynamic = 'force-dynamic'

const noStore = { 'Cache-Control': 'no-store' }

/** GET /api/menu?branch=pandeshwar -> { branch, categories, items } */
export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('branch')?.trim().toLowerCase()
  if (!slug) {
    return NextResponse.json({ message: 'branch is required' }, { status: 400, headers: noStore })
  }

  let supabase: ReturnType<typeof createAdminClient>
  try {
    supabase = createAdminClient()
  } catch (e) {
    console.error('[GET /api/menu]', e instanceof Error ? e.message : e)
    return NextResponse.json({ message: 'Unable to load menu' }, { status: 500, headers: noStore })
  }

  const { data: b, error: branchErr } = await supabase
    .from('branches')
    .select('id, slug, name, address, phone, opens_at, closes_at')
    .eq('slug', slug)
    .eq('is_active', true)
    .maybeSingle()

  if (branchErr) {
    console.error('[GET /api/menu] branch:', branchErr.message)
    return NextResponse.json({ message: 'Unable to load menu' }, { status: 500, headers: noStore })
  }
  if (!b) {
    return NextResponse.json({ message: 'Branch not found' }, { status: 404, headers: noStore })
  }

  const [catRes, itemRes] = await Promise.all([
    supabase
      .from('menu_categories')
      .select('id, name')
      .eq('branch_id', b.id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
    supabase
      .from('menu_items')
      .select('id, name, description, price_paise, image_url, is_veg, category_id')
      .eq('branch_id', b.id)
      .eq('is_active', true)
      .order('sort_order', { ascending: true }),
  ])

  if (catRes.error || itemRes.error) {
    console.error('[GET /api/menu]', catRes.error?.message ?? itemRes.error?.message)
    return NextResponse.json({ message: 'Unable to load menu' }, { status: 500, headers: noStore })
  }

  const branch: Branch = {
    id: b.id,
    slug: b.slug,
    name: b.name,
    address: b.address,
    phone: b.phone,
    opensAt: b.opens_at,
    closesAt: b.closes_at,
  }

  const items: MenuItem[] = (itemRes.data ?? []).map((i) => ({
    id: i.id,
    name: i.name,
    description: i.description,
    pricePaise: i.price_paise,
    imageUrl: i.image_url,
    isVeg: i.is_veg,
    categoryId: i.category_id,
  }))

  // Hide categories that have no active items.
  const used = new Set(items.map((i) => i.categoryId))
  const categories: MenuCategory[] = (catRes.data ?? [])
    .filter((c) => used.has(c.id))
    .map((c) => ({ id: c.id, name: c.name }))

  return NextResponse.json({ branch, categories, items }, { headers: noStore })
}
