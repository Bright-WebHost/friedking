import { NextRequest, NextResponse } from 'next/server'
import { createAdminClient } from '@/lib/supabase/admin'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

const DEFAULT_LIMIT = 1000
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function authorize() {
  const auth = await createClient()
  const { data, error } = await auth.auth.getUser()
  if (error || !data.user) return null

  const admin = createAdminClient()
  const { data: platformAdmin, error: platformError } = await admin
    .from('platform_admins')
    .select('user_id, name')
    .eq('user_id', data.user.id)
    .eq('is_active', true)
    .maybeSingle()
  if (platformError || !platformAdmin) return null
  return { admin, user: data.user, name: platformAdmin.name }
}

function fail(message: string, status: number) {
  return NextResponse.json({ message }, { status })
}

export async function GET() {
  const access = await authorize()
  if (!access) return fail('You are not authorised for the platform admin page.', 403)

  const [{ data: branches, error: branchError }, { data: settings, error: settingsError }, { data: audit, error: auditError }] = await Promise.all([
    access.admin.from('branches').select('id, name, slug').eq('is_active', true).order('name'),
    access.admin.from('branch_settings').select('branch_id, value').eq('key', 'blast_monthly_limit'),
    access.admin.from('platform_admin_audit')
      .select('id, branch_id, action, from_value, to_value, detail, created_at')
      .order('created_at', { ascending: false }).limit(50),
  ])
  if (branchError || settingsError || auditError) {
    console.error('[platform admin] load:', branchError?.message ?? settingsError?.message ?? auditError?.message)
    return fail('Could not load platform settings.', 500)
  }

  const limits = new Map((settings ?? []).map((row) => [row.branch_id, Number(row.value)]))
  return NextResponse.json({
    adminName: access.name,
    branches: (branches ?? []).map((branch) => ({
      ...branch,
      blastMonthlyLimit: Number.isInteger(limits.get(branch.id)) && (limits.get(branch.id) ?? -1) >= 0
        ? limits.get(branch.id) : DEFAULT_LIMIT,
    })),
    audit: audit ?? [],
  })
}

export async function POST(request: NextRequest) {
  const access = await authorize()
  if (!access) return fail('You are not authorised for the platform admin page.', 403)

  const body = await request.json().catch(() => null) as { branchId?: unknown; monthlyLimit?: unknown } | null
  const branchId = String(body?.branchId ?? '')
  const monthlyLimit = Number(body?.monthlyLimit)
  if (!UUID.test(branchId)) return fail('Invalid branch.', 400)
  if (!Number.isInteger(monthlyLimit) || monthlyLimit < 0 || monthlyLimit > 1_000_000) {
    return fail('Monthly limit must be a whole number from 0 to 1,000,000.', 400)
  }

  const { data: branch, error: branchError } = await access.admin
    .from('branches').select('id, name').eq('id', branchId).eq('is_active', true).maybeSingle()
  if (branchError) {
    console.error('[platform admin] branch:', branchError.message)
    return fail('Could not verify the branch.', 500)
  }
  if (!branch) return fail('Branch not found.', 404)

  const { data: current, error: currentError } = await access.admin
    .from('branch_settings').select('value').eq('branch_id', branchId).eq('key', 'blast_monthly_limit').maybeSingle()
  if (currentError) {
    console.error('[platform admin] current limit:', currentError.message)
    return fail('Could not read the current limit.', 500)
  }
  const from = current?.value ?? String(DEFAULT_LIMIT)
  if (from === String(monthlyLimit)) return NextResponse.json({ ok: true, changed: false })

  const { error: saveError } = await access.admin.from('branch_settings').upsert({
    branch_id: branchId, key: 'blast_monthly_limit', value: String(monthlyLimit), updated_at: new Date().toISOString(),
  }, { onConflict: 'branch_id,key' })
  if (saveError) {
    console.error('[platform admin] save limit:', saveError.message)
    return fail('Could not save the monthly limit.', 500)
  }

  const { error: auditError } = await access.admin.from('platform_admin_audit').insert({
    actor_user_id: access.user.id,
    branch_id: branchId,
    action: 'blast_limit_update',
    from_value: from,
    to_value: String(monthlyLimit),
    detail: `${branch.name}: monthly blast limit changed by ${access.name}`,
  })
  if (auditError) {
    console.error('[platform admin] audit:', auditError.message)
    return fail('The limit was saved, but the audit record could not be written.', 500)
  }
  return NextResponse.json({ ok: true, changed: true })
}

