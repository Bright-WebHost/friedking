import { check, HttpError, id, int, optStr, str } from '@/lib/dashboard/server'
import type { Handler } from './index'

export const expensesHandler: Handler = {
  sections: ['pnl'],
  async get(ctx) {
    return { expenses: check(await ctx.admin.from('expenses').select('*').eq('branch_id', ctx.branch.id).order('expense_date', { ascending: false }).limit(2000), 'load expenses') ?? [] }
  },
  actions: {
    async add(ctx, b) {
      const date = str(b.date, 10)
      const category = str(b.category, 60)
      const amount = Math.round(Number(b.amount) * 100)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !category) throw new HttpError(400, 'Date, category and a valid amount are required')
      int(amount, 'amount', 1)
      check(await ctx.admin.from('expenses').insert({ branch_id: ctx.branch.id, expense_date: date, category, amount_paise: amount, note: optStr(b.note, 200), recorded_by: ctx.staff.name }), 'save the expense')
      return { ok: true }
    },
    async remove(ctx, b) {
      check(await ctx.admin.from('expenses').delete().eq('id', id(b.id)).eq('branch_id', ctx.branch.id), 'delete the expense')
      return { ok: true }
    },
  },
}
