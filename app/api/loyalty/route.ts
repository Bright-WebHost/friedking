import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSecondaryBranch } from '@/lib/supabase/project'
import { getCustomerPhone } from '@/lib/customer/session'
import { loyaltyOffer, verifiedPhone } from '@/lib/loyalty'
import { calcTotals } from '@/lib/utils'

export const dynamic = 'force-dynamic'

const none = () => NextResponse.json({ available: false }, { headers: { 'Cache-Control': 'no-store' } })

/**
 * POST /api/loyalty { branchSlug, linkToken?, verifySecret?, items: [{ itemId, quantity }] }
 * -> the customer's points and how many can be used on this cart.
 * Only answers for a number the server has verified (WhatsApp link, verified OTP or login),
 * so nobody can look up someone else's balance by typing their number.
 */
export async function POST(req: NextRequest) {
  let body: { branchSlug?: string; linkToken?: string; verifySecret?: string; items?: Array<{ itemId?: string; quantity?: number }> }
  try { body = await req.json() } catch { return none() }
  const slug = String(body.branchSlug ?? '').trim().toLowerCase()
  if (!slug || !Array.isArray(body.items) || !body.items.length || body.items.length > 100) return none()

  try {
    const db = createAdminClient(slug)
    const phone = await verifiedPhone(db, {
      linkToken: String(body.linkToken ?? ''), verifySecret: String(body.verifySecret ?? ''), sessionPhone: await getCustomerPhone(slug),
      maxVerificationAgeMs: isSecondaryBranch(slug) ? 30 * 60000 : undefined,
    })
    if (!phone) return none()
    const { data: branch } = await db.from('branches').select('id').eq('slug', slug).eq('is_active', true).maybeSingle()
    if (!branch) return none()

    const qty = new Map<string, number>()
    for (const l of body.items) {
      const n = Number(l?.quantity)
      if (typeof l?.itemId !== 'string' || !Number.isInteger(n) || n < 1 || n > 50) return none()
      qty.set(l.itemId, (qty.get(l.itemId) ?? 0) + n)
    }
    const { data: items } = await db.from('menu_items').select('id, price_paise').eq('branch_id', branch.id).in('id', [...qty.keys()])
    const totals = calcTotals((items ?? []).map((i) => ({ pricePaise: i.price_paise as number, quantity: qty.get(i.id)! })))

    const { customerId: _c, ...offer } = await loyaltyOffer(db, branch.id, phone, totals.totalPaise)
    void _c
    return NextResponse.json(offer, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    console.error('[POST /api/loyalty]', e instanceof Error ? e.message : e)
    return none()
  }
}
