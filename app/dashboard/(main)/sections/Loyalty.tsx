'use client'

import { useState } from 'react'
import type { DProgram } from '@/lib/dashboard/types'
import { Empty, Loading, Modal, phoneShort, rs, useDash, useLoad } from '../kit'

interface Account { id: string; customer_id: string; points_balance: number; lifetime_points: number; tier: string | null; customer: { id: string; name: string | null; phone: string } }
interface Txn { id: string; account_id: string; points: number; type: string; reason: string; created_at: string }

export default function Loyalty() {
  const { api, toast } = useDash()
  const { data, error, reload } = useLoad(() => api.get<{ program: DProgram | null; accounts: Account[]; transactions: Txn[] }>('loyalty'), [api])
  const [type, setType] = useState<DProgram['type'] | null>(null)
  const [form, setForm] = useState<Record<string, string> | null>(null)
  const [tiers, setTiers] = useState<DProgram['tiers'] | null>(null)
  const [modal, setModal] = useState<React.ReactNode>(null)
  if (!data) return <Loading error={error} onRetry={reload} />
  const p = data.program
  if (!p) return <div className="anacard"><h4>Loyalty</h4><p className="none">No active loyalty program for this branch. Run supabase/friedking_dashboard_oceana.sql to create one.</p></div>

  const sel = type ?? p.type
  const f = form ?? {
    name: p.name, currencyName: p.currency_name, earnRatePerRupee: String(p.earn_rate_per_rupee), earnRatePerVisit: String(p.earn_rate_per_visit),
    redemptionValue: String(p.redemption_paise_per_point / 100), minSpend: String(p.min_spend_to_earn_paise / 100), maxRedeemPct: String(p.max_redeem_pct_per_order),
    maxRedeemPerDay: p.max_redeem_paise_per_day != null ? String(p.max_redeem_paise_per_day / 100) : '', expiryDays: p.points_expiry_days != null ? String(p.points_expiry_days) : '',
  }
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...f, [k]: e.target.value })
  const tierRows = tiers ?? p.tiers ?? []

  // Metrics
  const vpp = p.redemption_paise_per_point
  const liability = data.accounts.reduce((s, a) => s + a.points_balance, 0) * vpp
  const lifetime = data.accounts.reduce((s, a) => s + a.lifetime_points, 0)
  const earned = data.transactions.filter((t) => t.type === 'earn').reduce((s, t) => s + t.points, 0)
  const redeemed = data.transactions.filter((t) => t.type === 'redeem')
  // Points given back for cancelled orders do not count as redeemed.
  const refundedPts = data.transactions.filter((t) => t.type === 'refund').reduce((s, t) => s + t.points, 0)
  const redeemedPts = Math.max(0, redeemed.reduce((s, t) => s + Math.abs(t.points), 0) - refundedPts)
  const active30 = new Set(data.transactions.filter((t) => Date.now() - new Date(t.created_at).getTime() <= 30 * 86400000).map((t) => t.account_id)).size
  const byMonth = new Map<string, { earned: number; redeemed: number }>()
  for (const t of data.transactions) {
    if (t.type !== 'earn' && t.type !== 'redeem' && t.type !== 'refund') continue
    const m = t.created_at.slice(0, 7), row = byMonth.get(m) ?? { earned: 0, redeemed: 0 }
    if (t.type === 'earn') row.earned += t.points
    else if (t.type === 'refund') row.redeemed = Math.max(0, row.redeemed - t.points)
    else row.redeemed += Math.abs(t.points)
    byMonth.set(m, row)
  }
  const months = [...byMonth.keys()].sort().slice(-6)
  const maxM = Math.max(1, ...months.map((m) => Math.max(byMonth.get(m)!.earned, byMonth.get(m)!.redeemed)))
  const cashbackPct = Number(f.earnRatePerRupee) * Number(f.redemptionValue) * 100

  const saveProgram = async () => {
    try { await api.post('loyalty', 'saveProgram', { ...f, type: sel }); toast('Loyalty settings saved'); setForm(null); setType(null); void reload() }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not save') }
  }
  const saveTiers = async () => {
    try { await api.post('loyalty', 'saveTiers', { tiers: tierRows }); toast('Tiers saved'); setTiers(null); void reload() }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not save tiers') }
  }
  const card = (k: DProgram['type'], icon: string, title: string, sub: string, fields: React.ReactNode) => (
    <div className={`progcard ${sel === k ? 'active' : ''}`}>
      <button className="progcard-h" onClick={() => setType(k)}><span className="progcard-radio"><i /></span><span className="progcard-icon">{icon}</span><span className="progcard-tt"><b>{title}</b><span>{sub}</span></span></button>
      <div className="formgrid">{fields}</div>
    </div>
  )

  return (
    <section>
      <div className="anacard"><h4>Performance</h4>
        <div className="ov-pills" style={{ margin: '0 0 12px' }}>
          <div className="ovpill teal"><b>{data.accounts.length}</b><span>Enrolled customers</span></div>
          <div className="ovpill blue"><b>{active30}</b><span>Active this month</span></div>
          <div className="ovpill orange"><b>{earned ? Math.round((redeemedPts / earned) * 100) : 0}%</b><span>Redemption rate</span></div>
        </div>
        <div className="stats">
          <div className="stat"><span>Lifetime points issued</span><b>{lifetime}</b></div>
          <div className="stat"><span>Points redeemed</span><b>{redeemedPts}</b></div>
          <div className="stat"><span>Times redeemed</span><b>{redeemed.length}</b></div>
          <div className="stat"><span>Points liability</span><b>{rs(liability)}</b></div>
        </div>
        <p className="asub" style={{ margin: '0 0 8px' }}>Earned vs. redeemed, last 6 months</p>
        {months.length ? months.map((m) => { const r = byMonth.get(m)!, l = new Date(`${m}-01T00:00:00+05:30`).toLocaleDateString('en-IN', { month: 'short', year: '2-digit' })
          return <div key={m}>
            <div className="hbar-row"><span className="hbar-label">{l} earned</span><div className="hbar-track"><div className="hbar-fill" style={{ width: `${Math.max(4, Math.round((r.earned / maxM) * 100))}%`, background: '#1c1414' }} /></div><span className="hbar-val">{r.earned}</span></div>
            <div className="hbar-row"><span className="hbar-label">{l} redeemed</span><div className="hbar-track"><div className="hbar-fill" style={{ width: `${Math.max(4, Math.round((r.redeemed / maxM) * 100))}%`, background: '#f5a623' }} /></div><span className="hbar-val">{r.redeemed}</span></div>
          </div> }) : <Empty icon="📈" text="No loyalty activity yet. Points are earned when an order is marked done." />}
      </div>

      <div className="anacard"><h4>{p.name} · program type</h4>
        <p className="asub">Pick one program type to run. Numbers for the others stay saved if you switch back later.</p>
        <div className="progcards">
          {card('points', '⭐', 'Points', 'Earn points per rupee spent', <label>Earn rate: points per ₹1 spent<input className="f" type="number" step="0.01" value={f.earnRatePerRupee} onChange={set('earnRatePerRupee')} /></label>)}
          {card('visit', '🎟️', 'Visit-based', 'Flat points on every visit', <label>Earn rate: points per visit (flat)<input className="f" type="number" step="1" value={f.earnRatePerVisit} onChange={set('earnRatePerVisit')} /></label>)}
          {card('cashback', '💰', 'Cashback', '% back on every order', <div className="cbnote"><b>≈ {cashbackPct.toFixed(1)}% effective cashback</b><span>Same earn rate as Points, shown as a share of the bill. Switch to Points to tune the rate.</span></div>)}
        </div>
      </div>

      <div className="anacard"><h4>Shared settings</h4><p className="asub">Apply to whichever program type is active above</p>
        <div className="formgrid">
          <label>Program name<input className="f" value={f.name} onChange={set('name')} /></label>
          <label>Points currency name<input className="f" value={f.currencyName} onChange={set('currencyName')} /></label>
          <label>Redemption value: ₹ per point<input className="f" type="number" step="0.01" value={f.redemptionValue} onChange={set('redemptionValue')} /></label>
          <label>Min spend to earn (₹)<input className="f" type="number" value={f.minSpend} onChange={set('minSpend')} /></label>
          <label>Max redeem: % of order<input className="f" type="number" value={f.maxRedeemPct} onChange={set('maxRedeemPct')} /></label>
          <label>Max redeem: ₹ per customer/day (blank = no cap)<input className="f" type="number" value={f.maxRedeemPerDay} onChange={set('maxRedeemPerDay')} /></label>
          <label>Points expiry: days (blank = never)<input className="f" type="number" value={f.expiryDays} onChange={set('expiryDays')} /></label>
        </div>
        <button className="btn sm" style={{ marginTop: 14, alignSelf: 'flex-start' }} onClick={() => void saveProgram()}>Save settings</button>
      </div>

      <div className="anacard"><h4>Tiers</h4><p className="asub">Unlocked by lifetime points earned, e.g. 500 pts → free dip</p>
        {tierRows.length ? tierRows.map((t, i) => (
          <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input className="f" style={{ flex: 1, margin: 0, minWidth: 120 }} placeholder="Tier name" value={t.name} onChange={(e) => setTiers(tierRows.map((x, j) => j === i ? { ...x, name: e.target.value } : x))} />
            <input className="f" style={{ width: 150, margin: 0 }} type="number" placeholder="Min lifetime pts" value={t.min_lifetime_points} onChange={(e) => setTiers(tierRows.map((x, j) => j === i ? { ...x, min_lifetime_points: Number(e.target.value) } : x))} />
            <input className="f" style={{ flex: 2, margin: 0, minWidth: 160 }} placeholder="Perk" value={t.perk} onChange={(e) => setTiers(tierRows.map((x, j) => j === i ? { ...x, perk: e.target.value } : x))} />
            <button className="btn sm ghost" onClick={() => setTiers(tierRows.filter((_, j) => j !== i))}>✕</button>
          </div>
        )) : <p className="none">No tiers yet</p>}
        <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
          <button className="btn sm ghost" onClick={() => setTiers([...tierRows, { name: '', min_lifetime_points: 0, perk: '' }])}>+ Add tier</button>
          <button className="btn sm" onClick={() => void saveTiers()}>Save tiers</button>
        </div>
      </div>

      <div className="anacard"><h4>Leaderboard</h4><p className="asub">Click a row to redeem points for a customer at the counter</p>
        <div className="tblwrap"><table><thead><tr><th>Name</th><th>Phone</th><th>Tier</th><th>Balance</th><th>Lifetime</th></tr></thead><tbody>
          {data.accounts.length ? data.accounts.slice(0, 200).map((a) => (
            <tr key={a.id} style={{ cursor: 'pointer' }} onClick={() => setModal(<Redeem a={a} vpp={vpp} onClose={() => setModal(null)} onDone={() => { setModal(null); void reload() }} />)}>
              <td>{a.customer.name || '—'}</td><td>{phoneShort(a.customer.phone)}</td><td>{a.tier || '—'}</td><td><b>{a.points_balance}</b></td><td>{a.lifetime_points}</td>
            </tr>)) : <tr><td colSpan={5}><div className="none">No enrolled customers yet</div></td></tr>}
        </tbody></table></div>
        {data.accounts.length > 200 && <div className="none" style={{ marginTop: 10 }}>Showing top 200 by balance.</div>}
      </div>
      {modal}
    </section>
  )
}

function Redeem({ a, vpp, onClose, onDone }: { a: Account; vpp: number; onClose: () => void; onDone: () => void }) {
  const { api, toast } = useDash()
  const [pts, setPts] = useState(String(Math.min(10, a.points_balance)))
  const [note, setNote] = useState('')
  const n = Math.max(0, Number(pts) || 0)
  return <Modal onClose={onClose}><h3>Redeem points · {a.customer.name || phoneShort(a.customer.phone)}</h3>
    <p>{phoneShort(a.customer.phone)} · Balance: <b>{a.points_balance} pts</b> (≈{rs(a.points_balance * vpp)})</p>
    <label className="lbl">Points to redeem</label><input className="f2" type="number" min={1} max={a.points_balance} value={pts} onChange={(e) => setPts(e.target.value)} />
    <p className="asub" style={{ margin: '0 0 8px' }}>≈ {rs(n * vpp)}</p>
    <label className="lbl">Reason</label><input className="f2" placeholder="e.g. cashed in at counter" value={note} onChange={(e) => setNote(e.target.value)} />
    <div className="mrow"><button onClick={onClose}>Cancel</button><button className="go" onClick={async () => {
      if (n <= 0) { toast('Enter a valid points amount'); return }
      try { const r = await api.post<{ redeemed: number; value_paise: number }>('loyalty', 'redeem', { customerId: a.customer_id, points: n, note }); toast(`Redeemed ${r.redeemed} pts (${rs(r.value_paise)})`); onDone() }
      catch (e) { toast(e instanceof Error ? e.message : 'Redeem failed') }
    }}>Confirm redeem</button></div>
  </Modal>
}
