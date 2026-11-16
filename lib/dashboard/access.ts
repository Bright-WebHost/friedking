/** Dashboard sections and which roles can open them (same split as Oceana's admin / manager / waiter). */
export type StaffRole = 'owner' | 'manager' | 'staff'

export type SectionKey =
  | 'pos' | 'orders' | 'tables' | 'chat' | 'menu' | 'stock' | 'pnl' | 'riders'
  | 'analytics' | 'ai' | 'contacts' | 'loyalty' | 'blast' | 'settings'

export const SECTIONS: Array<{ key: SectionKey; label: string; icon: string; roles: StaffRole[] }> = [
  { key: 'pos', label: 'POS', icon: '🛒', roles: ['owner', 'manager', 'staff'] },
  { key: 'orders', label: 'Floor & Orders', icon: '🧾', roles: ['owner', 'manager', 'staff'] },
  { key: 'chat', label: 'Live Chat', icon: '💬', roles: ['owner', 'manager'] },
  { key: 'menu', label: 'Menu', icon: '📋', roles: ['owner', 'manager'] },
  { key: 'stock', label: 'Stock', icon: '📦', roles: ['owner', 'manager'] },
  { key: 'pnl', label: 'P&L', icon: '💰', roles: ['owner', 'manager'] },
  { key: 'riders', label: 'Riders', icon: '🛵', roles: ['owner', 'manager'] },
  { key: 'analytics', label: 'Analytics', icon: '📊', roles: ['owner', 'manager'] },
  { key: 'ai', label: 'AI Assistant', icon: '🤖', roles: ['owner', 'manager'] },
  { key: 'contacts', label: 'Contacts', icon: '👥', roles: ['owner'] },
  { key: 'loyalty', label: 'Loyalty', icon: '🎁', roles: ['owner', 'manager'] },
  { key: 'blast', label: 'Blast', icon: '📣', roles: ['owner'] },
  { key: 'settings', label: 'Settings', icon: '⚙️', roles: ['owner'] },
]

export function canSee(role: StaffRole, section: string): boolean {
  const s = SECTIONS.find((x) => x.key === section)
  return !!s && s.roles.includes(role)
}

/** Owners and managers: money, undo, discounts. */
export const isBoss = (role: StaffRole) => role === 'owner' || role === 'manager'

export const ROLE_LABEL: Record<StaffRole, string> = { owner: 'Owner', manager: 'Manager', staff: 'Staff' }
