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
  // A customer who scanned the table QR on WhatsApp has an open tab: the site then orders as dine-in on that table.
  const { data: tab } = await createAdminClient().from('table_sessions')
    .select('table:restaurant_tables(table_number)').eq('phone', data.phone).eq('status', 'open').order('opened_at', { ascending: false }).limit(1).maybeSingle()
  const t = tab?.table as { table_number?: number } | { table_number?: number }[] | null | undefined
  const table = (Array.isArray(t) ? t[0]?.table_number : t?.table_number) ?? null
  return NextResponse.json({ linked: true, name: data.name ?? '', table, phoneMasked: `+91 ${d.slice(0, 5)} ${'•'.repeat(3)}${d.slice(-2)}` })
}
