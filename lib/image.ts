/** Use Supabase Image Transformations for public Storage images without changing local or third-party URLs. */
export function optimizeImageUrl(url: string | null, width: number) {
  if (!url) return url
  try {
    const parsed = new URL(url)
    const marker = '/storage/v1/object/public/'
    if (!parsed.pathname.includes(marker)) return url
    parsed.pathname = parsed.pathname.replace(marker, '/storage/v1/render/image/public/')
    parsed.searchParams.set('width', String(width))
    parsed.searchParams.set('quality', '72')
    parsed.searchParams.set('resize', 'cover')
    return parsed.toString()
  } catch {
    return url
  }
}
