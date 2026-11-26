import { createClient } from '@supabase/supabase-js'
import { isSecondaryBranch, publicProject } from './project'

/** Service-role client. The request's branch determines the project before any privileged query. */
export function createAdminClient(branch?: string | null) {
  const { url } = publicProject(branch)
  const key = isSecondaryBranch(branch)
    ? process.env.SUPABASE_SECONDARY_SERVICE_ROLE_KEY
    : process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!key) throw new Error('Supabase server configuration is incomplete')
  return createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
}
