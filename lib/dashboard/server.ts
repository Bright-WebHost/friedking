// Server-only: imports the service-role client. Never import this from a client component.
import type { SupabaseClient } from '@supabase/supabase-js'
import { createAdminClient } from '@/lib/supabase/admin'
import { canAccessBranch, getStaffContext, type StaffContext } from '@/lib/auth/staff'
import { canSee, type StaffRole } from '@/lib/dashboard/access'
import { SETTING_DEFAULTS, type SettingKey } from '@/lib/dashboard/settings'

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export interface BranchRow {
  id: string
  name: string
  slug: string
  address: string | null
  phone: string | null
  opens_at: string | null
  closes_at: string | null
}

export interface Ctx {
  staff: StaffContext
  branch: BranchRow
  admin: SupabaseClient
}

const branchCache = new Map<string, { at: number; branch: Ctx['branch'] }>()
/** Call after the branch profile is edited so the change shows straight away. */
export function clearBranchCache() { branchCache.clear() }

async function findBranch(admin: Ctx['admin'], slug: string) {
  const hit = branchCache.get(slug)
  if (hit && Date.now() - hit.at < 60_000) return hit.branch
  const { data: branch, error } = await admin
    .from('branches')
    .select('id, name, slug, address, phone, opens_at, closes_at')
    .eq('slug', slug)
    .maybeSingle()
  if (error) throw error
  if (branch) branchCache.set(slug, { at: Date.now(), branch })
  return branch
}

/** Signed-in staff + the branch from the URL, checked against their branch access. */
export async function resolveCtx(branchSlug: string): Promise<Ctx> {
  const admin = createAdminClient(branchSlug)
  const [staff, branch] = await Promise.all([getStaffContext(branchSlug), findBranch(admin, branchSlug.toLowerCase())])
  if (!staff) throw new HttpError(401, 'Please sign in again')
  if (!branch || !canAccessBranch(staff, branch.id)) throw new HttpError(403, 'You do not have access to this branch')
  return { staff, branch, admin }
}

/** Throws 403 unless the signed-in role can open this dashboard section. */
export function needSection(ctx: Ctx, section: string) {
  if (!canSee(ctx.staff.role, section)) throw new HttpError(403, 'Your role cannot do that')
}

export function needRole(ctx: Ctx, ...roles: StaffRole[]) {
  if (!roles.includes(ctx.staff.role)) throw new HttpError(403, 'Only a manager can do that')
}

/**
 * Throws a Supabase error as a 500 with a log line; returns data otherwise.
 * Typed non-null because .single() succeeds only with a row; callers of
 * .maybeSingle() still test the result for null.
 */
export function check<T>(res: { data: T; error: { message: string } | null }, what: string): NonNullable<T> {
  if (res.error) {
    console.error(`[dashboard] ${what}:`, res.error.message)
    throw new HttpError(500, `Could not ${what}`)
  }
  return res.data as NonNullable<T>
}

export async function getSettings(ctx: Ctx): Promise<Record<SettingKey, string>> {
  const { data } = await ctx.admin.from('branch_settings').select('key, value').eq('branch_id', ctx.branch.id)
  const out = { ...SETTING_DEFAULTS }
  for (const row of data ?? []) if (row.key in out && row.value != null) out[row.key as SettingKey] = row.value
  return out
}

export async function audit(ctx: Ctx, entry: { orderId?: string | null; orderNumber?: number | null; action: string; from?: string | null; to?: string | null; detail?: string | null }) {
  const { error } = await ctx.admin.from('order_audit').insert({
    branch_id: ctx.branch.id,
    order_id: entry.orderId ?? null,
    order_number: entry.orderNumber ?? null,
    action: entry.action,
    from_value: entry.from ?? null,
    to_value: entry.to ?? null,
    detail: entry.detail ?? null,
    staff: ctx.staff.name,
  })
  if (error) console.error('[dashboard] audit:', error.message)
}

/** Outbox row for n8n. order_created / order_status_changed keep their existing payload shape; extra fields are additive. */
export async function emitOrderEvent(ctx: Ctx, orderId: string, eventType: string, payload: Record<string, unknown>) {
  const row = {
    order_id: orderId,
    branch_id: ctx.branch.id,
    event_type: eventType,
    payload: { orderId, branchSlug: ctx.branch.slug, ...payload },
  }
  // The status is already saved when this runs, so a lost event means a customer who never hears about it.
  // Retry a couple of times for transient network errors before giving up.
  let lastError = ''
  for (let attempt = 0; attempt < 3; attempt++) {
    const { error } = await ctx.admin.from('order_events').insert(row)
    if (!error) return true
    lastError = error.message
    await new Promise((r) => setTimeout(r, 150 * (attempt + 1)))
  }
  console.error(`[dashboard] order event ${eventType} LOST for order ${orderId}:`, lastError)
  return false
}

// ---- input helpers ----
export const str = (v: unknown, max = 200) => String(v ?? '').trim().slice(0, max)
export const optStr = (v: unknown, max = 200) => str(v, max) || null
export function int(v: unknown, what: string, min = 0, max = Number.MAX_SAFE_INTEGER): number {
  const n = Number(v)
  if (!Number.isInteger(n) || n < min || n > max) throw new HttpError(400, `Invalid ${what}`)
  return n
}
export function num(v: unknown, what: string, min = 0): number {
  const n = Number(v)
  if (!Number.isFinite(n) || n < min) throw new HttpError(400, `Invalid ${what}`)
  return n
}
export function optNum(v: unknown, what: string): number | null {
  return v === null || v === undefined || v === '' ? null : num(v, what)
}
export function id(v: unknown, what = 'id'): string {
  const s = String(v ?? '')
  if (!/^[0-9a-f-]{36}$/i.test(s)) throw new HttpError(400, `Invalid ${what}`)
  return s
}

/** Upload an image to the public `menu` bucket and return its URL. */
export async function uploadImage(ctx: Ctx, file: unknown, folder: string, name: string): Promise<string> {
  if (!(file instanceof File)) throw new HttpError(400, 'Choose an image')
  if (!file.type.startsWith('image/')) throw new HttpError(400, 'Please upload an image file')
  if (file.size > 5 * 1024 * 1024) throw new HttpError(400, 'Image must be 5 MB or smaller')
  const ext = file.type.split('/')[1]?.replace('jpeg', 'jpg').replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${folder}/${ctx.branch.id}/${name.replace(/[^a-z0-9-]+/gi, '-').toLowerCase()}-${Date.now()}.${ext}`
  const up = await ctx.admin.storage.from('menu').upload(path, Buffer.from(await file.arrayBuffer()), {
    contentType: file.type, cacheControl: '3600', upsert: true,
  })
  if (up.error) {
    console.error('[dashboard] upload:', up.error.message)
    throw new HttpError(500, 'Could not upload the image')
  }
  return ctx.admin.storage.from('menu').getPublicUrl(path).data.publicUrl
}
