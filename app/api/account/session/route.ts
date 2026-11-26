import { NextRequest, NextResponse } from 'next/server'
import { setCustomerSession } from '@/lib/customer/session'
import { createAdminClient } from '@/lib/supabase/admin'
import { isSecondaryBranch } from '@/lib/supabase/project'

export const dynamic = 'force-dynamic'

/** POST { secret } -> logs the customer in with a verified (not yet used) verification. */
export async function POST(req: NextRequest) {
  const branch = req.nextUrl.searchParams.get('branch')
  const b = await req.json().catch(() => ({}))
  const secret = String(b.secret ?? '')
  if (!/^[0-9a-f]{48}$/.test(secret)) return NextResponse.json({ message: 'Invalid request' }, { status: 400 })
  const { data: v } = await createAdminClient(branch).from('wa_verifications').select('phone, verified_at, consumed_at, created_at').eq('secret', secret).maybeSingle()
  if (!v?.verified_at || v.consumed_at || !v.phone || (isSecondaryBranch(branch) && Date.now() - new Date(v.created_at).getTime() > 30 * 60000)) return NextResponse.json({ message: 'Verify your number first.' }, { status: 403 })
  await setCustomerSession(v.phone, branch)
  return NextResponse.json({ ok: true })
}
