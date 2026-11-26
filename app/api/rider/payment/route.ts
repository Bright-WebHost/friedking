import { timingSafeEqual } from 'node:crypto'
import { NextRequest, NextResponse } from 'next/server'
import { confirmRiderPayment } from '@/lib/rider/payment'
import { HttpError } from '@/lib/dashboard/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { BANGALORE_BRANCH, secondaryBranch } from '@/lib/supabase/project'

export const dynamic = 'force-dynamic'
export const maxDuration = 30

export async function POST(request: NextRequest) {
  const branch = request.nextUrl.searchParams.get('branch')
  const secondary = secondaryBranch(branch)
  const expected = secondary === BANGALORE_BRANCH ? process.env.BANGALORE_RIDER_CALLBACK_SECRET
    : secondary ? process.env.KADRI_RIDER_CALLBACK_SECRET
    : process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!expected) return NextResponse.json({ message: 'Payment service unavailable' }, { status: 503 })
  const supplied = (request.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  const wanted = Buffer.from(expected)
  const actual = Buffer.from(supplied)
  if (wanted.length !== actual.length || !timingSafeEqual(wanted, actual)) {
    return NextResponse.json({ message: 'Unauthorized' }, { status: 401 })
  }
  try {
    const body = await request.json().catch(() => { throw new HttpError(400, 'Invalid request') })
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new HttpError(400, 'Invalid request')
    if (secondary !== secondaryBranch(typeof body.branchSlug === 'string' ? body.branchSlug : null)) throw new HttpError(400, 'Branch does not match callback')
    return NextResponse.json(await confirmRiderPayment(createAdminClient(branch), body), { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    if (error instanceof HttpError) return NextResponse.json({ message: error.message }, { status: error.status })
    console.error('[rider/payment]', error instanceof Error ? error.message : error)
    return NextResponse.json({ message: 'Could not confirm the payment. Please try again.' }, { status: 500 })
  }
}
