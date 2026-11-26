const KADRI_BRANCH = 'kadri'
export const BANGALORE_BRANCH = 'bangalore'

export const secondaryBranches = [
  ...(process.env.NEXT_PUBLIC_FRIEDKING_KADRI_ON_SECONDARY === 'true' ? [KADRI_BRANCH] : []),
  ...(process.env.NEXT_PUBLIC_FRIEDKING_BANGALORE_ON_SECONDARY === 'true' ? [BANGALORE_BRANCH] : []),
]

export function secondaryBranch(branch?: string | null): string | null {
  const slug = branch?.trim().toLowerCase() ?? ''
  return secondaryBranches.includes(slug) ? slug : null
}

export function isSecondaryBranch(branch?: string | null): boolean {
  return secondaryBranch(branch) !== null
}

export function publicProject(branch?: string | null) {
  const secondary = isSecondaryBranch(branch)
  const url = secondary ? process.env.NEXT_PUBLIC_SUPABASE_SECONDARY_URL : process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = secondary ? process.env.NEXT_PUBLIC_SUPABASE_SECONDARY_ANON_KEY : process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Supabase project configuration is incomplete')
  return { url, key }
}
