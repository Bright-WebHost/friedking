'use client'

import { useEffect, useRef, useState } from 'react'
import { ist, Loading, phoneShort, Switch, useDash, useLoad, usePoll } from '../kit'

interface Session { id: string; phone: string; customer_name: string | null; last_message: string | null; last_message_at: string | null; unread_count: number; ai_enabled: boolean; ai_disabled_by: string | null }
interface Msg { id: string; direction: 'inbound' | 'outbound'; content: string; sender: string | null; delivery_status: string | null; created_at: string }

export default function Chat() {
  const { api, toast, staff } = useDash()
  const sessions = useLoad(() => api.get<{ sessions: Session[] }>('chat'), [api])
  const [cur, setCur] = useState<string | null>(null)
  const thread = useLoad(async () => (cur ? (await api.get<{ messages: Msg[] }>('chat', { phone: cur })).messages : []), [api, cur])
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  usePoll(() => { void sessions.reload(); if (cur) void thread.reload() }, 5000)
  useEffect(() => { box.current?.scrollTo(0, box.current.scrollHeight) }, [thread.data])

  if (!sessions.data) return <Loading error={sessions.error} onRetry={sessions.reload} />
  const list = sessions.data.sessions
  const s = list.find((x) => x.phone === cur)

  const open = async (phone: string) => {
    setCur(phone)
    await api.post('chat', 'read', { phone }).catch(() => undefined)
    void sessions.reload()
  }
  const send = async () => {
    if (!cur || !text.trim()) return
    setSending(true)
    try { await api.post('chat', 'reply', { phone: cur, message: text }); setText(''); void thread.reload(); void sessions.reload() }
    catch (e) { toast(e instanceof Error ? e.message : 'Message not queued') } finally { setSending(false) }
  }
  const toggleAi = async () => {
    if (!s) return
    try { await api.post('chat', 'ai', { phone: s.phone, enabled: !s.ai_enabled }); toast(s.ai_enabled ? 'AI paused: you are replying' : 'AI back on'); void sessions.reload() }
    catch (e) { toast(e instanceof Error ? e.message : 'Could not change AI') }
  }

  return (
    <>
      {!list.length && <div className="note">Conversations appear here once the WhatsApp connection (YCloud + n8n) is live. Staff replies typed here are queued and sent by n8n.</div>}
      <div className={`chat ${cur ? 'open' : ''}`}>
        <div className="sessions">
          {list.length ? list.map((x) => (
            <div key={x.id} className="s" aria-selected={x.phone === cur} onClick={() => void open(x.phone)}>
              {x.unread_count > 0 && <span className="unread">{x.unread_count}</span>}
              <b>{x.customer_name || phoneShort(x.phone)}</b>
              <small>{(x.last_message ?? '').slice(0, 42)}</small>
              {!x.ai_enabled && <span className="aioff">AI off · {x.ai_disabled_by || 'staff'}</span>}
            </div>
          )) : <div className="none">No conversations yet</div>}
        </div>
        <div className="thread">
          {cur && s ? <>
            <div className="thead">
              <div><button className="btn sm ghost" style={{ marginRight: 8 }} onClick={() => setCur(null)}>←</button><b>{s.customer_name || phoneShort(s.phone)}</b> <small style={{ color: 'var(--muted)' }}>{phoneShort(s.phone)}</small></div>
              <div className="tgl">AI <Switch on={s.ai_enabled} onClick={() => void toggleAi()} label="AI replies" /></div>
            </div>
            <div className="msgs" ref={box}>
              {(thread.data ?? []).length ? thread.data!.map((m) => (
                <div key={m.id} className={`m ${m.direction === 'inbound' ? 'in' : 'out'}`}>{m.content}
                  <small>{m.sender || (m.direction === 'inbound' ? 'Customer' : 'Bot')} · {ist(m.created_at)}{m.direction === 'outbound' && m.delivery_status === 'pending' ? ' · queued' : m.delivery_status === 'failed' ? ' · not sent' : ''}</small></div>
              )) : <div className="none">No messages</div>}
            </div>
            <div className="compose">
              <input placeholder={`Reply as ${staff.name}…`} value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void send() }} autoComplete="off" />
              <button className="btn sm" disabled={sending} onClick={() => void send()}>Send</button>
            </div>
          </> : <div className="none" style={{ margin: 12 }}>Pick a conversation</div>}
        </div>
      </div>
    </>
  )
}
