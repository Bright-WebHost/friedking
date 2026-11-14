'use client'

import { canSee } from '@/lib/dashboard/access'
import { useDash } from '../kit'
import Orders from './Orders'
import Tables from './Tables'
import POS from './POS'
import Chat from './Chat'
import Menu from './Menu'
import Stock from './Stock'
import Pnl from './Pnl'
import Riders from './Riders'
import Analytics from './Analytics'
import Contacts from './Contacts'
import Loyalty from './Loyalty'
import Blast from './Blast'
import Settings from './Settings'

const PAGES: Record<string, () => React.ReactNode> = {
  orders: Orders, tables: Tables, pos: POS, chat: Chat, menu: Menu, stock: Stock, pnl: Pnl,
  riders: Riders, analytics: Analytics, contacts: Contacts, loyalty: Loyalty, blast: Blast, settings: Settings,
  ai: AiLater,
}

export default function Section({ section }: { section: string }) {
  const { staff } = useDash()
  const Page = PAGES[section]
  if (!Page) return <div className="none">This page does not exist.</div>
  if (!canSee(staff.role, section)) return <div className="none">Your role ({staff.role}) cannot open this page. Ask the owner if you need it.</div>
  return <Page />
}

function AiLater() {
  return (
    <div className="anacard" style={{ alignItems: 'center', textAlign: 'center', padding: 40 }}>
      <div style={{ fontSize: 40 }}>🤖</div>
      <h4 style={{ justifyContent: 'center', fontSize: 20 }}>AI Assistant is coming next</h4>
      <p style={{ color: 'var(--muted)', maxWidth: 460, margin: '0 auto', lineHeight: 1.6 }}>
        Ask about today&apos;s sales, stock and open tables, or tell it what you restocked, by text or voice.
        It will be connected once the AI provider is chosen. Every other page already works.
      </p>
    </div>
  )
}
