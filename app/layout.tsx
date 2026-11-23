import type { Metadata, Viewport } from 'next'
import { Barlow_Condensed, Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({ subsets: ['latin'], variable: '--font-inter' })

// Bold condensed headings, close to the lettering on the promo banners.
const barlow = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['600', '700', '800'],
  variable: '--font-barlow',
})

export const metadata: Metadata = {
  title: 'Fried King | Order Online',
  description: 'Order Fried King fried chicken online in Mangaluru. Pickup or delivery.',
}

export const viewport: Viewport = {
  themeColor: '#ec1c23',
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${barlow.variable}`}>
      {/* Browser extensions (e.g. ColorZilla) add attributes to <body>; don't treat that as a hydration error. */}
      <body suppressHydrationWarning>{children}</body>
    </html>
  )
}
