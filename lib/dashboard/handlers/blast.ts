import { DEFAULT_MONTHLY_BLAST_LIMIT } from '@/lib/dashboard/settings'
import { audit, check, getSettings, HttpError, int, str, uploadImage, type Ctx } from '@/lib/dashboard/server'
import type { Handler } from './index'
import { loadCustomers } from './pos'

/** Start of the current calendar month in IST, as a UTC instant (same as Oceana's monthStartIST). */
export function monthStartIST() {
  const IST = 5.5 * 3600000
  const now = new Date(Date.now() + IST)
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) - IST).toISOString()
}

async function sentThisMonth(ctx: Ctx) {
  const { count } = await ctx.admin.from('outbound_messages').select('id', { count: 'exact', head: true })
    .eq('branch_id', ctx.branch.id).eq('kind', 'blast').neq('status', 'failed').gte('created_at', monthStartIST())
  return count ?? 0
}

function monthlyLimit(value: string | undefined) {
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_MONTHLY_BLAST_LIMIT
}

async function saveSetting(ctx: Ctx, key: string, value: string) {
  check(await ctx.admin.from('branch_settings').upsert({ branch_id: ctx.branch.id, key, value, updated_at: new Date().toISOString() }, { onConflict: 'branch_id,key' }), 'save the setting')
}

export const blastHandler: Handler = {
  sections: ['blast'],
  async get(ctx) {
    const [eligible, sent, settings, campaigns] = await Promise.all([
      ctx.admin.from('customers').select('id', { count: 'exact', head: true }).eq('branch_id', ctx.branch.id).eq('opted_out', false),
      sentThisMonth(ctx),
      getSettings(ctx),
      ctx.admin.from('broadcast_campaigns').select('id, title, template_name, audience, status, recipient_count, created_by_name, created_at').eq('branch_id', ctx.branch.id).order('created_at', { ascending: false }).limit(10),
    ])
    // Real per-message results (needs friedking_blast_delivery_status.sql; without it the table keeps the old status).
    const list = campaigns.data ?? []
    const stats: Record<string, unknown> = {}
    if (list.length) {
      const r = await ctx.admin.rpc('fk_blast_campaign_stats', { p_campaign_ids: list.map((c) => c.id) })
      if (!r.error) for (const s of (r.data ?? []) as Array<{ campaign_id: string }>) stats[s.campaign_id] = s
    }
    return {
      campaignStats: stats,
      eligible: eligible.count ?? 0, sentThisMonth: sent, cap: monthlyLimit(settings.blast_monthly_limit),
      headerImage: settings.blast_header_image, headerVideo: settings.blast_header_video, template: settings.blast_template, campaigns: campaigns.data ?? [],
    }
  },
  actions: {
    async saveHeader(ctx, b) {
      await saveSetting(ctx, 'blast_header_image', str(b.url, 500))
      return { ok: true }
    },
    /** Videos are too big for a serverless request body (4.5 MB), so the browser uploads straight to storage with this one-time link. */
    async videoUploadUrl(ctx) {
      const path = `blast/${ctx.branch.id}/video-${Date.now()}.mp4`
      const signed = await ctx.admin.storage.from('menu').createSignedUploadUrl(path)
      if (signed.error || !signed.data) {
        console.error('[dashboard] video upload url:', signed.error?.message)
        throw new HttpError(500, 'Could not start the video upload')
      }
      return { path, token: signed.data.token, url: ctx.admin.storage.from('menu').getPublicUrl(path).data.publicUrl }
    },
    async saveVideo(ctx, b) {
      const url = str(b.url, 500)
      if (url && !/\.mp4$/i.test(url)) throw new HttpError(400, 'The video must be an MP4 file')
      await saveSetting(ctx, 'blast_header_video', url)
      return { ok: true }
    },
    async uploadHeader(ctx, b) {
      const url = await uploadImage(ctx, b.image, 'blast', 'header')
      await saveSetting(ctx, 'blast_header_image', url)
      return { url }
    },
    /** Queues one outbound_messages row per recipient; n8n sends them. Nothing is sent from here. */
    async send(ctx, b) {
      const template = str(b.templateName, 80)
      if (!template) throw new HttpError(400, 'Enter the approved template name')
      const header = str(b.headerImage, 500)
      if (/video/i.test(template) && !/\.mp4(\?|$)/i.test(header)) throw new HttpError(400, 'Upload the MP4 video first: a video template needs it on every send')
      const selected = new Set((Array.isArray(b.phones) ? b.phones : []).map(String))
      const filter = selected.size ? 'selection' : (['all', 'active_30', 'repeat'].includes(String(b.filter)) ? String(b.filter) : 'all')

      const customers = (await loadCustomers(ctx)).filter((c) => !c.opted_out)
      const cutoff = new Date(Date.now() - 30 * 86400000).toISOString()
      const recipients = customers.filter((c) =>
        filter === 'selection' ? selected.has(c.phone)
          : filter === 'active_30' ? !!c.last_order_at && c.last_order_at >= cutoff
            : filter === 'repeat' ? c.total_orders > 1 : true)
      if (!recipients.length) throw new HttpError(400, 'Nobody matches that audience')

      const settings = await getSettings(ctx)
      const cap = monthlyLimit(settings.blast_monthly_limit)
      const remaining = Math.max(0, cap - await sentThisMonth(ctx))
      if (recipients.length > remaining) {
        throw new HttpError(409, `This would send to ${recipients.length} people, but only ${remaining} sends are left this month (cap ${cap}).`)
      }

      const campaign = check(await ctx.admin.from('broadcast_campaigns').insert({
        branch_id: ctx.branch.id, title: template, message: template, audience: filter, status: 'queued',
        template_name: template, header_image: header || null, recipient_count: recipients.length,
        created_by: ctx.staff.userId, created_by_name: ctx.staff.name,
      }).select('id').single(), 'save the campaign')
      check(await ctx.admin.from('outbound_messages').insert(recipients.map((c) => ({
        branch_id: ctx.branch.id, kind: 'blast', campaign_id: campaign.id, to_phone: c.phone,
        template_name: template, language: 'en', header_image: header || null, payload: { customerName: c.name },
      }))), 'queue the messages')
      // A .mp4 link is a video header (n8n sends it as a video); anything else is an image.
      if (header && /\.mp4(\?|$)/i.test(header)) await saveSetting(ctx, 'blast_header_video', header)
      else if (header) await saveSetting(ctx, 'blast_header_image', header)
      await saveSetting(ctx, 'blast_template', template)
      await audit(ctx, { action: 'blast_queued', detail: `${template} → ${recipients.length} (${filter}) by ${ctx.staff.name}` })
      return { queued: recipients.length }
    },
  },
}
