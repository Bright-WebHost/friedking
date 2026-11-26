'use client'

import { useEffect, useRef, useState } from 'react'
import { checkMp4, type Mp4Report } from '@/lib/mp4check'
import { createClient } from '@/lib/supabase/client'
import { ist, Loading, useDash, useLoad } from '../kit'

// Template names must match the ones approved in YCloud. A deleted name cannot be reused for about 30 days,
// so a re-written template gets a new name (friedking_promo_video was deleted and replaced by friedking_promo_v
// in Pandeshwar and Falnir).
// usesName: the template text has {{1}} for the customer's name. WhatsApp rejects the message (error 132000)
// when we send a name the template has no place for, or leave out one it needs. Staff can change it per branch.
const PRESETS: Array<{ name: string; label: string; kind: 'image' | 'video'; usesName: boolean }> = [
  { name: 'friedking_promo_en', label: 'Promotion with image (friedking_promo_en)', kind: 'image', usesName: true },
  { name: 'friedking_promo_v', label: 'Promotion with video (friedking_promo_v)', kind: 'video', usesName: false },
]

interface CampaignStats { total: number; waiting: number; sent: number; delivered: number; read: number; failed: number; top_error: string | null }
interface BlastData {
  eligible: number; sentThisMonth: number; cap: number; headerImage: string; headerVideo: string; template: string; nameParams?: Record<string, boolean>
  campaigns: Array<{ id: string; template_name: string | null; audience: string; status: string; recipient_count: number; created_by_name: string | null; created_at: string }>
  campaignStats?: Record<string, CampaignStats>
}

/** Turns WhatsApp / YCloud error text into something staff can act on. */
function reason(err: string | null) {
  const e = err ?? ''
  if (/131049/.test(e)) return 'WhatsApp limited marketing messages to this person'
  if (/132000|localizable_params/.test(e)) return /expected number of params \(0\)/.test(e)
    ? 'This template has no {{1}}: untick "uses the customer\'s name" and send again'
    : 'This template needs {{1}} (the name): tick "uses the customer\'s name" and send again'
  if (/131026/.test(e)) return 'Number not on WhatsApp or cannot receive'
  if (/131047|24 hours|re-engagement/i.test(e)) return 'Outside the 24-hour window'
  if (/TEMPLATE_UNAVAILABLE|Template not found|132001/i.test(e)) return 'Template not approved / not found'
  if (/131053|media|download/i.test(e)) return 'WhatsApp could not use the image or video'
  return e.slice(0, 120)
}

function CampaignStatus({ s, fallback }: { s?: CampaignStats; fallback: string }) {
  if (!s) return <>{fallback}</>
  const parts: Array<[number, string, string]> = [
    [s.read, 'read', '#1f8a4c'], [s.delivered, 'delivered', '#1f8a4c'], [s.sent, 'sent', '#555'],
    [s.waiting, 'waiting', '#c9821a'], [s.failed, 'failed', '#c0392b'],
  ]
  return (
    <div>
      {parts.filter(([n]) => n > 0).map(([n, label, color], i) => <span key={label} style={{ color, fontWeight: 600 }}>{i ? ' · ' : ''}{n} {label}</span>)}
      {s.failed > 0 && s.top_error && <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>{reason(s.top_error)}</div>}
    </div>
  )
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
  const [videoReport, setVideoReport] = useState<Mp4Report | null>(null)
  const [custom, setCustom] = useState(false)
  const [customKind, setCustomKind] = useState<'image' | 'video' | null>(null)
  const [nameChoice, setNameChoice] = useState<Record<string, boolean>>({})
  const [result, setResult] = useState<React.ReactNode>(null)
  if (!data) return <Loading error={error} onRetry={reload} />

  // The last-used name is remembered per branch; the deleted friedking_promo_video now means friedking_promo_v.
  const tpl = template ?? (data.template === 'friedking_promo_video' ? 'friedking_promo_v' : data.template)
  const preset = custom ? undefined : PRESETS.find((p) => p.name === tpl)
  const isCustom = !preset
  // Header type: from the preset, or chosen for an "Other" template (guessed from the name until chosen).
  const asVideo = preset ? preset.kind === 'video' : (customKind ?? (/video/i.test(tpl) ? 'video' : 'image')) === 'video'
  // Does this template's text have {{1}} for the name? This screen's choice, else this branch's last choice, else the preset.
  const usesName = nameChoice[tpl] ?? data.nameParams?.[tpl] ?? preset?.usesName ?? true
  const vid = video ?? data.headerVideo
  const hdr = asVideo ? vid : (header ?? data.headerImage)
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
    if (!/\.mp4$/i.test(f.name) && f.type !== 'video/mp4') { toast('Please choose an MP4 video'); return }
    setUploading(true)
    try {
      // WhatsApp never tells us when a phone cannot play a video, so check the file first.
      const report = await checkMp4(f).catch(() => null)
      setVideoReport(report)
      if (report?.errors.length) { toast('This video will not work on WhatsApp: see the notes below'); return }
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
      const r = await api.post<{ queued: number }>('blast', 'send', { filter, templateName: tpl, headerImage: hdr, headerType: asVideo ? 'video' : 'image', useName: usesName, phones })
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
        {isCustom && <>
          <input className="f" placeholder="Approved template name" value={tpl} onChange={(e) => setTemplate(e.target.value)} />
          <label className="lbl">This template&apos;s header is</label>
          <select className="f" value={asVideo ? 'video' : 'image'} onChange={(e) => setCustomKind(e.target.value as 'image' | 'video')}>
            <option value="image">an image</option><option value="video">a video</option>
          </select>
        </>}
        <label style={{ display: 'flex', gap: 8, alignItems: 'center', margin: '4px 0 12px', fontSize: 14, cursor: 'pointer' }}>
          <input type="checkbox" className="cbox" checked={usesName} onChange={(e) => setNameChoice({ ...nameChoice, [tpl]: e.target.checked })} />
          <span>The template text uses the customer&apos;s name (<code>{'{{1}}'}</code>, e.g. &quot;Hi {'{{1}}'}&quot;). Untick if the text has no <code>{'{{1}}'}</code>.</span>
        </label>
        {asVideo ? <>
          <label className="lbl">Header video (MP4, up to 16 MB)</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <input className="f" style={{ flex: 1, minWidth: 220 }} placeholder="https://… .mp4" value={vid} onChange={(e) => setVideo(e.target.value)} />
            <label className="btn" style={{ width: 'auto', padding: '10px 16px', cursor: 'pointer', height: 'fit-content' }}>{uploading ? 'Uploading…' : 'Upload video'}<input type="file" hidden accept="video/mp4" onChange={(e) => { void uploadVideo(e.target.files?.[0]); e.target.value = '' }} /></label>
          </div>
          {videoReport && <div className={videoReport.errors.length ? 'err' : videoReport.warnings.length ? 'note' : 'selinfo'} style={{ margin: '8px 0' }}>
            <div style={{ fontWeight: 600 }}>{videoReport.errors.length ? '⛔ This video will not work on WhatsApp' : videoReport.warnings.length ? '✓ Uploaded. Tip: send a test to your own number first' : '✓ Video looks good for WhatsApp'}</div>
            <div style={{ fontSize: 12, marginTop: 2 }}>{videoReport.info}</div>
            {[...videoReport.errors, ...videoReport.warnings].map((m) => <div key={m} style={{ fontSize: 13, marginTop: 4 }}>• {m}</div>)}
          </div>}
          {vid && <video src={vid} controls preload="metadata" style={{ maxWidth: 260, maxHeight: 160, borderRadius: 8, border: '1px solid #eee', display: 'block', margin: '8px 0' }} />}
          <div style={{ fontSize: 12, color: 'var(--muted)', margin: '4px 0 12px' }}>
            Video templates need the video on every send: Meta treats the one you submitted with the template as a sample only. Use an MP4 (H.264 video, AAC audio) under 16 MB.{' '}
            <button style={{ textDecoration: 'underline' }} onClick={async () => { try { await api.post('blast', 'saveVideo', { url: vid }); toast('Saved') } catch (e) { toast(e instanceof Error ? e.message : 'Could not save') } }}>Save without sending</button>
          </div>
          <details className="fold" style={{ marginBottom: 12, border: '1px solid var(--line)', borderRadius: 10 }}>
            <summary style={{ padding: '10px 12px', fontWeight: 600, fontSize: 14 }}>How to fix a video that will not play</summary>
            <div style={{ fontSize: 13, lineHeight: 1.6, padding: '8px 2px' }}>
              <p>WhatsApp plays MP4 files with <b>H.264</b> video and <b>AAC</b> sound, up to <b>16 MB</b>. Phones are most reliable with <b>720×1280 (720p)</b>, Main profile, &quot;fast start&quot;. iPhone videos are usually HEVC and must be converted.</p>
              <p><b>Easiest (phone):</b> open the video in CapCut → Export → Resolution 720p, Frame rate 30 → save, then upload that file.</p>
              <p><b>Computer (free):</b> HandBrake → Preset &quot;Fast 720p30&quot; → tick &quot;Web Optimized&quot; → Format MP4 → Start.</p>
              <p><b>Computer (command):</b> <code style={{ fontSize: 11, wordBreak: 'break-all' }}>ffmpeg -i promo.mp4 -vf scale=720:1280 -c:v libx264 -profile:v main -level 3.1 -pix_fmt yuv420p -r 30 -b:v 1500k -maxrate 2000k -bufsize 3000k -c:a aac -b:a 128k -ac 2 -movflags +faststart promo_whatsapp.mp4</code></p>
              <p><b>Always test first:</b> pick your own number in Contacts and send to it. If the video opens on your phone, send to everyone. A phone that cannot play the video still counts as &quot;delivered&quot;, so the status below cannot catch this.</p>
            </div>
          </details>
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
          {data.campaigns.map((c) => <tr key={c.id}><td>{ist(c.created_at)}</td><td>{c.template_name}</td><td>{c.audience.replace('_', ' ')}</td><td>{c.recipient_count}</td><td><CampaignStatus s={data.campaignStats?.[c.id]} fallback={c.status} /></td><td>{c.created_by_name}</td></tr>)}
        </tbody></table></div></div>}
    </section>
  )
}
