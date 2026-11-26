import { createBrowserClient } from '@supabase/ssr'
import { isSecondaryBranch, publicProject } from './project'

/** Browser-side Supabase client (anon key, respects RLS). */
export function createClient(branch?: string | null) {
  const { url, key } = publicProject(branch)
  if (isSecondaryBranch(branch) && secondaryClient) return secondaryClient
  const client = createBrowserClient(
    url,
    key,
    {
      isSingleton: !isSecondaryBranch(branch),
      global: {
        fetch: (url, options) => fetch(url, { ...options, cache: 'no-store' }),
      },
    }
  )
  if (isSecondaryBranch(branch)) secondaryClient = client
  return client
}

let secondaryClient: ReturnType<typeof createBrowserClient> | undefined
