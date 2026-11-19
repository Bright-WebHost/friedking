import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'images.unsplash.com' },
      { protocol: 'https', hostname: '*.supabase.co' },
      { protocol: 'https', hostname: '*.supabase.in' },
    ],
  },
  async headers() {
    const common = [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    ]
    return [
      { source: '/:path*', headers: common },
      // Staff pages and the platform admin must never be framed by another site.
      { source: '/dashboard/:path*', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] },
      { source: '/platform-admin/:path*', headers: [{ key: 'X-Frame-Options', value: 'DENY' }] },
    ]
  },
}

export default nextConfig
