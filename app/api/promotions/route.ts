import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get('branch')?.trim().toLowerCase()
  if (!slug) return NextResponse.json({ message: 'branch is required' }, { status: 400 })

  try {
    const admin = createAdminClient(slug)
    const { data: branch, error: branchError } = await admin
      .from('branches')
      .select('id')
      .eq('slug', slug)
      .eq('is_active', true)
      .maybeSingle()
    if (branchError) throw branchError
    if (!branch) return NextResponse.json({ message: 'Branch not found' }, { status: 404 })

    const today = new Date().toISOString().slice(0, 10)
    const { data, error } = await admin
      .from('menu_promotions')
      .select('id, title, description, image_url, starts_at, ends_at')
      .eq('branch_id', branch.id)
      .eq('is_active', true)
      .or(`starts_at.is.null,starts_at.lte.${today}`)
      .or(`ends_at.is.null,ends_at.gte.${today}`)
      .order('created_at', { ascending: false })
    if (error) throw error
    return NextResponse.json({ promotions: data ?? [] }, { headers: { 'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300' } })
  } catch (error) {
    console.error('[GET /api/promotions]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Unable to load offers' }, { status: 500 })
  }
}
