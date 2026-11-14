'use client'

import { useCallback, useEffect, useState } from 'react'
import { formatPrice } from '@/lib/utils'

type Report = {
  summary: { revenuePaise: number; orders: number; averagePaise: number }
  byType: { pickup: number; delivery: number }
  daily: Array<{ date: string; revenuePaise: number; orders: number }>
  topItems: Array<{ name: string; quantity: number }>
}

export default function DashboardReports({ branchSlug, pnl = false }: { branchSlug: string | null; pnl?: boolean }) {
  const [report, setReport] = useState<Report | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const load = useCallback(async () => {
    const query = branchSlug ? `?branch=${encodeURIComponent(branchSlug)}` : ''
    const response = await fetch(`/api/dashboard/analytics${query}`, { cache: 'no-store' })
    const data = await response.json()
    if (!response.ok) throw new Error(data.message ?? 'Could not load report')
    setReport(data)
  }, [branchSlug])

  useEffect(() => { load().catch((e) => setError(e instanceof Error ? e.message : 'Could not load report')).finally(() => setLoading(false)) }, [load])

  const title = pnl ? 'Profit & Loss' : 'Analytics'
  return <section>
    <div className="mb-5 flex items-end justify-between gap-3"><div><h1 className="font-display text-3xl font-extrabold uppercase">{pnl ? '💰' : '📊'} {title}</h1><p className="text-sm text-fk-muted">{pnl ? 'Revenue overview based on completed orders.' : 'Last 30 days of Pandeshwar ordering activity.'}</p></div><button onClick={() => void load()} className="rounded-lg border border-[#e6e9ee] bg-white px-3 py-2 text-sm font-bold">Refresh</button></div>
    {error && <p className="mb-4 rounded-xl bg-fk-tint px-3 py-2 text-sm font-medium text-fk-nonveg">{error}</p>}
    {loading ? <p className="text-sm text-fk-muted">Loading report…</p> : report && <>
      <div className="grid gap-3 sm:grid-cols-3">
        <Metric label="Revenue" value={formatPrice(report.summary.revenuePaise)} tone="red" />
        <Metric label="Orders" value={String(report.summary.orders)} tone="blue" />
        <Metric label="Average order" value={formatPrice(report.summary.averagePaise)} tone="green" />
      </div>
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="rounded-2xl border border-[#e6e9ee] bg-white p-5 shadow-sm"><h2 className="font-display text-xl font-extrabold">Order types</h2><div className="mt-4 space-y-3"><Bar label="Pickup" value={report.byType.pickup} max={Math.max(report.byType.pickup, report.byType.delivery, 1)} /><Bar label="Delivery" value={report.byType.delivery} max={Math.max(report.byType.pickup, report.byType.delivery, 1)} /></div></div>
        <div className="rounded-2xl border border-[#e6e9ee] bg-white p-5 shadow-sm"><h2 className="font-display text-xl font-extrabold">Most ordered items</h2><div className="mt-3 space-y-2">{report.topItems.length ? report.topItems.map((item) => <div key={item.name} className="flex items-center justify-between border-b border-[#eef0f3] py-2 text-sm"><span className="font-semibold">{item.name}</span><b>{item.quantity}</b></div>) : <p className="text-sm text-fk-muted">No completed orders yet.</p>}</div></div>
      </div>
      <div className="mt-4 rounded-2xl border border-[#e6e9ee] bg-white p-5 shadow-sm"><h2 className="font-display text-xl font-extrabold">Sales by day</h2><div className="mt-4 overflow-x-auto"><table className="w-full min-w-[420px] text-left text-sm"><thead className="border-b border-[#e6e9ee] text-xs uppercase text-fk-muted"><tr><th className="pb-2">Date</th><th className="pb-2">Orders</th><th className="pb-2 text-right">Revenue</th></tr></thead><tbody>{report.daily.slice().reverse().map((day) => <tr key={day.date} className="border-b border-[#eef0f3] last:border-0"><td className="py-2">{new Date(`${day.date}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' })}</td><td className="py-2">{day.orders}</td><td className="py-2 text-right font-bold">{formatPrice(day.revenuePaise)}</td></tr>)}</tbody></table></div></div>
    </>}
  </section>
}

function Metric({ label, value, tone }: { label: string; value: string; tone: 'red' | 'blue' | 'green' }) {
  const styles = { red: 'bg-fk-tint text-fk-red', blue: 'bg-blue-50 text-blue-700', green: 'bg-green-50 text-green-700' }
  return <div className={`rounded-2xl border border-[#e6e9ee] p-5 shadow-sm ${styles[tone]}`}><p className="text-xs font-black uppercase tracking-wider opacity-75">{label}</p><p className="mt-2 font-display text-3xl font-extrabold">{value}</p></div>
}

function Bar({ label, value, max }: { label: string; value: number; max: number }) {
  return <div><div className="mb-1 flex justify-between text-sm font-semibold"><span>{label}</span><span>{value}</span></div><div className="h-3 overflow-hidden rounded-full bg-[#eef0f3]"><div className="h-full rounded-full bg-fk-red" style={{ width: `${(value / max) * 100}%` }} /></div></div>
}
