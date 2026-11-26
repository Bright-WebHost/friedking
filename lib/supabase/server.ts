import { createServerClient } from '@supabase/ssr'
import { publicProject } from './project'
import { cookies } from 'next/headers'

/** Server-side Supabase client (anon key, respects RLS). */
export async function createClient(branch?: string | null) {
  const { url, key } = publicProject(branch)
  const cookieStore = await cookies()
  return createServerClient(
    url,
    key,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Called from Server Component — safe to ignore
          }
        },
      },
    }
  )
}
