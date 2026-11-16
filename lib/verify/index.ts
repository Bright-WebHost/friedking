import type { SupabaseClient } from '@supabase/supabase-js'

/** True when the verification table exists. If the SQL has not been run yet, checkout stays open (fail-open). */
export async function verificationEnabled(db: SupabaseClient): Promise<boolean> {
  const { error } = await db.from('wa_verifications').select('id').limit(1)
  return !error
}
