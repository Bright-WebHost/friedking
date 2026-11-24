import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * True when friedking_phone_otp.sql has been run (the otp column exists).
 * If not, checkout stays open with the manual number field (fail-open) so ordering never breaks during setup.
 */
export async function verificationEnabled(db: SupabaseClient): Promise<boolean> {
  const { error } = await db.from('wa_verifications').select('id, otp').limit(1)
  return !error
}

/**
 * True when friedking_verify_by_message.sql has been run (branch_id column + the 3-argument wa_verify function).
 * The probe code can never match a real verification, so it changes nothing.
 */
export async function messageVerificationInstalled(db: SupabaseClient): Promise<boolean> {
  const col = await db.from('wa_verifications').select('id, branch_id').limit(1)
  if (col.error) return false
  const fn = await db.rpc('wa_verify', { p_code: '------', p_phone: '+910000000000', p_branch: '-' })
  return !fn.error
}

/** Branch slug from the request. Old pages that do not send one belong to Pandeshwar (the only branch before multi-branch). */
export function branchSlugOf(value: unknown): string {
  const s = String(value ?? '').trim().toLowerCase()
  return /^[a-z0-9-]{1,40}$/.test(s) ? s : 'pandeshwar'
}

/** "7337687522", "+91 73376 87522" or "917337687522" -> "917337687522"; '' when it is not a valid Indian mobile number. */
export function waNumber(value: string): string {
  const d = String(value ?? '').replace(/\D/g, '')
  const ten = d.length === 12 && d.startsWith('91') ? d.slice(2) : d.length === 10 ? d : ''
  return /^[6-9]\d{9}$/.test(ten) ? `91${ten}` : ''
}

/** Branch row + the settings the verification needs, for ONE branch. */
export async function loadBranchVerifySettings(db: SupabaseClient, slug: string) {
  const { data: branch } = await db.from('branches').select('id, slug, name, phone').eq('slug', slug).eq('is_active', true).maybeSingle()
  if (!branch) return null
  const { data: rows } = await db.from('branch_settings').select('key, value').eq('branch_id', branch.id)
    .in('key', ['otp_webhook_url', 'otp_template', 'otp_template_lang', 'whatsapp_number', 'sms_template_id', 'verify_by_message'])
  const get = (k: string) => String(rows?.find((r) => r.key === k)?.value ?? '').trim()
  return {
    branch: branch as { id: string; slug: string; name: string; phone: string | null },
    otpWebhookUrl: get('otp_webhook_url'),
    otpTemplate: get('otp_template') || 'friedking_otp',
    otpTemplateLang: get('otp_template_lang') || 'en',
    /** MSG91 template id. When set, an OTP for a customer outside the 24 h WhatsApp window is sent by SMS instead of a WhatsApp template. */
    smsTemplateId: get('sms_template_id'),
    /** Per-branch switch for "Verify on WhatsApp" (branch_settings.verify_by_message = '1'). Off for a branch until its n8n Main is updated. */
    verifyByMessage: ['1', 'only'].includes(get('verify_by_message')),
    /** verify_by_message = 'only': the OTP is not offered at all for this branch; WhatsApp message is the only method. */
    messageOnly: get('verify_by_message') === 'only',
    whatsappNumber: waNumber(get('whatsapp_number') || branch.phone || ''),
  }
}
