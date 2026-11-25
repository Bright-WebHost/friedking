'use client'

import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { ist, Loading, useDash, useLoad } from '../kit'

const PRESETS = [
  { name: 'friedking_promo_en', label: 'Promotion with image (friedking_promo_en)' },
  { name: 'friedking_promo_video', label: 'Promotion with video (friedking_promo_video)' },
]
const isVideoTemplate = (name: string) => /video/i.test(name)

interface BlastData {
  eligible: number; sentThisMonth: number; cap: number; headerImage: string; headerVideo: string; template: string
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
  const [video, setVideo] = useState<string | null>(null)
  const [custom, setCustom] = useState(false)
  const [result, setResult] = useState<React.ReactNode>(null)
  if (!data) return <Loading error={error} onRetry={reload} />

  const tpl = template ?? data.template
  const asVideo = isVideoTemplate(tpl)
  const vid = video ?? data.headerVideo
  const hdr = asVideo ? vid : (header ?? data.headerImage)
  const isCustom = custom || !PRESETS.some((p) => p.name === tpl)
  const remaining = Math.max(0, data.cap - data.sentThisMonth)
  const capPct = data.cap > 0 ? Math.min(100, Math.round((data.sentThisMonth / data.cap) * 100)) : 0
  const capClr = data.sentThisMonth >= data.cap ? '#c0392b' : data.sentThisMonth >= data.cap * 0.8 ? '#c9821a' : '#1f8a4c'

  const upload = async (f: File | undefined) => {
    if (!f) return
    if (f.size > 5 * 1024 * 1024) { toast('Image is over 5 MB: use a smaller file'); return }
    setUploading(true)
    try { const fd = new FormData(); fd.set('image', f); const r = await api.form<{ url: string }>('blast', 'uploadHeader', fd); setHeader(r.url); toast('Header image uploaded') }
    catch (e) { toast(e instanceof Error ? e.message : 'Upload failed') } finally { setUploading(false) }
  }
  const uploadVideo = async (f: File | undefined) => {
    if (!f) return
    if (!/.mp4$/i.test(f.name) && f.type !== 'video/mp4') { toast('Please choose an MP4 video'); return }
    if (f.size > 16 * 1024 * 1024) { toast('Video is over 16 MB (WhatsApp limit): use a shorter or smaller file'); return }
    setUploading(true)
    try {
      // Too big for a normal request, so it goes straight to storage with a one-time link.
      const t = await api.post<{ path: string; token: string; url: string }>('blast', 'videoUploadUrl')
      const up = await createClient().storage.from('menu').uploadToSignedUrl(t.path, t.token, f, { contentType: 'video/mp4' })
      if (up.error) throw new Error(up.error.message)
      await api.post('blast', 'saveVideo', { url: t.url })
      setVideo(t.url); toast('Video uploaded')
    } catch (e) { toast(e instanceof Error ? e.message : 'Upload failed') } finally { setUploading(false) }
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
        <div className="stat"><span>Remaining</span><b style={{ color: capClr }}>{remaining}</b></div>
      </div>
      <div style={{ height: 6, borderRadius: 4, background: '#eee', overflow: 'hidden', margin: '-6px 0 14px' }}><div style={{ height: '100%', width: `${capPct}%`, background: capClr }} /></div>
      {data.sentThisMonth >= data.cap ? <div className="err">⛔ Monthly promotion cap reached ({data.cap}/{data.cap}). Sends resume on the 1st of next month.</div>
        : remaining <= 100 ? <div className="note">⚠ Only {remaining} promotion sends left this month (cap {data.cap}/month).</div> : null}
      {phones.length
        ? <div className="selinfo" style={{ marginBottom: 12 }}>Sending to the {phones.length} contacts you picked. <button style={{ textDecoration: 'underline' }} onClick={() => setPhones([])}>Clear selection</button></div>
        : <div className="note">No contacts selected: this goes to the whole group below. <button style={{ textDecoration: 'underline' }} onClick={() => go('contacts')}>Pick contacts instead</button></div>}
      <div className="tcard">
        <label className="lbl">Who{phones.length ? ' (ignored while a selection is active)' : ''}</label>
        <select className="f" value={filter} disabled={!!phones.length} onChange={(e) => setFilter(e.target.value)}>
          <option value="all">Everyone</option><option value="active_30">Ordered in the last 30 days</option><option value="repeat">Repeat customers only</option>
        </select>
        <label className="lbl">Template</label>
        <select className="f" value={isCustom ? '__custom' : tpl} onChange={(e) => { if (e.target.value === '__custom') { setCustom(true) } else { setCustom(false); setTemplate(e.target.value) } }}>
          {PRESETS.map((p) => <option key={p.name} value={p.name}>{p.label}</option>)}
          <option value="__custom">Other template (type the name)</option>
        </select>
        {isCustom && <input className="f" placeholder="Approved template name" value={tpl} onChange={(e) => setTemplate(e.target.value)} />}
        {asVideo ? <>
          <label className="lbl">Header video (MP4, up to 16 MB)</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="f" style={{ flex: 1, minWidth: 220 }} placeholder="https://… .mp4" value={vid} onChange={(e) => setVideo(e.target.value)} />
            <label className="btn" style={{ width: 'auto', padding: '10px 16px', cursor: 'pointer', height: 'fit-content' }}>{uploading ? 'Uploading…' : 'Upload video'}<input type="file" hidden accept="video/mp4" onChange={(e) => void uploadVideo(e.target.files?.[0])} /></label>
          </div>
          {vid && <video src={vid} controls preload="metadata" style={{ maxWidth: 260, maxHeight: 160, borderRadius: 8, border: '1px solid #eee', display: 'block', margin: '8px 0' }} />}
          <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 12px' }}>
            Video templates need the video on every send: Meta treats the one you submitted with the template as a sample only. Use an MP4 (H.264 video, AAC audio) under 16 MB.{' '}
            <button style={{ textDecoration: 'underline' }} onClick={async () => { try { await api.post('blast', 'saveVideo', { url: vid }); toast('Saved') } catch (e) { toast(e instanceof Error ? e.message : 'Could not save') } }}>Save without sending</button>
          </div>
        </> : <>
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
        </>}
        <div className="note">The template must already be approved in Meta. Messages are queued here and sent by n8n once WhatsApp (YCloud) is connected; nothing goes out from the dashboard directly.</div>
        <button className="btn" disabled={busy || data.sentThisMonth >= data.cap} onClick={() => void send()}>{busy ? 'Queuing…' : 'Send promotion'}</button>
        <div style={{ marginTop: 12 }}>{result}</div>
      </div>
      {data.campaigns.length > 0 && <div className="anacard"><h4>Recent promotions</h4>
        <div className="tblwrap"><table><thead><tr><th>When</th><th>Template</th><th>Audience</th><th>Recipients</th><th>Status</th><th>By</th></tr></thead><tbody>
          {data.campaigns.map((c) => <tr key={c.id}><td>{ist(c.created_at)}</td><td>{c.template_name}</td><td>{c.audience.replace('_', ' ')}</td><td>{c.recipient_count}</td><td>{c.status}</td><td>{c.created_by_name}</td></tr>)}
        </tbody></table></div></div>}
    </section>
  )
}
