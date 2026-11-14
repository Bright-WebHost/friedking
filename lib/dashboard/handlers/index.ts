import type { SectionKey } from '@/lib/dashboard/access'
import type { Ctx } from '@/lib/dashboard/server'
import { ordersHandler } from './orders'
import { posHandler } from './pos'
import { tablesHandler } from './tables'
import { menuHandler } from './menu'
import { stockHandler } from './stock'
import { ridersHandler } from './riders'
import { expensesHandler } from './expenses'
import { contactsHandler } from './contacts'
import { loyaltyHandler } from './loyalty'
import { blastHandler } from './blast'
import { chatHandler } from './chat'
import { settingsHandler } from './settings'
import { metaHandler } from './meta'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Body = Record<string, any>

export interface Handler {
  /** The request is allowed if the signed-in role can open any of these sections. */
  sections: SectionKey[]
  get?: (ctx: Ctx, params: URLSearchParams) => Promise<unknown>
  /** POST { action, ...body }. Multipart forms arrive as a plain object of their fields (files included). */
  actions?: Record<string, (ctx: Ctx, body: Body) => Promise<unknown>>
}

export const HANDLERS: Record<string, Handler> = {
  meta: metaHandler,
  orders: ordersHandler,
  pos: posHandler,
  tables: tablesHandler,
  menu: menuHandler,
  stock: stockHandler,
  riders: ridersHandler,
  expenses: expensesHandler,
  contacts: contactsHandler,
  loyalty: loyaltyHandler,
  blast: blastHandler,
  chat: chatHandler,
  settings: settingsHandler,
}
