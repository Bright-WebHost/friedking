'use client'

import { useCallback, useEffect, useState } from 'react'
import { dayKeyIST, Loading, phoneShort, useDash } from '../kit'

interface Campaign { id: string; title: string; template_name: string | null; recipient_count: number; created_by_name: string | null; created_at: string }
interface Stat { total: number; waiting: number; sent: number; delivered: number; read: number; failed: number; top_error: string | null }
interface Recipient { phone: string; name: string | null; state: 'waiting' | 'sent' | 'delivered' | 'read' | 'failed'; error: string | null; at: string }
interface Detail { page: number; size: number; matching: number; recipients: Recipient[] }

const timeIST = (t: string) => new Date(t).toLocaleTimeString('en-IN', { timeZone: 'Asia/Kolkata', hour: 'numeric', minute: '2-digit', hour12: true })

/** Contacts > Promotion history: every promotion by date, and who each one was sent to. */
export default function PromoHistory() {
  const { api } = useDash()
  const [data, setData] = useState<{ campaigns: Campaign[]; stats: Record<string, Stat> } | null>(null)
  const [error, setError] = useState('')
  const [open, setOpen] = useState<Campaign | null>(null)

  const load = useCallback(async () => {
    try { setData(await api.get('contacts', { view: 'promos' })); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load') }
  }, [api])
  useEffect(() => { void load() }, [load])

  if (open) return <PromoDetail c={open} stat={data?.stats[open.id]} onBack={() => setOpen(null)} />
  if (!data) return <Loading error={error} onRetry={load} />

  // Group by day (IST), newest first.
  const days = new Map<string, Campaign[]>()
  for (const c of data.campaigns) { const k = dayKeyIST(c.created_at); days.set(k, [...(days.get(k) ?? []), c]) }

  return (
    <section>
      {!data.campaigns.length && <div className="none">No promotions sent yet</div>}
      {[...days].map(([day, list]) => (
        <div key={day} style={{ marginBottom: 18 }}>
          <div className="selinfo" style={{ margin: '4px 0 6px', fontWeight: 700 }}>{day}</div>
          <div className="tblwrap"><table><thead><tr><th>Time</th><th>Promotion</th><th>Sent to</th><th>Delivered</th><th>Failed</th><th>By</th></tr></thead><tbody>
            {list.map((c) => {
              const s = data.stats[c.id]
              return (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setOpen(c)}>
                  <td>{timeIST(c.created_at)}</td>
                  <td><b>{c.template_name || c.title}</b></td>
                  <td>{c.recipient_count}</td>
                  <td>{s ? s.delivered + s.read : '—'}</td>
                  <td style={{ color: s?.failed ? 'var(--red)' : 'inherit' }}>{s ? s.failed : '—'}</td>
                  <td>{c.created_by_name || ''}</td>
                </tr>
              )
            })}
          </tbody></table></div>
        </div>
      ))}
    </section>
  )
}

function PromoDetail({ c, stat, onBack }: { c: Campaign; stat?: Stat; onBack: () => void }) {
  const { api, toast, go } = useDash()
  const [only, setOnly] = useState<'all' | 'failed'>('all')
  const [page, setPage] = useState(1)
  const [d, setD] = useState<Detail | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try { setD(await api.get<Detail>('contacts', { view: 'promo', id: c.id, only, page })); setError('') }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not load') }
  }, [api, c.id, only, page])
  useEffect(() => { void load() }, [load])

  const again = async (which: 'all' | 'failed') => {
    setBusy(true)
    try {
      const r = await api.post<{ phones: string[] }>('contacts', 'promoPhones', { id: c.id, only: which })
      if (!r.phones.length) { toast('Nobody to send to'); return }
      go('blast', { phones: r.phones })
    } catch (e) { toast(e instanceof Error ? e.message : 'Could not load the contacts') }
    finally { setBusy(false) }
  }

  const pages = d ? Math.max(1, Math.ceil(d.matching / d.size)) : 1
  return (
    <section>
      <div className="pickbar">
        <button className="btn sm ghost" onClick={onBack}>‹ All promotions</button>
        <b>{c.template_name || c.title}</b>
        <span className="selinfo">{dayKeyIST(c.created_at)} {timeIST(c.created_at)}{c.created_by_name ? ` · by ${c.created_by_name}` : ''}</span>
      </div>
      {stat && (
        <div className="stats" style={{ marginTop: 12 }}>
          <div className="stat"><span>Sent to</span><b>{stat.total}</b></div>
          <div className="stat b"><span>Delivered</span><b>{stat.delivered + stat.read}</b></div>
          <div className="stat o"><span>Waiting</span><b>{stat.waiting}</b></div>
          <div className="stat r"><span>Failed</span><b>{stat.failed}</b></div>
        </div>
      )}
      {stat?.top_error && stat.failed > 0 && <div className="note">Most common failure: {stat.top_error}</div>}
      <div className="pickbar" style={{ marginTop: 12 }}>
        <select className="f2" style={{ width: 'auto', margin: 0 }} value={only} onChange={(e) => { setOnly(e.target.value as 'all' | 'failed'); setPage(1) }}>
          <option value="all">Everyone it was sent to</option><option value="failed">Only failed</option>
        </select>
        <button className="btn sm ghost" disabled={busy} onClick={() => void again('all')}>Send again to everyone…</button>
        {(stat?.failed ?? 0) > 0 && <button className="btn sm ghost" disabled={busy} onClick={() => void again('failed')}>Send again to failed…</button>}
      </div>
      {!d ? <Loading error={error} onRetry={load} /> : (
        <>
          <div className="tblwrap"><table><thead><tr><th>Number</th><th>Name</th><th>Status</th><th>Time</th></tr></thead><tbody>
            {d.recipients.length ? d.recipients.map((r, i) => (
              <tr key={r.phone + i}>
                <td>{phoneShort(r.phone)}</td><td>{r.name || <span style={{ color: 'var(--muted)' }}>—</span>}</td>
                <td style={{ color: r.state === 'failed' ? 'var(--red)' : r.state === 'waiting' ? 'var(--muted)' : 'inherit' }}>{r.state}{r.state === 'failed' && r.error ? <span style={{ fontSize: 11 }}> · {r.error.slice(0, 80)}</span> : null}</td>
                <td>{timeIST(r.at)}</td>
              </tr>
            )) : <tr><td colSpan={4}><div className="none">{only === 'failed' ? 'No failed messages' : 'No messages'}</div></td></tr>}
          </tbody></table></div>
          {pages > 1 && (
            <div className="pickbar" style={{ marginTop: 12, justifyContent: 'center' }}>
              <button className="btn sm ghost" disabled={page <= 1} onClick={() => setPage(page - 1)}>‹ Prev</button>
              <span className="selinfo">Page {page} of {pages} · {d.matching} contacts</span>
              <button className="btn sm ghost" disabled={page >= pages} onClick={() => setPage(page + 1)}>Next ›</button>
            </div>
          )}
        </>
      )}
    </section>
  )
}
