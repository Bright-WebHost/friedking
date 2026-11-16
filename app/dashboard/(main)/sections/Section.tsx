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
import AI from './AI'

const PAGES: Record<string, () => React.ReactNode> = {
  orders: Orders, tables: Tables, pos: POS, chat: Chat, menu: Menu, stock: Stock, pnl: Pnl,
  riders: Riders, analytics: Analytics, contacts: Contacts, loyalty: Loyalty, blast: Blast, settings: Settings,
  ai: AI,
}

export default function Section({ section }: { section: string }) {
  const { staff } = useDash()
  const Page = PAGES[section]
  if (!Page) return <div className="none">This page does not exist.</div>
  if (!canSee(staff.role, section)) return <div className="none">Your role ({staff.role}) cannot open this page. Ask the owner if you need it.</div>
  return <Page />
}
