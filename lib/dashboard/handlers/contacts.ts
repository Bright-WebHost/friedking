import { normalizePhone } from '@/lib/utils'
import { check, HttpError, str } from '@/lib/dashboard/server'
import type { Handler } from './index'
import type { Ctx } from '@/lib/dashboard/server'
import { contactsByPhones, contactsFirst, contactsMatching, contactsPage, fetchAll, contactTotals, customersWithOrders, SEGMENTS, SORTS, type ContactFilter, type Segment, type Sort } from '@/lib/dashboard/customers'

/** Search / filter / sort from the request, validated. */
function filterOf(src: { get(k: string): string | null }): ContactFilter & { sort: Sort } {
  const seg = String(src.get('seg') ?? 'all') as Segment
  const sort = String(src.get('sort') ?? 'last_desc') as Sort
  return { q: String(src.get('q') ?? '').slice(0, 60), seg: SEGMENTS.includes(seg) ? seg : 'all', sort: SORTS.includes(sort) ? sort : 'last_desc' }
}

/** A name: letters only, tidy spaces, max 60 characters. Empty when the text has no letters. */
function cleanName(text: string) {
  const name = text.replace(/[^\p{L}\p{M}\s.'-]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 60)
  return /\p{L}/u.test(name) ? name : ''
}

/**
 * Reads pasted text or a CSV. Each line may be "Name, number", "number, Name", "Name number" or just a number.
 * A line with several numbers (e.g. "98450 12345, 77952 40605") is a plain list and gets no names.
 */
export function parseContacts(text: string) {
  const out = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const cells = line.split(/[,;\t]/).map((c) => c.trim()).filter(Boolean)
    const phones: string[] = []
    const names: string[] = []
    for (const cell of cells) {
      // A cell can hold both, e.g. "Shahil 77952 40605".
      const digits = cell.match(/\+?\d[\d\s()-]{8,}\d/g) ?? []
      for (const d of digits) { const p = normalizePhone(d); if (p) phones.push(p) }
      const name = cleanName(digits.reduce((rest, d) => rest.replace(d, ' '), cell))
      if (name) names.push(name)
    }
    const name = phones.length === 1 ? (names[0] ?? '') : ''
    for (const p of phones) if (!out.get(p)) out.set(p, name)
  }
  return out
}

/** One message's state as the dashboard shows it. */
function messageState(m: { status: string; delivery_status: string | null }) {
  if (m.status === 'failed' || m.delivery_status === 'failed') return 'failed'
  if (m.delivery_status === 'read' || m.delivery_status === 'delivered') return m.delivery_status
  return m.status === 'done' ? 'sent' : 'waiting'
}

/** Messages of one promotion, optionally only the failed ones. */
function promoMessages(ctx: Ctx, id: string, only: string, cols: string, withCount = false) {
  let q = ctx.admin.from('outbound_messages').select(cols, withCount ? { count: 'exact' } : undefined).eq('branch_id', ctx.branch.id).eq('campaign_id', id)
  if (only === 'failed') q = q.or('status.eq.failed,delivery_status.eq.failed')
  return q
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export const contactsHandler: Handler = {
  sections: ['contacts', 'blast', 'analytics', 'loyalty'],
  /**
   * GET ?page=&size=&q=&seg=&sort= -> one page of contacts { customers, matching, total, optedOut, page, size }.
   * GET ?view=ordered -> every customer who has ordered (Analytics).
   */
  async get(ctx, params) {
    // Promotion history: GET ?view=promos -> past promotions, newest first, each with its delivery counts.
    if (params.get('view') === 'promos') {
      const list = check(await ctx.admin.from('broadcast_campaigns').select('id, title, template_name, recipient_count, created_by_name, created_at')
        .eq('branch_id', ctx.branch.id).order('created_at', { ascending: false }).limit(100), 'load promotions') ?? []
      const stats: Record<string, unknown> = {}
      if (list.length) {
        const r = await ctx.admin.rpc('fk_blast_campaign_stats', { p_campaign_ids: list.map((c) => c.id) })
        if (!r.error) for (const x of (r.data ?? []) as Array<{ campaign_id: string }>) stats[x.campaign_id] = x
      }
      return { campaigns: list, stats }
    }
    // GET ?view=promo&id=&only=&page= -> the contacts one promotion was sent to (100 per page).
    if (params.get('view') === 'promo') {
      const id = String(params.get('id') ?? '')
      if (!UUID.test(id)) throw new HttpError(400, 'Invalid promotion')
      const only = params.get('only') === 'failed' ? 'failed' : 'all'
      const page = Math.max(1, Math.floor(Number(params.get('page')) || 1))
      const from = (page - 1) * 100
      const res = await promoMessages(ctx, id, only, 'to_phone, status, delivery_status, delivery_error, error_message, processed_at, created_at', true)
        .order('created_at').order('id').range(from, from + 99)
      const rows = (check(res, 'load the promotion') ?? []) as unknown as Array<{ to_phone: string; status: string; delivery_status: string | null; delivery_error: string | null; error_message: string | null; processed_at: string | null; created_at: string }>
      const names = new Map((await contactsByPhones(ctx, rows.map((r) => r.to_phone))).map((c) => [c.phone, c.name]))
      return {
        page, size: 100, matching: (res as { count: number | null }).count ?? rows.length,
        recipients: rows.map((r) => ({ phone: r.to_phone, name: names.get(r.to_phone) ?? null, state: messageState(r), error: r.delivery_error || r.error_message || null, at: r.processed_at ?? r.created_at })),
      }
    }
    if (params.get('view') === 'ordered') return { customers: await customersWithOrders(ctx) }
    const f = filterOf(params)
    const size = Math.min(200, Math.max(10, Math.floor(Number(params.get('size')) || 100)))
    const page = Math.max(1, Math.floor(Number(params.get('page')) || 1))
    const [list, totals] = await Promise.all([contactsPage(ctx, f, f.sort, page, size), contactTotals(ctx)])
    return { ...list, ...totals, page, size }
  },
  actions: {
    /** Paste or CSV. New numbers are added with their name; an existing contact gets the name only if it has none. */
    async import(ctx, b) {
      const parsed = parseContacts(String(b.text ?? ''))
      if (!parsed.size) throw new HttpError(400, 'No valid Indian mobile numbers found')
      const phones = [...parsed.keys()]

      const existing = new Map<string, string | null>()
      for (let i = 0; i < phones.length; i += 500) {
        const r = check(await ctx.admin.from('customers').select('phone, name').eq('branch_id', ctx.branch.id).in('phone', phones.slice(i, i + 500)), 'read contacts')
        for (const c of r as Array<{ phone: string; name: string | null }>) existing.set(c.phone, c.name)
      }

      const fresh = phones.filter((p) => !existing.has(p))
      if (fresh.length) {
        check(await ctx.admin.from('customers').upsert(
          fresh.map((phone) => ({ branch_id: ctx.branch.id, phone, name: parsed.get(phone) || null, source: 'import' })),
          { onConflict: 'branch_id,phone', ignoreDuplicates: true },
        ), 'import the numbers')
      }
      let named = 0
      for (const phone of phones) {
        const name = parsed.get(phone)
        if (!name || !existing.has(phone) || (existing.get(phone) ?? '').trim()) continue
        check(await ctx.admin.from('customers').update({ name }).eq('branch_id', ctx.branch.id).eq('phone', phone), 'save the name')
        named++
      }
      const withName = phones.filter((p) => parsed.get(p)).length
      return { phones, added: fresh.length, withName, named }
    },
    /** Every reachable (not opted-out) number matching the search and filter: "Select all" on Contacts. */
    async phones(ctx, b) {
      const f = filterOf({ get: (k: string) => (b[k] == null ? null : String(b[k])) })
      return { phones: (await contactsMatching(ctx, { ...f, reachableOnly: true })).map((c) => c.phone) }
    },
    /** Every reachable number a promotion was sent to (or only the failed ones), to send again. */
    async promoPhones(ctx, b) {
      const id = String(b.id ?? '')
      if (!UUID.test(id)) throw new HttpError(400, 'Invalid promotion')
      const rows = await fetchAll<{ to_phone: string }>('load the promotion', (from, to) => promoMessages(ctx, id, b.only === 'failed' ? 'failed' : 'all', 'to_phone').order('id').range(from, to) as unknown as PromiseLike<{ data: Array<{ to_phone: string }> | null; error: { message: string } | null }>)
      const live = new Set((await contactsByPhones(ctx, [...new Set(rows.map((r) => r.to_phone))])).filter((c) => !c.opted_out).map((c) => c.phone))
      return { phones: [...live] }
    },
    /** The first N reachable numbers of the current search / filter / sort ("Select first N"). */
    async firstPhones(ctx, b) {
      const f = filterOf({ get: (k: string) => (b[k] == null ? null : String(b[k])) })
      const count = Math.min(5000, Math.floor(Number(b.count)) || 0)
      if (count < 1) throw new HttpError(400, 'Enter how many contacts to select')
      return { phones: (await contactsFirst(ctx, f, f.sort, count)).map((c) => c.phone) }
    },
    /** Add or correct one contact's name (used in promotions as "Hi <name>"). */
    async setName(ctx, b) {
      const phone = normalizePhone(String(b.phone ?? ''))
      if (!phone) throw new HttpError(400, 'Invalid number')
      const name = cleanName(str(b.name, 80))
      check(await ctx.admin.from('customers').update({ name: name || null }).eq('branch_id', ctx.branch.id).eq('phone', phone), 'save the name')
      return { ok: true, name }
    },
  },
}
