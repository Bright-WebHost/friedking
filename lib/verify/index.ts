import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * True when friedking_phone_otp.sql has been run (the otp column exists).
 * If not, checkout stays open with the manual number field (fail-open) so ordering never breaks during setup.
 */
export async function verificationEnabled(db: SupabaseClient): Promise<boolean> {
  const { error } = await db.from('wa_verifications').select('id, otp').limit(1)
  return !error
}
