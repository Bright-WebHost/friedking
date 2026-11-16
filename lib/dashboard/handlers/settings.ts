import { SETTING_KEYS } from '@/lib/dashboard/settings'
import { audit, check, clearBranchCache, getSettings, HttpError, id, optStr, str, uploadImage } from '@/lib/dashboard/server'
import type { Handler } from './index'

const ROLES = ['owner', 'manager', 'staff']
const bool = (v: unknown) => v === true || v === 'true' || v === 'on' || v === '1'
const time = (v: unknown) => {
  const s = str(v, 8)
  return /^\d{2}:\d{2}(:\d{2})?$/.test(s) ? s : null
}

export const settingsHandler: Handler = {
  sections: ['settings'],
  async get(ctx) {
    const [settings, pincodes, staff, categories, promotions] = await Promise.all([
      getSettings(ctx),
      ctx.admin.from('delivery_pincodes').select('*').eq('branch_id', ctx.branch.id).order('pincode'),
      ctx.admin.from('staff').select('*').or(`branch_id.eq.${ctx.branch.id},branch_id.is.null`).order('created_at'),
      ctx.admin.from('menu_categories').select('id, name, image_url, sort_order').eq('branch_id', ctx.branch.id).order('sort_order'),
      ctx.admin.from('menu_promotions').select('*').eq('branch_id', ctx.branch.id).order('created_at', { ascending: false }),
    ])
    // Older staff rows have no email column filled: read it from Supabase Auth.
    const staffRows = await Promise.all((check(staff, 'load staff') ?? []).map(async (s) => {
      let email = s.email as string | null
      if (!email) email = (await ctx.admin.auth.admin.getUserById(s.user_id)).data.user?.email ?? null
      return { user_id: s.user_id, name: s.name ?? null, email, role: s.role, branch_id: s.branch_id, is_active: s.is_active !== false, created_at: s.created_at }
    }))
    return {
      branch: ctx.branch, settings,
      pincodes: check(pincodes, 'load pincodes') ?? [],
      staff: staffRows, me: ctx.staff.userId,
      categories: check(categories, 'load categories') ?? [],
      promotions: check(promotions, 'load banners') ?? [],
    }
  },
  actions: {
    async save(ctx, b) {
      const branchUpdate: Record<string, unknown> = {}
      if (b.name !== undefined) branchUpdate.name = str(b.name, 80) || ctx.branch.name
      if (b.address !== undefined) branchUpdate.address = optStr(b.address, 300)
      if (b.phone !== undefined) branchUpdate.phone = optStr(b.phone, 20)
      if (b.opensAt !== undefined) branchUpdate.opens_at = time(b.opensAt) ?? ctx.branch.opens_at
      if (b.closesAt !== undefined) branchUpdate.closes_at = time(b.closesAt) ?? ctx.branch.closes_at
      if (Object.keys(branchUpdate).length) { check(await ctx.admin.from('branches').update(branchUpdate).eq('id', ctx.branch.id), 'save the branch'); clearBranchCache() }

      const rows = SETTING_KEYS.filter((k) => b.settings && k in b.settings).map((key) => ({
        branch_id: ctx.branch.id, key, value: str(b.settings[key], 1000), updated_at: new Date().toISOString(),
      }))
      if (rows.length) check(await ctx.admin.from('branch_settings').upsert(rows, { onConflict: 'branch_id,key' }), 'save settings')
      await audit(ctx, { action: 'settings_update', detail: `by ${ctx.staff.name}` })
      return { ok: true }
    },
    async logo(ctx, b) {
      const url = await uploadImage(ctx, b.image, 'branding', 'logo')
      check(await ctx.admin.from('branch_settings').upsert({ branch_id: ctx.branch.id, key: 'logo_url', value: url }, { onConflict: 'branch_id,key' }), 'save the logo')
      return { url }
    },
    async categoryImage(ctx, b) {
      const categoryId = id(b.categoryId, 'category')
      const url = await uploadImage(ctx, b.image, 'categories', categoryId)
      check(await ctx.admin.from('menu_categories').update({ image_url: url }).eq('id', categoryId).eq('branch_id', ctx.branch.id), 'save the category image')
      return { url }
    },
    async banner(ctx, b) {
      const title = str(b.title, 120)
      if (!title) throw new HttpError(400, 'A title is required')
      const payload: Record<string, unknown> = {
        title, description: optStr(b.description, 300), starts_at: optStr(b.startsAt, 10), ends_at: optStr(b.endsAt, 10),
        is_active: bool(b.isActive), updated_at: new Date().toISOString(),
      }
      if (b.image instanceof File && b.image.size > 0) payload.image_url = await uploadImage(ctx, b.image, 'banners', title)
      const res = b.id
        ? await ctx.admin.from('menu_promotions').update(payload).eq('id', id(b.id)).eq('branch_id', ctx.branch.id)
        : await ctx.admin.from('menu_promotions').insert({ ...payload, branch_id: ctx.branch.id })
      if (res.error) throw new HttpError(400, res.error.message.includes('check') ? 'End date must be after the start date' : 'Could not save the banner')
      return { ok: true }
    },
    async deleteBanner(ctx, b) {
      check(await ctx.admin.from('menu_promotions').delete().eq('id', id(b.id)).eq('branch_id', ctx.branch.id), 'delete the banner')
      return { ok: true }
    },
    async addPincode(ctx, b) {
      const pincode = str(b.pincode, 6)
      if (!/^\d{6}$/.test(pincode)) throw new HttpError(400, 'Enter a valid 6-digit pincode')
      check(await ctx.admin.from('delivery_pincodes').upsert({ branch_id: ctx.branch.id, pincode, area: optStr(b.area, 80), is_active: true }, { onConflict: 'branch_id,pincode' }), 'add the pincode')
      return { ok: true }
    },
    async removePincode(ctx, b) {
      check(await ctx.admin.from('delivery_pincodes').delete().eq('branch_id', ctx.branch.id).eq('pincode', str(b.pincode, 6)), 'remove the pincode')
      return { ok: true }
    },
    /** Creates the Supabase login (email + temporary password) and the staff row for this branch. */
    async addStaff(ctx, b) {
      const name = str(b.name, 60)
      const email = str(b.email, 120).toLowerCase()
      const password = String(b.password ?? '')
      const role = ROLES.includes(String(b.role)) ? String(b.role) : 'staff'
      if (!name || !/^\S+@\S+\.\S+$/.test(email)) throw new HttpError(400, 'Name and a valid email are required')
      if (password.length < 8) throw new HttpError(400, 'Temporary password must be at least 8 characters')
      const created = await ctx.admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: { display_name: name } })
      if (created.error || !created.data.user) {
        throw new HttpError(409, created.error?.message.includes('already') ? 'That email already has a login' : 'Could not create the login')
      }
      const res = await ctx.admin.from('staff').insert({
        user_id: created.data.user.id, branch_id: role === 'owner' ? null : ctx.branch.id, role, name, email, is_active: true,
      })
      if (res.error) {
        await ctx.admin.auth.admin.deleteUser(created.data.user.id)
        throw new HttpError(500, 'Could not save the staff member')
      }
      await audit(ctx, { action: 'staff_add', to: `${name} (${role})`, detail: `by ${ctx.staff.name}` })
      return { ok: true }
    },
    async staffRole(ctx, b) {
      const userId = id(b.userId, 'staff member')
      if (userId === ctx.staff.userId) throw new HttpError(400, 'You cannot change your own role')
      const role = ROLES.includes(String(b.role)) ? String(b.role) : 'staff'
      check(await ctx.admin.from('staff').update({ role, branch_id: role === 'owner' ? null : ctx.branch.id }).eq('user_id', userId), 'update the role')
      return { ok: true }
    },
    async staffActive(ctx, b) {
      const userId = id(b.userId, 'staff member')
      check(await ctx.admin.from('staff').update({ is_active: bool(b.active) }).eq('user_id', userId), 'update the staff member')
      return { ok: true }
    },
    /** Removes dashboard access (the staff row). The Supabase login stays; without a staff row it can't open the dashboard. */
    async removeStaff(ctx, b) {
      const userId = id(b.userId, 'staff member')
      if (userId === ctx.staff.userId) throw new HttpError(400, 'You cannot remove yourself')
      check(await ctx.admin.from('staff').delete().eq('user_id', userId), 'remove the staff member')
      await audit(ctx, { action: 'staff_remove', detail: `by ${ctx.staff.name}` })
      return { ok: true }
    },
  },
}
