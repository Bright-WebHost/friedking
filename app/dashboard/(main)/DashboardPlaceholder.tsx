const SECTIONS: Record<string, { title: string; icon: string; description: string }> = {
  pos: { title: 'POS', icon: '🛒', description: 'Create counter orders and connect them to the same kitchen workflow as online orders.' },
  chat: { title: 'Live Chat', icon: '💬', description: 'WhatsApp conversations will appear here when the YCloud and n8n connection is enabled.' },
  stock: { title: 'Stock', icon: '📦', description: 'Track ingredients, low-stock alerts, restocking, and waste from one place.' },
  pnl: { title: 'P&L', icon: '💰', description: 'See revenue, food cost, expenses, gross profit, and net margin.' },
  riders: { title: 'Riders', icon: '🛵', description: 'Assign delivery orders, track cash collection, and manage delivery staff.' },
  analytics: { title: 'Analytics', icon: '📊', description: 'Revenue, order trends, best sellers, and pickup versus delivery reporting.' },
  ai: { title: 'AI Assistant', icon: '🤖', description: 'Ask about sales, stock, tables, and operational tasks.' },
  contacts: { title: 'Contacts', icon: '👥', description: 'Manage customer contacts, order history, and opt-out preferences.' },
  loyalty: { title: 'Loyalty', icon: '🎁', description: 'Build Fried King rewards, points, redemption, and customer retention.' },
  blast: { title: 'Broadcasts', icon: '📣', description: 'Send approved offers and updates to opted-in WhatsApp customers.' },
  settings: { title: 'Settings', icon: '⚙️', description: 'Manage branch details, hours, delivery rules, staff access, and notifications.' },
}

export default function DashboardPlaceholder({ section, branchSlug }: { section: string; branchSlug: string | null }) {
  const page = SECTIONS[section] ?? { title: 'Dashboard', icon: '🍗', description: 'This Fried King dashboard section is being prepared.' }
  if (section === 'analytics') return <DashboardReports branchSlug={branchSlug} />
  if (section === 'pnl') return <DashboardReports branchSlug={branchSlug} pnl />
  if (section === 'contacts') return <DashboardContacts branchSlug={branchSlug} />
  if (section === 'pos') return <DashboardPOS branchSlug={branchSlug} />
  if (section === 'settings') return <DashboardSettings branchSlug={branchSlug} />
  if (section === 'stock') return <StockBoard branchSlug={branchSlug} />
  if (section === 'loyalty') return <LoyaltyBoard branchSlug={branchSlug} />
  if (section === 'blast') return <BroadcastBoard branchSlug={branchSlug} />
  if (section === 'chat') return <IntegrationBoard title="Live Chat" description="WhatsApp conversations will appear here when the messaging connection is enabled." dependency="YCloud and n8n are currently paused pending client credentials and workflow setup. No messages are sent or fabricated until those integrations are connected." />
  return (
    <section>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div><h1 className="font-display text-3xl font-extrabold uppercase">{page.icon} {page.title}</h1><p className="text-sm text-fk-muted">{page.description}</p></div>
        <span className="rounded-full bg-[#fff3e5] px-3 py-1.5 text-xs font-bold text-[#b8730b]">Phase 2</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[#e6e9ee] bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-wider text-fk-muted">Branch</p><p className="mt-2 font-display text-2xl font-extrabold">Pandeshwar</p></div>
        <div className="rounded-2xl border border-[#e6e9ee] bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-wider text-fk-muted">Status</p><p className="mt-2 font-display text-2xl font-extrabold text-green-700">Ready</p></div>
        <div className="rounded-2xl border border-[#e6e9ee] bg-white p-5 shadow-sm"><p className="text-xs font-black uppercase tracking-wider text-fk-muted">Next</p><p className="mt-2 font-display text-2xl font-extrabold">Coming soon</p></div>
      </div>
      <div className="mt-4 rounded-2xl border border-dashed border-[#d6dbe2] bg-white p-10 text-center shadow-sm">
        <p className="text-4xl">{page.icon}</p>
        <h2 className="mt-3 font-display text-2xl font-extrabold">{page.title} is next</h2>
        <p className="mx-auto mt-2 max-w-lg text-sm leading-6 text-fk-muted">The navigation and Fried King dashboard layout are ready. This module will be connected to its Supabase data and actions in the next implementation phase.</p>
      </div>
    </section>
  )
}
import DashboardReports from './DashboardReports'
import DashboardContacts from './DashboardContacts'
import DashboardPOS from './DashboardPOS'
import DashboardSettings from './DashboardSettings'
import { BroadcastBoard, IntegrationBoard, LoyaltyBoard, StockBoard } from './DashboardPhase2'

