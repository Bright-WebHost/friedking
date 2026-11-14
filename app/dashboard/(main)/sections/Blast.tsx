'use client'

import { useEffect, useRef, useState } from 'react'
import { ist, Loading, useDash, useLoad } from '../kit'

interface BlastData {
  eligible: number; sentThisMonth: number; cap: number; headerImage: string; template: string
  campaigns: Array<{ id: string; template_name: string | null; audience: string; status: string; recipient_count: number; created_by_name: string | null; created_at: string }>
}

export default function Blast() {
  const { api, toast, handoff, go } = useDash()
  const { data, error, reload } = useLoad(() => api.get<BlastData>('blast'), [api])
  const init = useRef(handoff.current)
  useEffect(() => { handoff.current = null }, [handoff])
  const [phones, setPhones] = useState<string[]>((init.current?.phones as string[] | undefined) ?? [])
  const [filter, setFilter] = useState('all')
  const [template, setTemplate] = useState<string | null>(null)
  const [header, setHeader] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [result, setResult] = useState<React.ReactNode>(null)
  if (!data) return <Loading error={error} onRetry={reload} />

  const tpl = template ?? data.template
  const hdr = header ?? data.headerImage
  const remaining = Math.max(0, data.cap - data.sentThisMonth)
  const capPct = Math.min(100, Math.round((data.sentThisMonth / data.cap) * 100))
  const capClr = data.sentThisMonth >= data.cap ? '#c0392b' : data.sentThisMonth >= data.cap * 0.8 ? '#c9821a' : '#1f8a4c'

  const upload = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 5 * 1024 * 1024) { toast('Image is over 5 MB: use a smaller file'); return }
    setUploading(true)
    try { const fd = new FormData(); fd.set('image', f); const r = await api.form<{ url: string }>('blast', 'uploadHeader', fd); setHeader(r.url); toast('Header image uploaded') }
    catch (e) { toast(e instanceof Error ? e.message : 'Upload failed') } finally { setUploading(false) }
  }
  const send = async () => {
    setBusy(true); setResult(null)
    try {
      const r = await api.post<{ queued: number }>('blast', 'send', { filter, templateName: tpl, headerImage: hdr, phones })
      setResult(<div className="stat g"><span>Queued for sending</span><b>{r.queued}</b></div>)
      toast(`${r.queued} messages queued`)
      setPhones([]); void reload()
    } catch (e) {
      setResult(<div className="err">{e instanceof Error ? e.message : 'Could not queue the blast'}</div>)
    } finally { setBusy(false) }
  }

  return (
    <section>
      <div className="stats">
        <div className="stat"><span>Eligible Contacts</span><b>{data.eligible}</b></div>
        <div className="stat r"><span>Selected</span><b>{phones.length}</b></div>
        <div className="stat"><span>Sent this month</span><b style={{ color: capClr }}>{data.sentThisMonth}/{data.cap}</b></div>
      </div>
      <div style={{ height: 6, borderRadius: 4, background: '#eee', overflow: 'hidden', margin: '-6px 0 14px' }}><div style={{ height: '100%', width: `${capPct}%`, background: capClr }} /></div>
      {data.sentThisMonth >= data.cap ? <div className="err">⛔ Monthly blast cap reached ({data.cap}/{data.cap}). Sends resume on the 1st of next month.</div>
        : remaining <= 100 ? <div className="note">⚠ Only {remaining} blast sends left this month (cap {data.cap}/month).</div> : null}
      {phones.length
        ? <div className="selinfo" style={{ marginBottom: 12 }}>Sending to the {phones.length} contacts you picked. <button style={{ textDecoration: 'underline' }} onClick={() => setPhones([])}>Clear selection</button></div>
        : <div className="note">No contacts selected: this goes to the whole group below. <button style={{ textDecoration: 'underline' }} onClick={() => go('contacts')}>Pick contacts instead</button></div>}
      <div className="tcard">
        <label className="lbl">Who{phones.length ? ' (ignored while a selection is active)' : ''}</label>
        <select className="f" value={filter} disabled={!!phones.length} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Everyone</option><option value="active_30">Ordered in the last 30 days</option><option value="repeat">Repeat customers only</option>
        </select>
        <label className="lbl">Approved template name</label>
        <input className="f" value={tpl} onChange={(e) => setTemplate(e.target.value)} />
        <label className="lbl">Header image</label>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input className="f" style={{ flex: 1, minWidth: 220 }} placeholder="https://… .png" value={hdr} onChange={(e) => setHeader(e.target.value)} />
          <label className="btn" style={{ width: 'auto', padding: '10px 16px', cursor: 'pointer', height: 'fit-content' }}>{uploading ? 'Uploading…' : 'Upload image'}<input type="file" hidden accept="image/png,image/jpeg,image/webp" onChange={(e) => void upload(e.target.files?.[0])} /></label>
        </div>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        {hdr && <img src={hdr} alt="Header preview" style={{ maxWidth: 160, maxHeight: 90, borderRadius: 8, border: '1px solid #eee', objectFit: 'cover', display: 'block', marginBottom: 8 }} />}
        <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 12px' }}>
          Templates with an image header need an image on every send: Meta treats the one you uploaded with the template as a sample only.{' '}
          <button style={{ textDecoration: 'underline' }} onClick={async () => { try { await api.post('blast', 'saveHeader', { url: hdr }); toast('Saved') } catch (e) { toast(e instanceof Error ? e.message : 'Could not save') } }}>Save without sending</button>
        </div>
        <div className="note">The template must already be approved in Meta. Messages are queued here and sent by n8n once WhatsApp (YCloud) is connected; nothing goes out from the dashboard directly.</div>
        <button className="btn" disabled={busy || data.sentThisMonth >= data.cap} onClick={() => void send()}>{busy ? 'Queuing…' : 'Send blast'}</button>
        <div style={{ marginTop: 12 }}>{result}</div>
      </div>
      {data.campaigns.length > 0 && <div className="anacard"><h4>Recent blasts</h4>
        <div className="tblwrap"><table><thead><tr><th>When</th><th>Template</th><th>Audience</th><th>Recipients</th><th>Status</th><th>By</th></tr></thead><tbody>
          {data.campaigns.map((c) => <tr key={c.id}><td>{ist(c.created_at)}</td><td>{c.template_name}</td><td>{c.audience.replace('_', ' ')}</td><td>{c.recipient_count}</td><td>{c.status}</td><td>{c.created_by_name}</td></tr>)}
        </tbody></table></div></div>}
    </section>
  )
}
