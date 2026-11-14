import { audit, check, HttpError, id, int, num, optNum, str } from '@/lib/dashboard/server'
import type { Handler } from './index'
import { loadProgram } from './pos'

export const loyaltyHandler: Handler = {
  sections: ['loyalty', 'pos', 'analytics'],
  async get(ctx) {
    const program = await loadProgram(ctx)
    const rows = check(await ctx.admin.from('loyalty_accounts')
      .select('id, customer_id, points_balance, lifetime_points, tier, updated_at, customers!inner(id, name, phone, branch_id)')
      .eq('customers.branch_id', ctx.branch.id).order('points_balance', { ascending: false }).limit(1000), 'load loyalty accounts') ?? []
    const accounts = rows.map(({ customers, ...a }) => ({ ...a, customer: customers }))
    const ids = accounts.map((a) => a.id)
    const txns = ids.length
      ? check(await ctx.admin.from('loyalty_transactions').select('id, account_id, points, type, reason, created_at').in('account_id', ids).order('created_at', { ascending: false }).limit(5000), 'load loyalty history') ?? []
      : []
    return { program, accounts, transactions: txns }
  },
  actions: {
    async saveProgram(ctx, b) {
      const program = await loadProgram(ctx)
      if (!program) throw new HttpError(404, 'No active loyalty program')
      const type = ['points', 'visit', 'cashback'].includes(String(b.type)) ? String(b.type) : 'points'
      const value = num(b.redemptionValue ?? 0.5, 'redemption value')
      const maxDay = optNum(b.maxRedeemPerDay, 'daily limit')
      check(await ctx.admin.from('loyalty_programs').update({
        name: str(b.name, 60) || 'Fried King Rewards',
        currency_name: str(b.currencyName, 30) || 'points',
        type,
        earn_rate_per_rupee: num(b.earnRatePerRupee ?? 0, 'earn rate'),
        earn_rate_per_visit: int(b.earnRatePerVisit ?? 0, 'points per visit'),
        redemption_paise_per_point: Math.round(value * 100),
        min_spend_to_earn_paise: Math.round(num(b.minSpend ?? 0, 'minimum spend') * 100),
        max_redeem_pct_per_order: int(b.maxRedeemPct ?? 20, 'max redeem %', 0, 100),
        max_redeem_paise_per_day: maxDay == null ? null : Math.round(maxDay * 100),
        points_expiry_days: b.expiryDays === '' || b.expiryDays == null ? null : int(b.expiryDays, 'expiry days', 1),
        updated_at: new Date().toISOString(),
      }).eq('id', program.id), 'save the program')
      await audit(ctx, { action: 'loyalty_settings_update', detail: `${ctx.staff.name} updated loyalty program settings` })
      return { ok: true }
    },
    async saveTiers(ctx, b) {
      const program = await loadProgram(ctx)
      if (!program) throw new HttpError(404, 'No active loyalty program')
      const tiers = (Array.isArray(b.tiers) ? b.tiers : []).map((t: Record<string, unknown>) => ({
        name: str(t.name, 40), min_lifetime_points: Math.max(0, Math.floor(Number(t.min_lifetime_points) || 0)), perk: str(t.perk, 120),
      })).filter((t: { name: string }) => t.name)
      check(await ctx.admin.from('loyalty_programs').update({ tiers }).eq('id', program.id), 'save tiers')
      return { ok: true }
    },
    async redeem(ctx, b) {
      const points = int(b.points, 'points', 1)
      const { data, error } = await ctx.admin.rpc('fk_loyalty_redeem', { p_customer_id: id(b.customerId, 'customer'), p_points: points, p_order_id: null, p_note: str(b.note, 120) || 'Manual redeem at counter', p_staff: ctx.staff.name })
      if (error) throw new HttpError(500, 'Redeem failed')
      if (!data?.ok) throw new HttpError(409, `Redeem failed: ${String(data?.reason ?? 'unknown').replace(/_/g, ' ')}`)
      await audit(ctx, { action: 'loyalty_redeem', detail: `${points} pts · ${str(b.note, 120)} · by ${ctx.staff.name}` })
      return data
    },
  },
}
