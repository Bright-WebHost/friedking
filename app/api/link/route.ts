import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'

export const dynamic = 'force-dynamic'

/**
 * GET /api/link?t=<token>  ->  { linked, name, phoneMasked }
 * The token comes from the menu link the WhatsApp bot sends. The full number is never returned,
 * only a masked version for display; the order API uses the stored number itself.
 */
export async function GET(req: NextRequest) {
  const token = (req.nextUrl.searchParams.get('t') ?? '').trim()
  if (!/^[0-9a-f]{32}$/.test(token)) return NextResponse.json({ linked: false })
  const { data } = await createAdminClient().from('wa_links').select('phone, name').eq('token', token).gt('expires_at', new Date().toISOString()).maybeSingle()
  if (!data) return NextResponse.json({ linked: false })
  const d = String(data.phone).replace(/\D/g, '').slice(-10)
  return NextResponse.json({ linked: true, name: data.name ?? '', phoneMasked: `+91 ${d.slice(0, 5)} ${'•'.repeat(3)}${d.slice(-2)}` })
}
