import { getSettings } from '@/lib/dashboard/server'
import type { Handler } from './index'

/** What the shell needs on every page: branch, settings, staff identity, active riders. */
export const metaHandler: Handler = {
  sections: ['pos', 'orders', 'tables'],
  async get(ctx) {
    const [settings, riders] = await Promise.all([
      getSettings(ctx),
      ctx.admin.from('riders').select('id, name, phone, is_active').eq('branch_id', ctx.branch.id).order('name'),
    ])
    return {
      branch: ctx.branch,
      settings,
      staff: { name: ctx.staff.name, email: ctx.staff.email, role: ctx.staff.role, branchId: ctx.staff.branchId },
      riders: riders.data ?? [],
      serverTime: new Date().toISOString(),
    }
  },
}
