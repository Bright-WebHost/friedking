import { normalizePhone } from '@/lib/utils'
import { check, HttpError } from '@/lib/dashboard/server'
import type { Handler } from './index'
import { loadCustomers } from './pos'

export const contactsHandler: Handler = {
  sections: ['contacts', 'blast', 'analytics', 'loyalty'],
  async get(ctx) {
    return { customers: await loadCustomers(ctx) }
  },
  actions: {
    /** Paste or CSV: any text; every valid Indian mobile number in it is added. */
    async import(ctx, b) {
      const raw = String(b.text ?? '').split(/[\s,;]+/).filter(Boolean)
      const phones = [...new Set(raw.map((r) => normalizePhone(r)).filter((p): p is string => !!p))]
      if (!phones.length) throw new HttpError(400, 'No valid Indian mobile numbers found')
      check(await ctx.admin.from('customers').upsert(
        phones.map((phone) => ({ branch_id: ctx.branch.id, phone, source: 'import' })),
        { onConflict: 'branch_id,phone', ignoreDuplicates: true },
      ), 'import the numbers')
      return { phones }
    },
  },
}
