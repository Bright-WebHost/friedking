import { check, type Ctx } from '@/lib/dashboard/server'
import type { DCustomer } from '@/lib/dashboard/types'

/**
 * Customer lists for Contacts, POS and Blast.
 *
 * With supabase/friedking_customer_stats.sql installed, every customer row carries total_orders and last_order_at
 * (kept up to date by a trigger), so search, filters, sort and paging run in the database and only the rows on
 * screen are sent. Without it (e.g. a project where the SQL has not been run yet) the same functions fall back to
 * reading everything and filtering here, which is correct but slower for big lists.
 */

export const LIVE_STATUSES = ['pending', 'confirmed', 'preparing', 'ready', 'delivered']

export type Segment = 'all' | 'recent30' | 'inactive1' | 'inactive2' | 'repeat' | 'onetime' | 'optout'
export type Sort = 'last_desc' | 'last_asc' | 'orders_desc' | 'orders_asc' | 'name_asc' | 'name_desc'
export const SEGMENTS: Segment[] = ['all', 'recent30', 'inactive1', 'inactive2', 'repeat', 'onetime', 'optout']
export const SORTS: Sort[] = ['last_desc', 'last_asc', 'orders_desc', 'orders_asc', 'name_asc', 'name_desc']

export interface ContactFilter {
  q?: string
  seg?: Segment
  /** Leave out opted-out contacts (Blast audiences, "select all"). */
  reachableOnly?: boolean
}

const DAY = 86400000

/**
 * Every row of a query. Supabase returns at most 1000 rows per request (a project setting) and silently cuts a
 * bigger .limit(), so we read page by page. `page` must apply a stable order (ending in id).
 */
export async function fetchAll<T>(what: string, page: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>): Promise<T[]> {
  const size = 1000
  const out: T[] = []
  for (let from = 0; ; from += size) {
    const rows = check(await page(from, from + size - 1), what) ?? []
    out.push(...rows)
    if (rows.length < size) return out
  }
}

// ── Is friedking_customer_stats.sql installed on this project? ─────────────────────────────────────
// Remembered per branch: "yes" for 10 minutes, "no" for 1 minute (so running the SQL takes effect quickly).
const installedCache = new Map<string, { ok: boolean; at: number }>()
export async function statsInstalled(ctx: Ctx): Promise<boolean> {
  const hit = installedCache.get(ctx.branch.id)
  if (hit && Date.now() - hit.at < (hit.ok ? 600000 : 60000)) return hit.ok
  const { error } = await ctx.admin.from('customers').select('total_orders, last_order_at').limit(1)
  installedCache.set(ctx.branch.id, { ok: !error, at: Date.now() })
  return !error
}

// ── Shared helpers ───────────────────────────────────────────────────────────────────────────────
/** Search text safe to put inside a PostgREST filter: letters, digits, spaces and . ' - only. */
function cleanSearch(q: string | undefined) {
  const text = String(q ?? '').toLowerCase().replace(/[^\p{L}\p{N}\s.'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 40)
  const digits = text.replace(/\D/g, '')
  const hasLetters = /\p{L}/u.test(text)
  return { text, digits, hasLetters }
}

type Points = { points_balance: number; lifetime_points: number; tier: string | null }
interface Row {
  id: string; phone: string; name: string | null; created_at: string; opted_out?: boolean | null; source?: string | null
  total_orders?: number | null; last_order_at?: string | null; loyalty_accounts?: Points | Points[] | null
}
const SELECT = 'id, phone, name, created_at, opted_out, source, total_orders, last_order_at, loyalty_accounts(points_balance, lifetime_points, tier)'

function toCustomer(r: Row): DCustomer {
  const pts = Array.isArray(r.loyalty_accounts) ? r.loyalty_accounts[0] : r.loyalty_accounts
  return {
    id: r.id, phone: r.phone, name: r.name ?? null, created_at: r.created_at, opted_out: !!r.opted_out, source: r.source ?? 'order',
    total_orders: r.total_orders ?? 0, last_order_at: r.last_order_at ?? null,
    points_balance: pts?.points_balance ?? 0, lifetime_points: pts?.lifetime_points ?? 0, tier: pts?.tier ?? null,
  }
}

/** The same filter, for the database query. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applyFilter(query: any, f: ContactFilter) {
  const now = Date.now()
  const ago = (days: number) => new Date(now - days * DAY).toISOString()
  const { text, digits, hasLetters } = cleanSearch(f.q)
  if (hasLetters) query = digits.length >= 3 ? query.or(`name.ilike.*${text}*,phone.ilike.*${digits}*`) : query.ilike('name', `%${text}%`)
  else if (digits) query = query.ilike('phone', `%${digits}%`)
  switch (f.seg) {
    case 'recent30': query = query.gte('last_order_at', ago(30)); break
    case 'inactive1': query = query.lte('last_order_at', ago(30)).gt('last_order_at', ago(60)); break
    case 'inactive2': query = query.lte('last_order_at', ago(60)); break
    case 'repeat': query = query.gt('total_orders', 1); break
    case 'onetime': query = query.eq('total_orders', 1); break
    case 'optout': query = query.eq('opted_out', true); break
  }
  if (f.reachableOnly) query = query.eq('opted_out', false)
  return query
}

/** The same filter, in memory (fallback when the SQL is not installed). */
function matches(c: DCustomer, f: ContactFilter, now = Date.now()) {
  const { text, digits, hasLetters } = cleanSearch(f.q)
  if (hasLetters ? !((c.name ?? '').toLowerCase().includes(text) || (digits.length >= 3 && c.phone.includes(digits))) : digits && !c.phone.includes(digits)) return false
  if (f.reachableOnly && c.opted_out) return false
  const age = c.last_order_at ? now - new Date(c.last_order_at).getTime() : null
  switch (f.seg) {
    case 'recent30': return age != null && age <= 30 * DAY
    case 'inactive1': return age != null && age >= 30 * DAY && age < 60 * DAY
    case 'inactive2': return age != null && age >= 60 * DAY
    case 'repeat': return c.total_orders > 1
    case 'onetime': return c.total_orders === 1
    case 'optout': return c.opted_out
    default: return true
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function applySort(query: any, sort: Sort) {
  switch (sort) {
    case 'last_asc': query = query.order('last_order_at', { ascending: true, nullsFirst: true }); break
    case 'orders_desc': query = query.order('total_orders', { ascending: false }); break
    case 'orders_asc': query = query.order('total_orders', { ascending: true }); break
    case 'name_asc': query = query.order('name', { ascending: true, nullsFirst: true }); break
    case 'name_desc': query = query.order('name', { ascending: false, nullsFirst: false }); break
    default: query = query.order('last_order_at', { ascending: false, nullsFirst: false })
  }
  return query.order('created_at', { ascending: false }).order('id')
}

function compare(sort: Sort) {
  return (a: DCustomer, b: DCustomer) => {
    switch (sort) {
      case 'last_asc': return (a.last_order_at ?? '').localeCompare(b.last_order_at ?? '')
      case 'orders_desc': return b.total_orders - a.total_orders
      case 'orders_asc': return a.total_orders - b.total_orders
      case 'name_asc': return (a.name ?? '').localeCompare(b.name ?? '')
      case 'name_desc': return (b.name ?? '').localeCompare(a.name ?? '')
      default: return (b.last_order_at ?? '').localeCompare(a.last_order_at ?? '')
    }
  }
}

// ── Fallback: everything, counted here (the old way, but complete) ──────────────────────────────────
export async function loadAllCustomersLegacy(ctx: Ctx): Promise<DCustomer[]> {
  const [customers, orders, accounts] = await Promise.all([
    fetchAll<Row>('load customers', (from, to) => ctx.admin.from('customers').select('id, phone, name, created_at, opted_out, source').eq('branch_id', ctx.branch.id)
      .order('created_at', { ascending: false }).order('id').range(from, to)),
    fetchAll<{ customer_id: string; created_at: string }>('load orders', (from, to) => ctx.admin.from('orders').select('customer_id, created_at').eq('branch_id', ctx.branch.id)
      .in('status', LIVE_STATUSES).order('id').range(from, to)),
    fetchAll<Points & { customer_id: string }>('load points', (from, to) => ctx.admin.from('loyalty_accounts')
      .select('customer_id, points_balance, lifetime_points, tier, customers!inner(branch_id)').eq('customers.branch_id', ctx.branch.id).order('id').range(from, to)),
  ])
  const stats = new Map<string, { n: number; last: string }>()
  for (const o of orders) {
    const s = stats.get(o.customer_id) ?? { n: 0, last: '' }
    s.n += 1
    if (o.created_at > s.last) s.last = o.created_at
    stats.set(o.customer_id, s)
  }
  const acct = new Map(accounts.map((a) => [a.customer_id, a]))
  return customers.map((c) => toCustomer({ ...c, total_orders: stats.get(c.id)?.n ?? 0, last_order_at: stats.get(c.id)?.last || null, loyalty_accounts: acct.get(c.id) ?? null }))
}

// ── What the sections use ──────────────────────────────────────────────────────────────────────────

/** One page of contacts plus how many match. */
export async function contactsPage(ctx: Ctx, f: ContactFilter, sort: Sort, page: number, size: number) {
  if (await statsInstalled(ctx)) {
    const from = (page - 1) * size
    const res = await applySort(applyFilter(ctx.admin.from('customers').select(SELECT, { count: 'exact' }).eq('branch_id', ctx.branch.id), f), sort).range(from, from + size - 1)
    const rows = (check(res, 'load contacts') ?? []) as Row[]
    return { customers: rows.map(toCustomer), matching: (res as { count: number | null }).count ?? rows.length }
  }
  const all = (await loadAllCustomersLegacy(ctx)).filter((c) => matches(c, f)).sort(compare(sort))
  return { customers: all.slice((page - 1) * size, page * size), matching: all.length }
}

/** Saved / opted-out totals for the branch (the tiles on top of Contacts). */
export async function contactTotals(ctx: Ctx) {
  const [all, out] = await Promise.all([
    ctx.admin.from('customers').select('id', { count: 'exact', head: true }).eq('branch_id', ctx.branch.id),
    ctx.admin.from('customers').select('id', { count: 'exact', head: true }).eq('branch_id', ctx.branch.id).eq('opted_out', true),
  ])
  return { total: all.count ?? 0, optedOut: out.count ?? 0 }
}

/** Phone + name of every contact matching a filter (Blast audience, "select all"). */
export async function contactsMatching(ctx: Ctx, f: ContactFilter): Promise<Array<{ phone: string; name: string | null }>> {
  const needsStats = !!f.seg && !['all', 'optout'].includes(f.seg)
  if (!needsStats || await statsInstalled(ctx)) {
    return fetchAll<{ phone: string; name: string | null }>('load contacts', (from, to) =>
      applyFilter(ctx.admin.from('customers').select('phone, name').eq('branch_id', ctx.branch.id), f).order('created_at', { ascending: false }).order('id').range(from, to))
  }
  return (await loadAllCustomersLegacy(ctx)).filter((c) => matches(c, f)).map((c) => ({ phone: c.phone, name: c.name }))
}

/** The first `count` reachable contacts of a search/filter, in the order shown on Contacts ("Select first N"). */
export async function contactsFirst(ctx: Ctx, f: ContactFilter, sort: Sort, count: number) {
  const n = Math.max(0, Math.floor(count))
  if (!n) return []
  if (await statsInstalled(ctx)) {
    const out: Array<{ phone: string; name: string | null }> = []
    for (let from = 0; out.length < n; from += 1000) {
      const to = Math.min(from + 999, n - 1)
      const rows = (check(await applySort(applyFilter(ctx.admin.from('customers').select('phone, name').eq('branch_id', ctx.branch.id), { ...f, reachableOnly: true }), sort).range(from, to), 'load contacts') ?? []) as Array<{ phone: string; name: string | null }>
      out.push(...rows)
      if (rows.length < to - from + 1) break
    }
    return out.slice(0, n)
  }
  return (await loadAllCustomersLegacy(ctx)).filter((c) => matches(c, { ...f, reachableOnly: true })).sort(compare(sort)).slice(0, n).map((c) => ({ phone: c.phone, name: c.name }))
}

/** Saved contacts among these numbers (Blast "selected contacts"). */
export async function contactsByPhones(ctx: Ctx, phones: string[]) {
  const out: Array<{ phone: string; name: string | null; opted_out: boolean }> = []
  for (let i = 0; i < phones.length; i += 300) {
    const rows = check(await ctx.admin.from('customers').select('phone, name, opted_out').eq('branch_id', ctx.branch.id).in('phone', phones.slice(i, i + 300)), 'load contacts') ?? []
    out.push(...rows)
  }
  return out
}

/** POS type-ahead: up to 6 contacts whose number contains these digits (3+). */
export async function lookupByPhone(ctx: Ctx, digitsIn: string): Promise<DCustomer[]> {
  const digits = String(digitsIn ?? '').replace(/\D/g, '').slice(-10)
  if (digits.length < 3) return []
  if (await statsInstalled(ctx)) {
    const rows = check(await ctx.admin.from('customers').select(SELECT).eq('branch_id', ctx.branch.id).ilike('phone', `%${digits}%`)
      .order('last_order_at', { ascending: false, nullsFirst: false }).order('created_at', { ascending: false }).limit(6), 'look up the customer') ?? []
    return (rows as Row[]).map(toCustomer)
  }
  return (await loadAllCustomersLegacy(ctx)).filter((c) => c.phone.includes(digits)).sort(compare('last_desc')).slice(0, 6)
}

/** Customers who have ordered at least once (Analytics: new vs returning, top spenders). */
export async function customersWithOrders(ctx: Ctx): Promise<DCustomer[]> {
  if (await statsInstalled(ctx)) {
    const rows = await fetchAll<Row>('load customers', (from, to) => ctx.admin.from('customers').select(SELECT).eq('branch_id', ctx.branch.id)
      .gt('total_orders', 0).order('created_at', { ascending: false }).order('id').range(from, to))
    return rows.map(toCustomer)
  }
  return (await loadAllCustomersLegacy(ctx)).filter((c) => c.total_orders > 0)
}
