import { check, HttpError, str } from '@/lib/dashboard/server'
import type { Handler } from './index'

export const chatHandler: Handler = {
  sections: ['chat'],
  async get(ctx, params) {
    const phone = params.get('phone')
    if (phone) {
      return { messages: check(await ctx.admin.from('chat_messages').select('*').eq('branch_id', ctx.branch.id).eq('phone', phone).order('created_at').limit(200), 'load messages') ?? [] }
    }
    return { sessions: check(await ctx.admin.from('chat_sessions').select('*').eq('branch_id', ctx.branch.id).order('last_message_at', { ascending: false, nullsFirst: false }).limit(80), 'load conversations') ?? [] }
  },
  actions: {
    async read(ctx, b) {
      await ctx.admin.from('chat_sessions').update({ unread_count: 0 }).eq('branch_id', ctx.branch.id).eq('phone', str(b.phone, 20))
      return { ok: true }
    },
    /** Staff reply: stored as an outbound message with delivery_status 'pending' for n8n to send. */
    async reply(ctx, b) {
      const phone = str(b.phone, 20)
      const message = str(b.message, 2000)
      if (!phone || !message) throw new HttpError(400, 'Type a message')
      check(await ctx.admin.from('chat_messages').insert({
        branch_id: ctx.branch.id, phone, direction: 'outbound', content: message, sender: ctx.staff.name, delivery_status: 'pending',
      }), 'queue the reply')
      await ctx.admin.from('chat_sessions').update({ last_message: message, last_message_at: new Date().toISOString() }).eq('branch_id', ctx.branch.id).eq('phone', phone)
      return { ok: true }
    },
    async ai(ctx, b) {
      const enabled = !!b.enabled
      check(await ctx.admin.from('chat_sessions').update({ ai_enabled: enabled, ai_disabled_by: enabled ? null : ctx.staff.name })
        .eq('branch_id', ctx.branch.id).eq('phone', str(b.phone, 20)), 'change AI')
      return { ok: true }
    },
  },
}
