import { normalizePhone } from '@/lib/utils'
import { check, HttpError, id, int, needSection, optStr, str } from '@/lib/dashboard/server'
import type { Handler } from './index'

export const ridersHandler: Handler = {
  // Orders/Tables need the rider list to assign deliveries; managing riders needs the Riders page.
  sections: ['riders', 'orders'],
  async get(ctx) {
    const [riders, payments] = await Promise.all([
      ctx.admin.from('riders').select('*').eq('branch_id', ctx.branch.id).order('name'),
      ctx.admin.from('rider_payments').select('*').eq('branch_id', ctx.branch.id).order('created_at', { ascending: false }).limit(500),
    ])
    return { riders: check(riders, 'load riders') ?? [], payments: check(payments, 'load handovers') ?? [] }
  },
  actions: {
    async add(ctx, b) {
      needSection(ctx, 'riders')
      const name = str(b.name, 60)
      const phone = normalizePhone(str(b.phone, 20))
      if (!name || !phone) throw new HttpError(400, 'Name and a valid number are needed')
      const res = await ctx.admin.from('riders').insert({ branch_id: ctx.branch.id, name, phone })
      if (res.error) throw new HttpError(409, res.error.message.includes('duplicate') ? 'That number is already a rider' : 'Could not add')
      return { ok: true }
    },
    async toggle(ctx, b) {
      needSection(ctx, 'riders')
      const r = check(await ctx.admin.from('riders').select('id, is_active').eq('id', id(b.id)).eq('branch_id', ctx.branch.id).maybeSingle(), 'load the rider')
      if (!r) throw new HttpError(404, 'Rider not found')
      check(await ctx.admin.from('riders').update({ is_active: !r.is_active }).eq('id', r.id), 'update the rider')
      return { active: !r.is_active }
    },
    async remove(ctx, b) {
      needSection(ctx, 'riders')
      const res = await ctx.admin.from('riders').delete().eq('id', id(b.id)).eq('branch_id', ctx.branch.id)
      if (res.error) throw new HttpError(409, 'Could not delete. They may be linked to live orders.')
      return { ok: true }
    },
    async handover(ctx, b) {
      needSection(ctx, 'riders')
      const riderId = id(b.id)
      const amount = Math.round(Number(b.amount) * 100)
      int(amount, 'amount', 1)
      check(await ctx.admin.from('rider_payments').insert({ branch_id: ctx.branch.id, rider_id: riderId, amount_paise: amount, note: optStr(b.note, 200), received_by: ctx.staff.name }), 'record the handover')
      return { ok: true }
    },
  },
}
