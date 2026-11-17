'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import {
  AlertCircle, Bike, Check, ChevronDown, ChevronLeft, ChevronRight, Clock, Loader2,
  Home, MapPin, Minus, Plus, Search, ShoppingBag, SlidersHorizontal, Store, User, Utensils, X,
} from 'lucide-react'
import VerifyCard, { type VerifyState } from '@/components/VerifyCard'
import AccountPanel, { type Account } from '@/components/AccountPanel'
import AddressSheet from '@/components/AddressSheet'
import TableTab, { type TableInfo } from '@/components/TableTab'
import { Celebration, FreeDeliveryProgress } from '@/components/FreeDelivery'
import { joinAddress, parseAddress, type DeliveryAddress } from '@/lib/address'
import { deliveryFeeFor, type DeliveryRules } from '@/lib/delivery'
import { optimizeImageUrl } from '@/lib/image'
import type {
  Branch, CartItem, MenuCategory, MenuItem, OrderType, PaymentMethod, PlaceOrderPayload, PlacedOrder,
} from '@/lib/types'
import { calcTotals, formatPrice, formatTime, normalizePhone } from '@/lib/utils'

type Screen = 'branches' | 'menu' | 'checkout' | 'confirmed' | 'table'
type DietFilter = 'all' | 'veg' | 'nonveg'
type Promotion = {
  id: string
  title: string
  description: string | null
  image_url: string | null
}

const cartKey = (slug: string) => `fk-cart-${slug}`

/**
 * The site currently serves only the Pandeshwar franchise: it opens straight into this branch's menu
 * and hides the branch picker. Set to null when other branches go live to bring the picker back.
 */
const ONLY_BRANCH: string | null = 'pandeshwar'
const RECOMMENDED_ITEM_IDS = [
  'd0000000-0000-0000-0000-000000000019', // King's Zinger Burger
  'd0000000-0000-0000-0000-000000000023', // King's Double Decker Burger
  'd0000000-0000-0000-0000-000000000041', // Single Strip
  'd0000000-0000-0000-0000-000000000045', // French Fries - Medium
  'd0000000-0000-0000-0000-000000000049', // Chick Pop - Medium
  'd0000000-0000-0000-0000-000000000005', // Lunch Meal
]

/** "Fried King Pandeshwar" -> "Pandeshwar" (the brand is already on screen). */
const shortName = (name?: string | null) => (name ?? '').replace(/^fried king\s*/i, '') || name || ''

/** Parse a JSON response without crashing on an empty or non-JSON body (e.g. a server error page). */
async function readJson(res: Response) {
  try {
    return await res.json()
  } catch {
    return {}
  }
}

export default function CustomerPage() {
  const [screen, setScreen] = useState<Screen>('branches')
  const [ready, setReady] = useState(false)

  // Data
  const [branches, setBranches] = useState<Branch[] | null>(null)
  const [branch, setBranch] = useState<Branch | null>(null)
  const [categories, setCategories] = useState<MenuCategory[]>([])
  const [items, setItems] = useState<MenuItem[]>([])
  const [promotions, setPromotions] = useState<Promotion[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)

  // Menu UI
  const [diet, setDiet] = useState<DietFilter>('all')
  const [query, setQuery] = useState('')
  const [categoryMenuOpen, setCategoryMenuOpen] = useState(false)
  const [selectedCategoryId, setSelectedCategoryId] = useState<string | null>(null)
  const [cart, setCart] = useState<CartItem[]>([])
  const [cartOpen, setCartOpen] = useState(false)
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null)

  // Checkout
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [orderType, setOrderType] = useState<OrderType>('pickup')
  const [addr, setAddr] = useState<DeliveryAddress | null>(null)
  const [addrOpen, setAddrOpen] = useState(false)
  const [addrDraft, setAddrDraft] = useState<Partial<DeliveryAddress> | null>(null)
  // Asked once when the customer opens the menu: delivery or takeaway (skipped for a table QR).
  const [orderChosen, setOrderChosen] = useState(false)
  const [rules, setRules] = useState<DeliveryRules | null>(null)
  const [celebrate, setCelebrate] = useState(false)
  // Dine-in: ?table=3 (table QR) or a WhatsApp link from a customer who has an open table.
  const [tableNo, setTableNo] = useState<number | null>(null)
  const [tableInfo, setTableInfo] = useState<TableInfo | null>(null)
  const tabShown = useRef(false)
  const payment: PaymentMethod = 'cash'
  const [notes, setNotes] = useState('')
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [placed, setPlaced] = useState<PlacedOrder | null>(null)
  const idempotencyKey = useRef<string>('')
  // Set when the page was opened from the WhatsApp bot's link: name and number come from WhatsApp and are locked.
  const [linkToken, setLinkToken] = useState<string | null>(null)
  const [linked, setLinked] = useState<{ name: string; phoneMasked: string } | null>(null)
  const whatsappLinkContext = linkToken !== null || (typeof window !== 'undefined' && /^[0-9a-f]{32}$/.test(new URLSearchParams(window.location.search).get('t') ?? ''))
  // External website orders use OTP when enabled; table orders use the table contact instead.
  const [vs, setVs] = useState<VerifyState>({ enabled: false, secret: '', verified: false })
  const [vsLoaded, setVsLoaded] = useState(false)
  const [verifyKey, setVerifyKey] = useState(0)
  // Logged-in customer profile (cookie), saved addresses and past orders.
  const [account, setAccount] = useState<Account>({ loggedIn: false })
  const [accountOpen, setAccountOpen] = useState(false)
  const [saveAddr, setSaveAddr] = useState(true)
  const loadAccount = useCallback(async () => {
    try {
      const d = await readJson(await fetch('/api/account/me', { cache: 'no-store' }))
      setAccount(d.loggedIn ? d : { loggedIn: false })
    } catch { /* stay logged out */ }
  }, [])
  useEffect(() => { void loadAccount() }, [loadAccount])
  useEffect(() => { if (account.loggedIn && account.name) setName((n) => n || account.name!) }, [account])

  // ── Load a branch menu ────────────────────────────────────────────────────
  const loadMenu = useCallback(async (slug: string) => {
    setLoading(true)
    setLoadError(null)
    setScreen('menu')
    try {
      // Start the offers request together with the menu; it must not hold the menu back.
      const offersRequest = fetch(`/api/promotions?branch=${encodeURIComponent(slug)}`)
        .then(async (r) => { const d = await readJson(r); if (!r.ok) throw new Error(d.message ?? 'Unable to load offers'); return d })
        .then((d) => setPromotions(Array.isArray(d.promotions) ? d.promotions : []))
        .catch((error) => { console.error('[CustomerPage] offers:', error instanceof Error ? error.message : error); setPromotions([]) })
      const res = await fetch(`/api/menu?branch=${encodeURIComponent(slug)}`)
      const data = await readJson(res)
      if (!res.ok) throw new Error(data.message ?? 'Unable to load menu')
      setBranch(data.branch)
      setCategories(data.categories)
      setItems(data.items)
      void offersRequest

      // Restore a saved cart, dropping anything no longer on the menu and refreshing prices.
      let restored: CartItem[] = []
      try {
        const saved: Array<{ id: string; q: number }> = JSON.parse(localStorage.getItem(cartKey(slug)) ?? '[]')
        const byId = new Map<string, MenuItem>(data.items.map((i: MenuItem) => [i.id, i]))
        restored = saved.flatMap((s) => {
          const item = byId.get(s.id)
          return item && s.q > 0 ? [{ item, quantity: s.q }] : []
        })
      } catch { /* storage unavailable */ }
      setCart(restored)
      void fetch(`/api/rules?branch=${encodeURIComponent(slug)}`, { cache: 'no-store' })
        .then(readJson).then((d) => { if (d.rules) setRules(d.rules) }).catch(() => undefined)
      try {
        const last = JSON.parse(localStorage.getItem('fk-addr') ?? 'null')
        if (last && typeof last.text === 'string' && (!last.pincode || /^\d{6}$/.test(last.pincode))) setAddr(last)
      } catch { /* storage unavailable */ }
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Unable to load menu')
    } finally {
      setLoading(false)
    }
  }, [])

  const loadBranches = useCallback(async () => {
    setLoadError(null)
    try {
      const res = await fetch('/api/branches', { cache: 'no-store' })
      const data = await readJson(res)
      if (!res.ok) throw new Error(data.message ?? 'Unable to load branches')
      setBranches(data.branches)
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : 'Unable to load branches')
    }
  }, [])

  // ── First load: read ?branch= and ?phone= (the WhatsApp bot link carries both) ──
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    // The n8n WhatsApp buttons send the number as ?ph=; older links use ?phone=.
    const p = normalizePhone(params.get('phone') ?? params.get('ph') ?? '')
    if (p) setPhone(p.slice(3))
    const token = params.get('t')?.trim() ?? ''
    if (/^[0-9a-f]{32}$/.test(token)) {
      params.delete('t')
      params.delete('ph')
      params.delete('phone')
      const cleanQuery = params.toString()
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${cleanQuery ? `?${cleanQuery}` : ''}${window.location.hash}`)
      fetch(`/api/link?t=${token}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((d) => {
          if (!d.linked) return
          setLinkToken(token)
          setLinked({ name: d.name ?? '', phoneMasked: d.phoneMasked })
          if (d.name) setName(d.name)
          if (Number.isInteger(d.table) && d.table > 0) { setTableNo(d.table); setOrderType('dine-in'); setOrderChosen(true) }
        })
        .catch(() => undefined)
    }
    const tp = Number(params.get('table'))
    if (Number.isInteger(tp) && tp > 0 && tp < 1000) { setTableNo(tp); setOrderType('dine-in'); setOrderChosen(true) }
    const slug = ONLY_BRANCH ?? params.get('branch')?.trim().toLowerCase()
    if (slug) loadMenu(slug)
    else loadBranches()
    setReady(true)
  }, [loadMenu, loadBranches])

  // Persist cart per branch
  useEffect(() => {
    if (!branch) return
    try {
      localStorage.setItem(cartKey(branch.slug), JSON.stringify(cart.map((c) => ({ id: c.item.id, q: c.quantity }))))
    } catch { /* storage unavailable */ }
  }, [cart, branch])

  // ── Cart ──────────────────────────────────────────────────────────────────
  const qtyOf = (id: string) => cart.find((c) => c.item.id === id)?.quantity ?? 0

  const changeQty = (item: MenuItem, delta: number) => {
    setCart((prev) => {
      const existing = prev.find((c) => c.item.id === item.id)
      if (!existing) return delta > 0 ? [...prev, { item, quantity: delta, specialNote: '' }] : prev
      const next = existing.quantity + delta
      if (next <= 0) return prev.filter((c) => c.item.id !== item.id)
      if (next > 50) return prev
      return prev.map((c) => (c.item.id === item.id ? { ...c, quantity: next } : c))
    })
  }

  const changeSpecialNote = (id: string, note: string) => {
    setCart((prev) => prev.map((line) => (
      line.item.id === id ? { ...line, specialNote: note.slice(0, 300) } : line
    )))
  }

  const cartCount = cart.reduce((s, c) => s + c.quantity, 0)
  const totals = useMemo(
    () => calcTotals(cart.map((c) => ({ pricePaise: c.item.pricePaise, quantity: c.quantity }))),
    [cart]
  )

  useEffect(() => { if (cartCount === 0) setCartOpen(false) }, [cartCount])

  // ── Dine-in table tab: poll the open tab so the diner sees each round move through the kitchen ──
  const loadTab = useCallback(async () => {
    if (!branch || !tableNo) return
    try {
      const d = await readJson(await fetch(`/api/table?branch=${encodeURIComponent(branch.slug)}&table=${tableNo}`, { cache: 'no-store' }))
      if (d.exists === false) {
        // Unknown table number: fall back to the normal delivery / takeaway flow.
        setTableNo(null); setTableInfo(null); setOrderType('pickup'); setOrderChosen(false); setScreen((sc) => (sc === 'table' ? 'menu' : sc))
        return
      }
      if (typeof d.open === 'boolean') {
        setTableInfo(d)
        if (d.open && d.rounds.length > 0 && !tabShown.current) { tabShown.current = true; setScreen((sc) => (sc === 'menu' ? 'table' : sc)) }
      }
    } catch { /* keep the last tab on a network blip */ }
  }, [branch, tableNo])
  useEffect(() => {
    if (!tableNo || !branch) return
    void loadTab()
    const t = window.setInterval(() => { if (document.visibilityState === 'visible') void loadTab() }, 10000)
    return () => window.clearInterval(t)
  }, [tableNo, branch, loadTab])

  // ── Delivery fee and the free-delivery offer (rules come from Dashboard > Settings) ──
  const isDelivery = orderType === 'delivery'
  const deliveryFeePaise = isDelivery && rules ? deliveryFeeFor(rules, totals.subtotalPaise) : 0
  const grandTotalPaise = totals.totalPaise + deliveryFeePaise
  const offerPaise = isDelivery && rules && rules.freeAbovePaise > 0 ? rules.freeAbovePaise : 0
  const unlocked = offerPaise > 0 && cartCount > 0 && totals.subtotalPaise >= offerPaise
  const wasUnlocked = useRef(false)
  useEffect(() => {
    if (unlocked && !wasUnlocked.current) setCelebrate(true)
    wasUnlocked.current = unlocked
  }, [unlocked])
  const minOrderShort = isDelivery && rules && rules.minOrderPaise > totals.subtotalPaise ? rules.minOrderPaise - totals.subtotalPaise : 0
  const pincodeOk = !isDelivery || !addr || !addr.pincode || !rules?.pincodes.length || rules.pincodes.some((p) => p.pincode === addr.pincode)

  // ── Menu filtering, grouped by category ───────────────────────────────────
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase()
    const visible = items.filter(
      (i) =>
        (diet === 'all' || (diet === 'veg' ? i.isVeg : !i.isVeg)) &&
        (!q || i.name.toLowerCase().includes(q))
    )
    return categories
      .map((c) => ({ category: c, items: visible.filter((i) => i.categoryId === c.id) }))
      .filter((s) => s.items.length > 0)
  }, [items, categories, diet, query])

  const visibleCount = sections.reduce((s, x) => s + x.items.length, 0)
  const recommendedItems = useMemo(() => {
    const byId = new Map(items.map((item) => [item.id, item]))
    return RECOMMENDED_ITEM_IDS.flatMap((id) => {
      const item = byId.get(id)
      return item ? [item] : []
    })
  }, [items])
  const drinkAddOns = useMemo(() => {
    const drinkCategoryIds = new Set(categories.filter((category) => category.name.trim().toLowerCase() === 'mojitos').map((category) => category.id))
    return items.filter((item) => drinkCategoryIds.has(item.categoryId))
  }, [items, categories])

  const jumpTo = (categoryId: string) => {
    setCategoryMenuOpen(false)
    setSelectedCategoryId(categoryId)
    document.getElementById(`cat-${categoryId}`)?.scrollIntoView({ block: 'start' })
  }

  const changeBranch = () => {
    window.history.replaceState(null, '', window.location.pathname)
    setBranch(null); setItems([]); setCategories([]); setCart([])
    setScreen('branches')
    if (!branches) loadBranches()
  }

  // ── Checkout ──────────────────────────────────────────────────────────────
  const goToCheckout = () => {
    idempotencyKey.current = crypto.randomUUID()
    setFormError(null)
    setCartOpen(false)
    setScreen('checkout')
    window.scrollTo(0, 0)
  }

  const placeOrder = async () => {
    if (!branch || submitting) return
    const dineIn = tableNo !== null
    const needVerify = vs.enabled && !dineIn && !linked
    const needPhoneField = dineIn ? !linked && !tableInfo?.hasContact : !linked && !needVerify
    const e164 = needPhoneField ? normalizePhone(phone) : ''
    if (!name.trim()) return setFormError('Please enter your name.')
    if (needVerify && !vs.verified) return setFormError('Please verify the OTP sent to your WhatsApp first.')
    if (needPhoneField && !e164) return setFormError('Please enter a valid 10-digit mobile number.')
    if (orderType === 'delivery' && !addr) return setFormError('Please add your delivery address.')
    if (orderType === 'delivery' && !pincodeOk) return setFormError(`Sorry, we do not deliver to ${addr?.pincode} yet.`)
    if (minOrderShort > 0) return setFormError(`Add ${formatPrice(minOrderShort)} more to reach the minimum delivery order.`)

    setFormError(null)
    setSubmitting(true)
    try {
      const payload: PlaceOrderPayload = {
        branchSlug: branch.slug,
        customerName: name.trim(),
        customerPhone: e164 ?? '',
        linkToken: linked ? linkToken : null,
        verifySecret: needVerify ? vs.secret : null,
        orderType: dineIn ? 'dine-in' : orderType,
        tableNumber: dineIn ? tableNo : null,
        deliveryAddress: orderType === 'delivery' && addr ? addr.text : null,
        deliveryPincode: orderType === 'delivery' && addr ? addr.pincode : null,
        paymentMethod: payment,
        specialInstructions: notes.trim() || null,
        idempotencyKey: idempotencyKey.current,
        items: cart.map((c) => ({ itemId: c.item.id, quantity: c.quantity, note: c.specialNote?.trim() || undefined })),
      }
      const res = await fetch('/api/order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await readJson(res)
      if (!res.ok) throw new Error(data.message ?? 'Could not place your order.')
      setPlaced(data)
      if (orderType === 'delivery' && addr) { try { localStorage.setItem('fk-addr', JSON.stringify(addr)) } catch { /* storage unavailable */ } }
      setVerifyKey((k) => k + 1)
      setVs({ enabled: vs.enabled, secret: '', verified: false })
      if (account.loggedIn && saveAddr && orderType === 'delivery' && addr) {
        void fetch('/api/account/addresses', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'add', address: joinAddress(addr), label: addr.label }) }).then(loadAccount)
      } else if (account.loggedIn) void loadAccount()
      setCart([])
      setNotes('')
      if (dineIn) {
        // Dine-in: back to the table tab, where the diner can follow this round and add more.
        tabShown.current = true
        setScreen('table')
        void loadTab()
      } else setScreen('confirmed')
      window.scrollTo(0, 0)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not place your order.')
    } finally {
      setSubmitting(false)
    }
  }

  const addressCards = (() => {
    const saved = (account.addresses ?? []).map((a) => ({ key: a.id, ...parseAddress(a.address, a.label ?? '') }))
    const extra = addr && !saved.some((c) => c.text === addr.text && c.pincode === addr.pincode) ? [{ key: 'current', ...addr }] : []
    return [...extra, ...saved]
  })()

  if (!ready) return null

  // ══ BRANCH PICKER ═════════════════════════════════════════════════════════
  if (screen === 'branches') {
    return (
      <main className="flex min-h-dvh items-center justify-center p-4">
        <div className="w-full max-w-md overflow-hidden rounded-[24px] border border-fk-line bg-white shadow-xl shadow-black/5">
          <div className="bg-fk-red px-6 pb-7 pt-9 text-center text-white">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-white.png" alt="Fried King" className="mx-auto h-24 w-auto" />
            <p className="mt-4 font-display text-xl font-bold uppercase tracking-wide">
              Growing the <span className="text-fk-yellow">crispiest</span> bites
            </p>
          </div>
          <div className="fk-checker" />

          <div className="p-6">
            <h1 className="text-center font-display text-[26px] font-extrabold uppercase leading-tight">Choose your branch</h1>
            <p className="mt-1 text-center text-sm text-fk-muted">Pickup or delivery in Mangaluru</p>

            <div className="mt-6 flex flex-col gap-3">
              {branches === null && !loadError && <Spinner label="Loading branches" />}
              {loadError && <ErrorBox message={loadError} onRetry={loadBranches} />}
              {branches?.length === 0 && <p className="text-center text-sm text-fk-muted">No branches are open for online orders yet.</p>}
              {branches?.map((b) => (
                <button
                  key={b.id}
                  onClick={() => {
                    window.history.replaceState(null, '', `?branch=${b.slug}`)
                    loadMenu(b.slug)
                  }}
                  className="group flex w-full items-center gap-4 rounded-2xl border border-fk-line bg-white p-4 text-left transition hover:border-fk-red hover:shadow-md"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-fk-tint text-fk-red transition group-hover:bg-fk-red group-hover:text-white">
                    <Store className="h-6 w-6" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[17px] font-bold">{shortName(b.name)}</span>
                    {b.address && (
                      <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-fk-muted">
                        <MapPin className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{b.address}</span>
                      </span>
                    )}
                    {b.opensAt && b.closesAt && (
                      <span className="mt-0.5 flex items-center gap-1.5 text-[13px] text-fk-muted">
                        <Clock className="h-3.5 w-3.5 shrink-0" /> {formatTime(b.opensAt)} to {formatTime(b.closesAt)}
                      </span>
                    )}
                  </span>
                  <ChevronRight className="h-5 w-5 shrink-0 text-fk-line transition group-hover:text-fk-red" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </main>
    )
  }

  // ══ TABLE TAB (dine-in) ═══════════════════════════════════════════════════
  if (screen === 'table' && tableNo !== null) {
    return (
      <TableTab
        table={tableNo}
        info={tableInfo}
        branchName={shortName(branch?.name)}
        whatsapp={rules?.whatsapp}
        onAddMore={() => setScreen('menu')}
        onNewTab={() => {
          window.history.replaceState(null, '', window.location.pathname)
          tabShown.current = false
          setTableNo(null); setTableInfo(null); setOrderType('pickup'); setOrderChosen(false); setScreen('menu')
        }}
      />
    )
  }

  // ══ CONFIRMED ═════════════════════════════════════════════════════════════
  if (screen === 'confirmed' && placed) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-4">
        <div className="w-full max-w-md overflow-hidden rounded-[24px] border border-fk-line bg-white text-center shadow-xl shadow-black/5">
          <div className="bg-fk-red px-6 pb-7 pt-9 text-white">
            <motion.div
              initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ type: 'spring', damping: 14 }}
              className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-white text-fk-red shadow-lg"
            >
              <Check className="h-9 w-9" strokeWidth={3} />
            </motion.div>
            <h1 className="mt-4 font-display text-3xl font-extrabold uppercase">Order received</h1>
            <p className="mt-1 text-sm text-white/85">Fried King · {shortName(branch?.name)}</p>
          </div>
          <div className="fk-checker" />

          <div className="p-6">
            <p className="text-xs font-semibold uppercase tracking-widest text-fk-muted">Order number</p>
            <p className="mt-1 font-display text-5xl font-extrabold text-fk-red">#{placed.orderNumber}</p>
            <p className="mt-4 inline-flex flex-wrap justify-center gap-x-2 rounded-full bg-fk-bg px-4 py-1.5 text-sm font-medium">
              <span>{formatPrice(placed.totalPaise)}</span>·
              <span>Cash</span>·
              <span>{orderType === 'pickup' ? 'Takeaway' : 'Delivery'}</span>
            </p>
            <p className="mt-4 text-sm text-fk-muted">The branch will confirm your order shortly.</p>
            <a
              href={`https://wa.me/${rules?.whatsapp ?? '919742175222'}`}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-[14px] bg-[#25d366] py-4 font-bold text-white transition hover:brightness-95"
            >
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="currentColor" aria-hidden><path d="M12.04 2a9.9 9.9 0 0 0-8.47 15.04L2 22l5.1-1.34A9.9 9.9 0 1 0 12.04 2Zm5.8 14.1c-.25.7-1.43 1.34-1.98 1.4-.5.06-1.12.09-1.8-.12a16 16 0 0 1-1.63-.6c-2.87-1.24-4.74-4.13-4.88-4.32-.14-.19-1.17-1.56-1.17-2.97s.74-2.1 1-2.39c.27-.29.58-.36.77-.36h.55c.18 0 .42-.07.65.5.25.58.83 2 .9 2.15.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.17-.3.38-.43.5-.14.14-.29.3-.12.58.16.29.72 1.2 1.56 1.94 1.07.95 1.98 1.25 2.26 1.39.29.14.45.12.62-.07.17-.19.72-.84.91-1.13.19-.29.38-.24.65-.14.26.1 1.67.79 1.96.93.29.14.48.22.55.34.07.12.07.7-.18 1.4Z" /></svg>
              Back to WhatsApp
            </a>
            <button
              onClick={() => { setPlaced(null); setScreen('menu') }}
              className="mt-3 w-full rounded-[14px] border border-fk-line py-3.5 font-bold text-fk-ink transition hover:bg-fk-bg"
            >
              Back to menu
            </button>
          </div>
        </div>
      </main>
    )
  }

  // ══ CHECKOUT ══════════════════════════════════════════════════════════════
  if (screen === 'checkout') {
    const input =
      'w-full rounded-xl border border-fk-line bg-white px-4 py-3.5 text-base sm:text-sm placeholder:text-fk-muted/70 outline-none transition focus:border-fk-red focus:ring-1 focus:ring-fk-red'
    return (
      <main className="min-h-dvh pb-10">
        <header className="sticky top-0 z-20 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          <div className="mx-auto flex h-16 max-w-xl items-center gap-2 px-3">
            <button onClick={() => setScreen('menu')} aria-label="Back to menu" className="flex h-10 w-10 items-center justify-center rounded-full active:bg-fk-bg">
              <ChevronLeft className="h-6 w-6" strokeWidth={2.5} />
            </button>
            <div>
              <h1 className="font-display text-xl font-extrabold uppercase leading-none">Checkout</h1>
              <p className="mt-0.5 text-xs text-fk-muted">Fried King · {shortName(branch?.name)}</p>
            </div>
          </div>
          <div className="fk-checker-sm" />
        </header>

        <div className="mx-auto max-w-xl space-y-4 px-4 pt-4">
          {tableNo !== null ? (
            <div className="flex items-center gap-3 rounded-2xl border border-fk-red/30 bg-fk-tint px-4 py-3">
              <Utensils className="h-5 w-5 shrink-0 text-fk-red" />
              <div><p className="text-sm font-extrabold">Dine-in · Table {tableNo}</p><p className="text-xs text-fk-muted">Your order goes straight to the kitchen. No OTP needed.</p></div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-1 rounded-2xl bg-white p-1 shadow-sm ring-1 ring-fk-line" role="group" aria-label="Order type">
              {(!rules || rules.pickup) && (
                <button type="button" onClick={() => setOrderType('pickup')} aria-pressed={orderType === 'pickup'}
                  className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition ${orderType === 'pickup' ? 'bg-fk-red text-white shadow' : 'text-fk-muted'}`}>
                  <Store className="h-4 w-4" /> Takeaway
                </button>
              )}
              {(!rules || rules.delivery) && (
                <button type="button" onClick={() => setOrderType('delivery')} aria-pressed={orderType === 'delivery'}
                  className={`flex items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-bold transition ${orderType === 'delivery' ? 'bg-fk-red text-white shadow' : 'text-fk-muted'}`}>
                  <Bike className="h-4 w-4" /> Delivery
                </button>
              )}
            </div>
          )}

          <Card title="Your details">
            <div className="space-y-3">
              {linked ? (
                <div className="flex items-center gap-3 rounded-xl border border-green-200 bg-green-50 px-4 py-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[#25d366] text-white">
                    <svg viewBox="0 0 24 24" className="h-6 w-6" fill="currentColor" aria-hidden><path d="M12.04 2a9.9 9.9 0 0 0-8.47 15.04L2 22l5.1-1.34A9.9 9.9 0 1 0 12.04 2Zm5.8 14.1c-.25.7-1.43 1.34-1.98 1.4-.5.06-1.12.09-1.8-.12a16 16 0 0 1-1.63-.6c-2.87-1.24-4.74-4.13-4.88-4.32-.14-.19-1.17-1.56-1.17-2.97s.74-2.1 1-2.39c.27-.29.58-.36.77-.36h.55c.18 0 .42-.07.65.5.25.58.83 2 .9 2.15.07.14.12.31.02.5-.09.19-.14.31-.28.48-.14.17-.3.38-.43.5-.14.14-.29.3-.12.58.16.29.72 1.2 1.56 1.94 1.07.95 1.98 1.25 2.26 1.39.29.14.45.12.62-.07.17-.19.72-.84.91-1.13.19-.29.38-.24.65-.14.26.1 1.67.79 1.96.93.29.14.48.22.55.34.07.12.07.7-.18 1.4Z" /></svg>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-bold text-green-900">Linked to your WhatsApp</p>
                    <p className="truncate text-sm text-green-800">{linked.name ? `${linked.name} · ` : ''}{linked.phoneMasked}</p>
                  </div>
                  <Check className="h-5 w-5 shrink-0 text-green-700" strokeWidth={3} />
                </div>
              ) : null}
              {(!linked || !linked.name) && (
                <input className={input} placeholder="Name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} />
              )}
              {!linked && tableNo === null && !whatsappLinkContext && <VerifyCard key={verifyKey} linkToken={null} useSession={account.loggedIn} fixedMasked={account.loggedIn ? account.phoneMasked : null} onChange={(v) => { setVs(v); setVsLoaded(true) }} />}
              {!linked && tableNo === null && !whatsappLinkContext && vsLoaded && !vs.enabled && <div className="flex items-center rounded-xl border border-fk-line bg-white transition focus-within:border-fk-red focus-within:ring-1 focus-within:ring-fk-red">
                <span className="pl-4 text-base font-medium text-fk-muted sm:text-sm">+91</span>
                <input
                  className="w-full bg-transparent px-3 py-3.5 text-base outline-none placeholder:text-fk-muted/70 sm:text-sm"
                  placeholder="10-digit mobile number"
                  inputMode="numeric"
                  autoComplete="tel-national"
                  maxLength={10}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))}
                />
              </div>}
              {orderType === 'dine-in' && !linked && !tableInfo?.hasContact && (
                <div className="space-y-1.5">
                  <div className="flex items-center rounded-xl border border-fk-line bg-white transition focus-within:border-fk-red focus-within:ring-1 focus-within:ring-fk-red">
                    <span className="pl-4 text-base font-medium text-fk-muted sm:text-sm">+91</span>
                    <input className="w-full bg-transparent px-3 py-3.5 text-base outline-none placeholder:text-fk-muted/70 sm:text-sm" placeholder="WhatsApp number" inputMode="numeric" autoComplete="tel-national" maxLength={10}
                      value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 10))} />
                  </div>
                  <p className="text-xs text-fk-muted">Your final bill is sent to this WhatsApp number after the table is closed.</p>
                </div>
              )}
              {orderType === 'delivery' && (
                <>
                  <p className="text-xs font-bold uppercase tracking-wide text-fk-muted">Deliver to</p>
                  {addressCards.map((c) => {
                    const selected = !!addr && addr.text === c.text && addr.pincode === c.pincode
                    const blocked = !!c.pincode && !!rules?.pincodes.length && !rules.pincodes.some((p) => p.pincode === c.pincode)
                    return (
                      <div key={c.key} role="button" tabIndex={0}
                        onClick={() => { if (!c.pincode) { setAddrDraft(c); setAddrOpen(true) } else setAddr({ label: c.label, text: c.text, pincode: c.pincode }) }}
                        onKeyDown={(e) => { if (e.key === 'Enter') (e.currentTarget as HTMLElement).click() }}
                        className={`flex cursor-pointer items-start gap-3 rounded-2xl border-2 p-3.5 transition ${selected ? 'border-green-600 bg-green-50/40' : 'border-fk-line bg-white'} ${blocked ? 'opacity-60' : ''}`}>
                        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-fk-tint text-fk-red">{c.label === 'Home' ? <Home className="h-4 w-4" /> : c.label === 'Work' ? <Store className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm font-extrabold">{c.label || 'Address'}{selected && <Check className="ml-1.5 inline h-4 w-4 text-green-600" strokeWidth={3} />}</span>
                          <span className="mt-0.5 block text-[13px] leading-snug text-fk-muted">{c.text}{c.pincode ? ` - ${c.pincode}` : ''}</span>
                          {blocked && <span className="mt-1 block text-xs font-semibold text-red-600">We do not deliver to this pincode yet</span>}
                        </span>
                        {selected && <button type="button" onClick={(e) => { e.stopPropagation(); setAddrDraft(c); setAddrOpen(true) }} className="shrink-0 text-xs font-bold text-fk-red">Edit</button>}
                      </div>
                    )
                  })}
                  <button type="button" onClick={() => { setAddrDraft(null); setAddrOpen(true) }}
                    className="flex w-full items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-[#ffc9ce] p-3.5 text-sm font-bold text-fk-red transition hover:bg-fk-tint">
                    <Plus className="h-4 w-4" strokeWidth={3} /> {addressCards.length ? 'Add a new address' : 'Add delivery address'}
                  </button>
                  {account.loggedIn && (
                    <label className="flex items-center gap-2 text-sm text-fk-muted">
                      <input type="checkbox" checked={saveAddr} onChange={(e) => setSaveAddr(e.target.checked)} /> Save this address to my profile
                    </label>
                  )}
                </>
              )}
            </div>
          </Card>

          {drinkAddOns.length > 0 && (
            <Card title="Add a drink">
              <p className="mb-3 text-xs font-medium text-fk-muted">Complete your meal with a refreshing Mojito.</p>
              <div className="space-y-2.5">
                {drinkAddOns.map((item) => (
                  <div key={item.id} className="flex items-center gap-3 rounded-xl border border-fk-line bg-white p-2.5">
                    <div className="h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-fk-tint">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={optimizeImageUrl(item.imageUrl, 180) ?? ''} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
                      ) : (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src="/brand/mark-red.png" alt="" className="h-full w-full object-contain p-3 opacity-70" />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold">{item.name}</p>
                      <p className="mt-0.5 text-xs font-semibold text-fk-muted">{formatPrice(item.pricePaise)}</p>
                    </div>
                    <QtyControl qty={qtyOf(item.id)} name={item.name} onChange={(delta) => changeQty(item, delta)} />
                  </div>
                ))}
              </div>
            </Card>
          )}

          <Card title="Notes for the kitchen (optional)">
            <textarea className={`${input} resize-none`} rows={2} maxLength={400} placeholder="Extra spicy, no mayo..." value={notes} onChange={(e) => setNotes(e.target.value)} />
          </Card>

          <Card title="Order summary">
            <ul className="space-y-2.5 text-sm">
              {cart.map((c) => (
                <li key={c.item.id} className="flex items-start justify-between gap-3">
                  <span className="flex items-start gap-2">
                    <span className="mt-0.5"><VegMark veg={c.item.isVeg} /></span>
                    <span>{c.quantity} × {c.item.name}</span>
                  </span>
                  <span className="font-semibold">{formatPrice(c.item.pricePaise * c.quantity)}</span>
                </li>
              ))}
            </ul>
            <TotalsBlock {...totals} totalPaise={grandTotalPaise} deliveryFeePaise={deliveryFeePaise} baseFeePaise={isDelivery ? rules?.feePaise ?? 0 : 0} />
            {offerPaise > 0 && cart.length > 0 && <FreeDeliveryProgress subtotalPaise={totals.subtotalPaise} targetPaise={offerPaise} className="mt-3" />}
            {minOrderShort > 0 && <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[12.5px] font-semibold text-amber-800">Add {formatPrice(minOrderShort)} more to reach the minimum delivery order.</p>}
            <p className="mt-3 flex items-center gap-1.5 text-xs font-medium text-fk-muted"><span aria-hidden>💵</span> Pay by cash {orderType === 'delivery' ? 'on delivery' : orderType === 'dine-in' ? 'at the counter' : 'at the counter'}. GST is added to the subtotal.</p>
          </Card>

          {formError && (
            <p role="alert" className="flex items-start gap-2 rounded-xl border border-red-200 bg-fk-tint px-4 py-3 text-sm font-medium text-fk-red-dark">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" /> {formError}
            </p>
          )}

          <button
            onClick={placeOrder}
            disabled={submitting || cart.length === 0 || minOrderShort > 0}
            className="flex w-full items-center justify-center gap-2 rounded-[14px] bg-fk-red py-4 text-base font-bold text-white shadow-md shadow-red-500/20 transition hover:bg-fk-red-dark disabled:opacity-60"
          >
            {submitting ? (<><Loader2 className="h-4 w-4 animate-spin" /> Placing order</>) : (<>{orderType === 'dine-in' ? 'Send to kitchen' : 'Place order'} · {formatPrice(grandTotalPaise)}</>)}
          </button>
        </div>
        <AnimatePresence>
          {addrOpen && (
            <AddressSheet rules={rules} initial={addrDraft} onClose={() => setAddrOpen(false)}
              onSave={(a) => { setAddr(a); setAddrOpen(false); setFormError(null) }} />
          )}
        </AnimatePresence>
      </main>
    )
  }

  // ══ MENU ══════════════════════════════════════════════════════════════════
  return (
    <div className="min-h-dvh">
      <div className="relative mx-auto min-h-dvh max-w-[768px] bg-white pb-28 shadow-sm">
        {/* Search header */}
        <header className="sticky top-0 z-40 flex h-16 items-center gap-2 bg-white px-3 shadow-[0_2px_10px_rgba(0,0,0,0.04)]">
          {!ONLY_BRANCH && (
            <button onClick={changeBranch} aria-label="Change branch" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full active:bg-fk-bg">
              <ChevronLeft className="h-6 w-6" strokeWidth={2.5} />
            </button>
          )}
          <label className="relative flex-1">
            <span className="sr-only">Search the menu</span>
            <Search className="absolute left-3.5 top-1/2 h-[18px] w-[18px] -translate-y-1/2 text-fk-red" strokeWidth={2.5} />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search in Fried King"
              className="h-11 w-full rounded-full border border-fk-line bg-white pl-10 pr-4 text-base font-medium shadow-sm outline-none placeholder:text-fk-muted/70 focus:border-fk-red/50 sm:text-[15px]"
            />
          </label>
          <button onClick={() => setAccountOpen(true)} aria-label={account.loggedIn ? 'My profile' : 'Log in'}
            className={`flex h-11 shrink-0 items-center justify-center gap-1.5 rounded-full border px-3 text-sm font-bold ${account.loggedIn ? 'border-fk-red bg-fk-red text-white' : 'border-fk-line'}`}>
            <User className="h-[18px] w-[18px]" />
            <span className="hidden sm:inline">{account.loggedIn ? 'Profile' : 'Log in'}</span>
          </button>
        </header>

        {/* Branch banner */}
        <section className="bg-fk-red text-white">
          <div className="flex items-center gap-4 px-4 py-5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-white.png" alt="Fried King" className="h-14 w-auto shrink-0 sm:h-16" />
            <div className="min-w-0 border-l border-white/30 pl-4">
              <p className="font-display text-2xl font-extrabold uppercase leading-none tracking-wide">
                {branch ? shortName(branch.name) : 'Fried King'}
              </p>
              {branch?.address && (
                <p className="mt-1.5 flex items-center gap-1 text-[13px] text-white/85">
                  <MapPin className="h-3.5 w-3.5 shrink-0" /> <span className="truncate">{branch.address}</span>
                </p>
              )}
              {branch?.opensAt && branch?.closesAt && (
                <p className="mt-1 flex items-center gap-1 text-[13px] text-white/85">
                  <Clock className="h-3.5 w-3.5 shrink-0" /> {formatTime(branch.opensAt)} to {formatTime(branch.closesAt)}
                </p>
              )}
              {tableNo !== null ? (
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-bold">Dine-in · Table {tableNo}</span>
                  {tableInfo?.open && tableInfo.rounds.length > 0 && (
                    <button onClick={() => setScreen('table')} className="rounded-full bg-fk-yellow px-3 py-1 text-xs font-extrabold text-fk-ink">My orders ({tableInfo.rounds.length})</button>
                  )}
                </div>
              ) : orderChosen && (
                <button onClick={() => setOrderChosen(false)} className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-white/20 px-3 py-1 text-xs font-bold">
                  {orderType === 'delivery' ? <Bike className="h-3.5 w-3.5" /> : <Store className="h-3.5 w-3.5" />} {orderType === 'delivery' ? 'Delivery' : 'Takeaway'} · Change
                </button>
              )}
              {!ONLY_BRANCH && (
                <button onClick={changeBranch} className="mt-1.5 text-[13px] font-semibold text-fk-yellow underline-offset-2 hover:underline">
                  Change branch
                </button>
              )}
            </div>
          </div>
        </section>
        <div className="fk-checker" />

        {!loading && !loadError && <OfferBanner promotions={promotions} />}

        {/* Category rail */}
        {!loading && !loadError && categories.length > 0 && (
          <nav aria-label="Menu categories" className="no-scrollbar sticky top-16 z-30 flex gap-4 overflow-x-auto border-b border-fk-line bg-white px-4 py-4 shadow-[0_2px_15px_rgba(0,0,0,0.04)]">
            <button
              onClick={() => {
                setSelectedCategoryId(null)
                window.scrollTo({ top: 0, behavior: 'smooth' })
              }}
              className="flex w-[74px] shrink-0 flex-col items-center gap-1.5"
            >
              <span className={`h-16 w-16 overflow-hidden rounded-full bg-fk-tint ${selectedCategoryId === null ? 'border-2 border-fk-red p-0.5' : 'border-2 border-transparent'}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/menu/5-pcs-combo.webp" alt="" className="h-full w-full rounded-full object-cover" />
              </span>
              <span className={`max-w-[74px] truncate text-xs font-bold ${selectedCategoryId === null ? 'text-fk-red' : 'text-fk-muted'}`}>All</span>
            </button>
            {categories.map((category) => {
              const preview = items.find((item) => item.categoryId === category.id)
              const active = selectedCategoryId === category.id
              return (
                <button
                  key={category.id}
                  onClick={() => jumpTo(category.id)}
                  className="flex w-[74px] shrink-0 flex-col items-center gap-1.5"
                >
                  <span className={`h-16 w-16 overflow-hidden rounded-full bg-fk-tint ${active ? 'border-2 border-fk-red p-0.5' : 'border-2 border-transparent'}`}>
                    {preview?.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={optimizeImageUrl(preview.imageUrl, 160) ?? ''} alt="" loading="lazy" decoding="async" className="h-full w-full rounded-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src="/brand/mark-red.png" alt="" className="h-full w-full rounded-full object-contain p-4 opacity-70" />
                    )}
                  </span>
                  <span className={`max-w-[74px] truncate text-xs font-bold ${active ? 'text-fk-red' : 'text-fk-muted'}`}>{category.name}</span>
                </button>
              )
            })}
          </nav>
        )}

        {/* Filters */}
        <nav aria-label="Menu filters" className="no-scrollbar sticky top-[11.375rem] z-20 flex gap-2.5 overflow-x-auto border-b border-fk-line bg-white px-4 py-3 shadow-[0_2px_15px_rgba(0,0,0,0.04)]">
          <button
            onClick={() => setCategoryMenuOpen(true)}
            className="flex shrink-0 items-center gap-1.5 rounded-xl border border-fk-line bg-fk-bg px-3.5 py-2 text-[13px] font-bold transition hover:bg-fk-line/60"
          >
            <SlidersHorizontal className="h-3.5 w-3.5" /> Categories <ChevronDown className="h-3.5 w-3.5" />
          </button>
          <DietChip active={diet === 'veg'} veg onClick={() => setDiet((d) => (d === 'veg' ? 'all' : 'veg'))}>Veg</DietChip>
          <DietChip active={diet === 'nonveg'} veg={false} onClick={() => setDiet((d) => (d === 'nonveg' ? 'all' : 'nonveg'))}>Non-veg</DietChip>
        </nav>

        {loading && <div className="pt-16"><Spinner label="Loading menu" /></div>}
        {loadError && (
          <div className="px-4 pt-10">
            <ErrorBox
              message={loadError}
              onRetry={() => {
                const slug = ONLY_BRANCH ?? new URLSearchParams(window.location.search).get('branch')
                if (slug) loadMenu(slug)
                else { setScreen('branches'); loadBranches() }
              }}
            />
          </div>
        )}

        {!loading && !loadError && sections.length === 0 && (
          <p className="px-4 pt-16 text-center text-sm font-medium text-fk-muted">
            {items.length === 0 ? 'The menu for this branch is not available yet.' : 'No items match your selection.'}
          </p>
        )}

        {!loading && !loadError && recommendedItems.length > 0 && (
          <section className="scroll-mt-[184px] pt-6">
            <h2 className="mb-3 flex items-center gap-2 px-4 font-display text-[22px] font-extrabold uppercase leading-none">
              <span className="h-5 w-1.5 rounded-full bg-fk-yellow" aria-hidden />
              Recommended
            </h2>
            <div className="grid grid-cols-2 gap-3 px-3.5 sm:grid-cols-3">
              {recommendedItems.map((item) => (
                <ProductCard
                  key={`recommended-${item.id}`}
                  item={item}
                  qty={qtyOf(item.id)}
                  specialNote={cart.find((line) => line.item.id === item.id)?.specialNote ?? ''}
                  onChange={(d) => changeQty(item, d)}
                  onNoteChange={changeSpecialNote}
                  onDetails={setSelectedItem}
                />
              ))}
            </div>
          </section>
        )}

        {!loading && !loadError && sections.map(({ category, items: rows }) => (
          <section key={category.id} id={`cat-${category.id}`} className="scroll-mt-[184px] pt-6">
            <h2 className="mb-3 flex items-center gap-2 px-4 font-display text-[22px] font-extrabold uppercase leading-none">
              <span className="h-5 w-1.5 rounded-full bg-fk-red" aria-hidden />
              {category.name}
              <span className="font-sans text-xs font-semibold text-fk-muted">({rows.length})</span>
            </h2>
            <div className="grid grid-cols-1 gap-3 px-3.5">
              {rows.map((item) => (
                <ProductCard
                  key={item.id}
                  item={item}
                  qty={qtyOf(item.id)}
                  specialNote={cart.find((line) => line.item.id === item.id)?.specialNote ?? ''}
                  onChange={(d) => changeQty(item, d)}
                  onNoteChange={changeSpecialNote}
                  onDetails={setSelectedItem}
                  compact
                />
              ))}
            </div>
          </section>
        ))}
      </div>

      {/* Floating categories button */}
      {!loading && sections.length > 1 && (
        <button
          onClick={() => setCategoryMenuOpen(true)}
          aria-label="Browse categories"
          className={`fixed right-[max(1rem,calc(50vw-384px+1rem))] z-40 flex h-14 w-14 flex-col items-center justify-center rounded-full border border-white/10 bg-fk-ink text-white shadow-2xl shadow-black/40 transition-all active:scale-95 ${
            cartCount > 0 ? (offerPaise > 0 ? 'bottom-[158px]' : 'bottom-[100px]') : 'bottom-6'
          }`}
        >
          <Utensils className="mb-0.5 h-[17px] w-[17px] opacity-90" strokeWidth={2.2} />
          <span className="text-[9px] font-black uppercase tracking-wider">Menu</span>
        </button>
      )}

      {/* Floating cart bar */}
      <AnimatePresence>
        {cartCount > 0 && !cartOpen && (
          <motion.div
            initial={{ y: 90 }} animate={{ y: 0 }} exit={{ y: 90 }}
            transition={{ type: 'spring', damping: 24, stiffness: 300 }}
            className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-[768px] bg-white"
          >
            <div className="fk-checker-sm" />
            <div className="px-4 pb-4 pt-3">
              {offerPaise > 0 && <FreeDeliveryProgress subtotalPaise={totals.subtotalPaise} targetPaise={offerPaise} className="mb-2" />}
              <button
                onClick={() => setCartOpen(true)}
                className="flex h-[52px] w-full items-center justify-between rounded-[14px] bg-fk-red px-4 text-white shadow-md shadow-red-500/25 transition-transform active:scale-[0.98]"
              >
                <span className="flex items-center gap-3">
                  <span className="flex h-7 w-7 items-center justify-center rounded bg-white/20">
                    <ShoppingBag className="h-3.5 w-3.5" />
                  </span>
                  <span className="font-semibold">{cartCount} {cartCount === 1 ? 'item' : 'items'} added</span>
                </span>
                <span className="flex items-center gap-1 font-bold">
                  {formatPrice(totals.subtotalPaise)} <ChevronRight className="h-[18px] w-[18px]" />
                </span>
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Categories modal */}
      <AnimatePresence>
        {categoryMenuOpen && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
            onClick={() => setCategoryMenuOpen(false)}
          >
            <motion.div
              role="dialog" aria-label="Menu categories"
              initial={{ scale: 0.95 }} animate={{ scale: 1 }} exit={{ scale: 0.95 }}
              className="max-h-[70dvh] w-full max-w-[300px] overflow-hidden rounded-2xl bg-white shadow-2xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between bg-fk-red px-4 py-3 text-white">
                <h3 className="font-display text-xl font-extrabold uppercase">Menu</h3>
                <span className="text-xs font-semibold text-white/85">{visibleCount} items</span>
              </div>
              <div className="fk-checker-sm" />
              <div className="max-h-[calc(70dvh-60px)] overflow-y-auto px-4 py-1">
                {sections.map(({ category, items: rows }) => (
                  <button
                    key={category.id}
                    onClick={() => jumpTo(category.id)}
                    className="flex w-full justify-between border-b border-fk-line/70 py-3 text-left text-sm font-medium last:border-0 hover:text-fk-red"
                  >
                    {category.name} <span className="text-fk-muted">{rows.length}</span>
                  </button>
                ))}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Item details modal */}
      <AnimatePresence>
        {selectedItem && (
          <ItemDetailsModal
            item={selectedItem}
            qty={qtyOf(selectedItem.id)}
            onChange={(delta) => changeQty(selectedItem, delta)}
            onClose={() => setSelectedItem(null)}
          />
        )}
      </AnimatePresence>

      {/* Cart sheet */}
      <AnimatePresence>
        {cartOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => setCartOpen(false)} className="fixed inset-0 z-50 bg-black/60"
            />
            <motion.div
              role="dialog" aria-label="Your order"
              initial={{ y: '100%' }} animate={{ y: 0 }} exit={{ y: '100%' }}
              transition={{ type: 'spring', damping: 28, stiffness: 320 }}
              className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[85dvh] max-w-md flex-col overflow-hidden rounded-t-3xl bg-white"
            >
              <div className="flex items-center justify-between px-5 py-4">
                <h2 className="font-display text-2xl font-extrabold uppercase">Your order</h2>
                <button onClick={() => setCartOpen(false)} aria-label="Close cart" className="rounded-full border border-fk-line p-2 text-fk-muted hover:text-fk-ink">
                  <X className="h-[18px] w-[18px]" />
                </button>
              </div>
              <div className="fk-checker-sm" />
              <ul className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
                {cart.map((c) => (
                  <li key={c.item.id} className="flex items-center gap-3">
                    <VegMark veg={c.item.isVeg} />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">{c.item.name}</p>
                      <p className="text-xs text-fk-muted">{formatPrice(c.item.pricePaise * c.quantity)}</p>
                    </div>
                    <QtyControl qty={c.quantity} name={c.item.name} onChange={(d) => changeQty(c.item, d)} />
                  </li>
                ))}
              </ul>
              <div className="px-5 pb-5 pt-1">
                {offerPaise > 0 && <FreeDeliveryProgress subtotalPaise={totals.subtotalPaise} targetPaise={offerPaise} className="mb-1" />}
                <TotalsBlock {...totals} totalPaise={grandTotalPaise} deliveryFeePaise={deliveryFeePaise} baseFeePaise={isDelivery ? rules?.feePaise ?? 0 : 0} />
                <button
                  onClick={goToCheckout}
                  className="mt-4 flex w-full items-center justify-center gap-2 rounded-[14px] bg-fk-red py-4 font-bold text-white transition hover:bg-fk-red-dark"
                >
                  Checkout <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
      {!loading && !loadError && !orderChosen && screen === 'menu' && (
        <OrderTypeWelcome
          branchName={shortName(branch?.name)} rules={rules}
          onPick={(t) => { setOrderType(t); setOrderChosen(true) }}
        />
      )}
      {celebrate && <Celebration onDone={() => setCelebrate(false)} />}
      {accountOpen && <AccountPanel account={account} onClose={() => setAccountOpen(false)} onChanged={loadAccount} />}
      <LoopdotFooter />
    </div>
  )
}

// ── Small pieces ─────────────────────────────────────────────────────────────

function OfferBanner({ promotions }: { promotions: Promotion[] }) {
  const [index, setIndex] = useState(0)
  const [imageFailed, setImageFailed] = useState(false)

  useEffect(() => {
    setIndex(0)
  }, [promotions])
  useEffect(() => {
    setImageFailed(false)
  }, [promotions[index]?.image_url])

  useEffect(() => {
    if (promotions.length < 2) return
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % promotions.length), 5000)
    return () => window.clearInterval(timer)
  }, [promotions.length])

  const promotion = promotions[index]
  return (
    <section className="w-full overflow-hidden bg-fk-ink">
      <div className="relative aspect-[2/1] w-full">
        <div className="absolute inset-0 bg-gradient-to-br from-fk-ink via-fk-ink to-fk-red" />
        {promotion?.image_url && !imageFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={optimizeImageUrl(promotion.image_url, 900) ?? ''} alt="" fetchPriority="high" decoding="async" onError={() => setImageFailed(true)} className="absolute inset-0 h-full w-full object-cover" />
        ) : (
          <>
            <div className="absolute -right-6 -top-10 h-28 w-28 rounded-full bg-fk-red/80" aria-hidden />
            <div className="absolute -bottom-12 right-14 h-24 w-24 rounded-full bg-fk-yellow/20" aria-hidden />
          </>
        )}
        {promotions.length > 1 && (
          <div className="absolute bottom-4 right-4 flex gap-1.5" aria-label="Offer banners">
            {promotions.map((item, itemIndex) => (
              <button
                key={item.id}
                onClick={() => setIndex(itemIndex)}
                aria-label={`Show offer ${itemIndex + 1}`}
                className={`h-1.5 rounded-full transition-all ${itemIndex === index ? 'w-5 bg-white' : 'w-1.5 bg-white/50'}`}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  )
}

function ProductCard({
  item,
  qty,
  specialNote,
  onChange,
  onNoteChange,
  onDetails,
  compact = false,
}: {
  item: MenuItem
  qty: number
  specialNote: string
  onChange: (delta: number) => void
  onNoteChange: (id: string, note: string) => void
  onDetails: (item: MenuItem) => void
  compact?: boolean
}) {
  return (
    <article
      onClick={() => onDetails(item)}
      className={`cursor-pointer rounded-2xl border border-fk-line bg-white shadow-[0_2px_10px_rgba(0,0,0,0.03)] transition hover:shadow-md ${
      compact ? 'flex min-h-[148px] items-stretch gap-3 p-3' : 'flex flex-col p-2.5'
    }`}
    >
      <div className={compact ? 'order-2 flex w-[122px] shrink-0 flex-col gap-2 self-center' : ''}>
        <div className={`relative overflow-hidden rounded-xl bg-fk-tint ${
          compact ? 'h-[122px] w-[122px]' : 'mb-2 aspect-square w-full'
        }`}>
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={optimizeImageUrl(item.imageUrl, compact ? 300 : 480) ?? ''} alt={item.name} loading="lazy" decoding="async" className="h-full w-full object-cover transition duration-500 hover:scale-105" />
          ) : (
            // Placeholder until menu photos are uploaded.
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/brand/mark-red.png" alt="" className="absolute left-1/2 top-1/2 h-[42%] w-auto -translate-x-1/2 -translate-y-1/2 opacity-80" />
          )}
        </div>
        {compact && <QtyControl qty={qty} name={item.name} onChange={onChange} />}
      </div>

      <div className={compact ? 'flex min-w-0 flex-1 flex-col' : ''}>
        <div className="mb-1 flex min-h-[18px] items-center"><VegMark veg={item.isVeg} /></div>

        <h3 className={`mb-1 line-clamp-2 text-[14px] font-extrabold leading-snug tracking-tight ${compact ? '' : 'min-h-[36px]'}`}>{item.name}</h3>
        {item.description && <p className="mb-2 line-clamp-2 text-[11px] font-medium leading-snug text-fk-muted">{item.description}</p>}

        {qty > 0 && (
          <label className="mt-1 block" onClick={(event) => event.stopPropagation()}>
            <span className="sr-only">Special note for {item.name}</span>
            <textarea
              value={specialNote}
              onChange={(event) => onNoteChange(item.id, event.target.value)}
              onClick={(event) => event.stopPropagation()}
              maxLength={300}
              rows={1}
              placeholder="Special note..."
              className="min-h-8 w-full resize-y rounded-lg border border-amber-200 bg-amber-50/70 px-2.5 py-1.5 text-[11px] font-medium leading-snug text-fk-ink outline-none placeholder:text-fk-muted focus:border-amber-400 focus:ring-2 focus:ring-amber-200"
            />
          </label>
        )}

        <div className="mt-auto flex items-end justify-between gap-1.5 pt-2">
          <span className="rounded bg-fk-yellow px-1.5 py-0.5 text-[13px] font-black leading-none text-fk-ink shadow-sm">
            {formatPrice(item.pricePaise)}
          </span>
          {!compact && <QtyControl qty={qty} name={item.name} onChange={onChange} />}
        </div>
      </div>
    </article>
  )
}

function ItemDetailsModal({
  item,
  qty,
  onChange,
  onClose,
}: {
  item: MenuItem
  qty: number
  onChange: (delta: number) => void
  onClose: () => void
}) {
  return (
    <motion.div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center sm:p-5"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-label={`${item.name} details`}
        className="relative w-full max-w-lg overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-3xl"
        initial={{ y: '100%' }}
        animate={{ y: 0 }}
        exit={{ y: '100%' }}
        transition={{ type: 'spring', damping: 28, stiffness: 320 }}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          onClick={onClose}
          aria-label="Close item details"
          className="absolute right-3 top-3 z-10 rounded-full bg-black/60 p-2 text-white backdrop-blur-sm"
        >
          <X className="h-5 w-5" />
        </button>
        <div className="aspect-[4/3] bg-fk-tint">
          {item.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={optimizeImageUrl(item.imageUrl, 800) ?? ''} alt={item.name} decoding="async" className="h-full w-full object-cover" />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src="/brand/mark-red.png" alt="" className="mx-auto h-full w-[35%] object-contain opacity-80" />
          )}
        </div>
        <div className="p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mb-2"><VegMark veg={item.isVeg} /></div>
              <h2 className="font-display text-2xl font-extrabold leading-tight">{item.name}</h2>
              <p className="mt-2 inline-block rounded bg-fk-yellow px-2 py-1 text-sm font-black text-fk-ink">{formatPrice(item.pricePaise)}</p>
            </div>
            <QtyControl qty={qty} name={item.name} onChange={onChange} />
          </div>
          <p className="mt-4 text-sm leading-relaxed text-fk-muted">
            {item.description || 'Freshly prepared with Fried King ingredients.'}
          </p>
        </div>
      </motion.div>
    </motion.div>
  )
}

/** FSSAI-style veg / non-veg mark. */
function VegMark({ veg }: { veg: boolean }) {
  return (
    <span
      role="img"
      aria-label={veg ? 'Vegetarian' : 'Non-vegetarian'}
      className={`inline-flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[2px] border-[1.5px] ${veg ? 'border-fk-veg' : 'border-fk-nonveg'}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${veg ? 'bg-fk-veg' : 'bg-fk-nonveg'}`} />
    </span>
  )
}

function DietChip({ active, veg, onClick, children }: { active: boolean; veg: boolean; onClick: () => void; children: React.ReactNode }) {
  const on = veg ? 'border-green-200 bg-green-50 text-green-700' : 'border-red-200 bg-fk-tint text-fk-nonveg'
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`flex shrink-0 items-center gap-1.5 rounded-xl border px-3.5 py-2 text-[13px] font-bold transition ${
        active ? `${on} shadow-sm` : 'border-fk-line bg-white hover:bg-fk-bg'
      }`}
    >
      <VegMark veg={veg} /> {children}
    </button>
  )
}

function QtyControl({ qty, name, onChange }: { qty: number; name: string; onChange: (delta: number) => void }) {
  if (qty === 0) {
    return (
      <button
        onClick={(event) => { event.stopPropagation(); onChange(1) }}
        aria-label={`Add ${name}`}
        className="flex h-[34px] min-w-[76px] items-center justify-center rounded-lg border-[1.5px] border-fk-red bg-white px-4 text-[13px] font-black tracking-wide text-fk-red shadow-sm transition-all hover:bg-fk-tint active:scale-95"
      >
        ADD
      </button>
    )
  }
  return (
    <div onClick={(event) => event.stopPropagation()} className="flex h-[34px] min-w-[76px] items-center justify-between rounded-lg bg-fk-red px-1.5 text-[13px] font-extrabold text-white shadow-sm">
      <button onClick={() => onChange(-1)} aria-label={`Remove one ${name}`} className="flex h-full items-center p-1 transition active:scale-90">
        <Minus className="h-3.5 w-3.5" strokeWidth={3} />
      </button>
      <span className="px-1" aria-live="polite">{qty}</span>
      <button onClick={() => onChange(1)} aria-label={`Add one more ${name}`} className="flex h-full items-center p-1 transition active:scale-90">
        <Plus className="h-3.5 w-3.5" strokeWidth={3} />
      </button>
    </div>
  )
}

function TotalsBlock({ subtotalPaise, gstPaise, totalPaise, deliveryFeePaise = 0, baseFeePaise = 0 }: {
  subtotalPaise: number; gstPaise: number; totalPaise: number; deliveryFeePaise?: number; baseFeePaise?: number
}) {
  return (
    <dl className="mt-3 space-y-1.5 border-t border-dashed border-fk-line pt-3 text-sm">
      <div className="flex justify-between"><dt className="text-fk-muted">Subtotal</dt><dd>{formatPrice(subtotalPaise)}</dd></div>
      <div className="flex justify-between"><dt className="text-fk-muted">GST (5%)</dt><dd>{formatPrice(gstPaise)}</dd></div>
      {baseFeePaise > 0 && (
        <div className="flex justify-between">
          <dt className="text-fk-muted">Delivery fee</dt>
          <dd>{deliveryFeePaise === 0
            ? <><s className="mr-1.5 text-fk-muted">{formatPrice(baseFeePaise)}</s><span className="font-bold text-green-600">FREE</span></>
            : formatPrice(deliveryFeePaise)}</dd>
        </div>
      )}
      <div className="flex justify-between pt-1 text-base font-extrabold"><dt>Total</dt><dd className="text-fk-red">{formatPrice(totalPaise)}</dd></div>
    </dl>
  )
}

/** Shown once when the menu opens: delivery or takeaway. */
function OrderTypeWelcome({ branchName, rules, onPick }: { branchName: string; rules: DeliveryRules | null; onPick: (t: 'pickup' | 'delivery') => void }) {
  const canDeliver = !rules || rules.delivery
  const canPickup = !rules || rules.pickup
  // A branch that offers only one way needs no question.
  useEffect(() => {
    if (rules && rules.delivery !== rules.pickup) onPick(rules.delivery ? 'delivery' : 'pickup')
  }, [rules, onPick])
  const offer = rules && rules.freeAbovePaise > 0 ? `Free delivery above ${formatPrice(rules.freeAbovePaise)}` : rules && rules.feePaise > 0 ? `Delivery fee ${formatPrice(rules.feePaise)}` : 'Hot at your door'
  return (
    <motion.div className="fixed inset-0 z-[55] flex items-end justify-center bg-black/65 sm:items-center sm:p-5" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.div role="dialog" aria-modal="true" aria-label="How would you like your order?"
        initial={{ y: 60, opacity: 0 }} animate={{ y: 0, opacity: 1 }} transition={{ type: 'spring', damping: 26, stiffness: 300 }}
        className="w-full max-w-md overflow-hidden rounded-t-[28px] bg-white shadow-2xl sm:rounded-3xl">
        <div className="bg-fk-red px-6 pb-5 pt-7 text-center text-white">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-white.png" alt="Fried King" className="mx-auto h-16 w-auto" />
          <p className="mt-3 font-display text-2xl font-extrabold uppercase leading-tight">How would you like your order?</p>
          <p className="mt-1 text-sm text-white/85">Fried King · {branchName}</p>
        </div>
        <div className="fk-checker" />
        <div className="grid gap-3 p-5">
          {canDeliver && (
            <button onClick={() => onPick('delivery')} className="group flex items-center gap-4 rounded-2xl border border-fk-line p-4 text-left transition hover:border-fk-red hover:shadow-md">
              <span className="rounded-2xl bg-fk-tint p-3.5 text-fk-red transition group-hover:bg-fk-red group-hover:text-white"><Bike className="h-6 w-6" /></span>
              <span className="flex-1"><span className="block text-[17px] font-extrabold">Delivery</span><span className="block text-[13px] text-fk-muted">{offer}</span></span>
              <ChevronRight className="h-5 w-5 text-fk-line group-hover:text-fk-red" />
            </button>
          )}
          {canPickup && (
            <button onClick={() => onPick('pickup')} className="group flex items-center gap-4 rounded-2xl border border-fk-line p-4 text-left transition hover:border-fk-red hover:shadow-md">
              <span className="rounded-2xl bg-fk-tint p-3.5 text-fk-red transition group-hover:bg-fk-red group-hover:text-white"><Store className="h-6 w-6" /></span>
              <span className="flex-1"><span className="block text-[17px] font-extrabold">Takeaway</span><span className="block text-[13px] text-fk-muted">Pick it up at the branch</span></span>
              <ChevronRight className="h-5 w-5 text-fk-line group-hover:text-fk-red" />
            </button>
          )}
        </div>
      </motion.div>
    </motion.div>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-fk-line bg-white p-5 shadow-sm">
      <h2 className="mb-3 font-display text-lg font-bold uppercase leading-none tracking-wide">{title}</h2>
      {children}
    </section>
  )
}

function LoopdotFooter() {
  return <footer className="px-4 pb-6 pt-3 text-center text-xs font-medium text-fk-muted">Powered by Loopdot</footer>
}

function Spinner({ label }: { label: string }) {
  return (
    <div className="flex flex-col items-center gap-3 py-6 text-fk-muted" role="status">
      <Loader2 className="h-7 w-7 animate-spin text-fk-red" />
      <span className="text-sm">{label}</span>
    </div>
  )
}

function ErrorBox({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="rounded-2xl border border-fk-line bg-white p-5 text-center" role="alert">
      <AlertCircle className="mx-auto h-7 w-7 text-fk-red" />
      <p className="mt-2 text-sm text-fk-muted">{message}</p>
      <button
        onClick={onRetry}
        className="mt-3 rounded-full bg-fk-red px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-fk-red-dark"
      >
        Try again
      </button>
    </div>
  )
}
