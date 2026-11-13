import { createClient } from '@supabase/supabase-js'

/**
 * Service-role admin client — bypasses RLS.
 * Use only in server-side API routes, never in client components.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    const missing = [!url && 'NEXT_PUBLIC_SUPABASE_URL', !key && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean)
    throw new Error(
      `Missing ${missing.join(' and ')}. Copy .env.local.example to .env.local, fill it in, then restart npm run dev.`
    )
  }

  return createClient(
    url,
    key,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  )
}
