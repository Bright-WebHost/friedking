import { normalizePhone } from '@/lib/utils'
import { check, HttpError, str } from '@/lib/dashboard/server'
import type { Handler } from './index'
import { loadCustomers } from './pos'

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

export const contactsHandler: Handler = {
  sections: ['contacts', 'blast', 'analytics', 'loyalty'],
  async get(ctx) {
    return { customers: await loadCustomers(ctx) }
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
