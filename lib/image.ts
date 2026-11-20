/**
 * Returns the image URL to show. Supabase Image Transformations (/storage/v1/render/image) are NOT enabled on this project
 * ("FeatureNotEnabled", HTTP 403), so rewriting Storage URLs to the render endpoint made every image uploaded from the dashboard
 * show as a broken picture. Keep the original URL. If the project ever gets the feature, restore the render rewrite here.
 */
export function optimizeImageUrl(url: string | null, _width: number) {
  return url
}
