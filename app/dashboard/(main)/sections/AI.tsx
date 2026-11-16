'use client'

import { useEffect, useRef, useState } from 'react'
import { useDash } from '../kit'

interface Proposal { type: string; summary: string; needsPasscode?: boolean; [k: string]: unknown }
interface Msg { role: 'user' | 'assistant'; content: string; at: string; proposals?: Proposal[]; state?: 'done' | 'dismissed' }

const QUICK = [
  { ic: '💰', q: "What are today's sales?" },
  { ic: '📦', q: "What's running low on stock?" },
  { ic: '🍽️', q: 'Which tables are still open?' },
  { ic: '⭐', q: 'What are my best-selling items this week?' },
  { ic: '🛵', q: 'How much cash do riders still owe us?' },
  { ic: '👥', q: 'Who are my top customers?' },
  { ic: '➕', q: 'Add 10 kg chicken to stock' },
  { ic: '🚫', q: 'Mark Zinger Burger as sold out' },
]

/** Ask about sales, stock, tables and riders. Answers come from the branch's live data (read-only), through the same OpenAI model as the WhatsApp bot. */
export default function AI() {
  const { api, staff, slug } = useDash()
  const key = `fk_ai_${slug}`
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => { try { setMsgs((JSON.parse(localStorage.getItem(key) ?? '[]') as Msg[]).map((m) => (m.proposals && !m.state ? { ...m, state: 'dismissed' as const } : m))) } catch { /* no storage */ } }, [key])
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(msgs.slice(-30))) } catch { /* no storage */ } box.current?.scrollTo(0, box.current.scrollHeight) }, [msgs, key])

  const ask = async (q: string) => {
    const question = q.trim()
    if (!question || busy) return
    const next: Msg[] = [...msgs, { role: 'user', content: question, at: new Date().toISOString() }]
    setMsgs(next); setText(''); setBusy(true)
    try {
      const r = await api.post<{ reply: string; proposals: Proposal[] }>('ai', 'ask', { question, history: msgs.slice(-6).map((m) => ({ role: m.role, content: m.content })) })
      setMsgs([...next, { role: 'assistant', content: r.reply, at: new Date().toISOString(), ...(r.proposals?.length ? { proposals: r.proposals } : {}) }])
    } catch (e) {
      setMsgs([...next, { role: 'assistant', content: e instanceof Error ? e.message : 'Something went wrong. Try again.', at: new Date().toISOString() }])
    } finally { setBusy(false) }
  }

  const [code, setCode] = useState('')
  const confirm = async (i: number) => {
    const m = msgs[i]
    if (!m.proposals || busy) return
    setBusy(true)
    try {
      const r = await api.post<{ summary: string }>('ai', 'execute', { actions: m.proposals, passcode: code })
      setCode('')
      setMsgs((cur) => [...cur.map((x, k) => (k === i ? { ...x, state: 'done' as const } : x)), { role: 'assistant', content: `✅ Done: ${r.summary}`, at: new Date().toISOString() }])
      window.dispatchEvent(new Event('fk-orders-changed'))
    } catch (e) {
      setMsgs((cur) => [...cur, { role: 'assistant', content: `⚠️ ${e instanceof Error ? e.message : 'Could not do that.'}`, at: new Date().toISOString() }])
    } finally { setBusy(false) }
  }
  const dismiss = (i: number) => setMsgs((cur) => cur.map((x, k) => (k === i ? { ...x, state: 'dismissed' as const } : x)))

  return (
    <div className="aipanel">
      <div className="aihead">
        <div className="aihead-ic">🤖</div>
        <div style={{ flex: 1 }}><h2>AI Assistant</h2><p>Ask about sales, stock, tables and riders, or tell it what to do (add stock, sold out, accept an order, free delivery…). It always asks you to confirm before changing anything.</p></div>
        {msgs.length > 0 && <button className="btn sm ghost" onClick={() => setMsgs([])}>Clear</button>}
      </div>
      <div className="aimsgs" ref={box}>
        {!msgs.length && !busy ? (
          <div className="aiempty">
            <div className="aiempty-ic">🤖</div>
            <h3>Hi {staff.name.split(' ')[0]}, how can I help?</h3>
            <p>Try one of these, or type your own question.</p>
            <div className="aicards">{QUICK.map((x) => <button key={x.q} className="aicard" onClick={() => void ask(x.q)}><b>{x.ic}</b>{x.q}</button>)}</div>
          </div>
        ) : (
          <>
            {msgs.map((m, i) => (
              <div key={i} className={`aim ${m.role === 'user' ? 'out' : 'in'}`}>
                {m.content}
                {m.proposals && (
                  <div className="aiact">
                    {m.proposals.map((p, k) => <b key={k}>{p.summary}</b>)}
                    {!m.state && <>
                      {m.proposals.some((p) => p.needsPasscode) && <input className="f2" type="password" inputMode="numeric" placeholder="Passcode" value={code} onChange={(e) => setCode(e.target.value)} />}
                      <div className="aiactbtns">
                        <button className="btn sm go" disabled={busy || (m.proposals.some((p) => p.needsPasscode) && !code)} onClick={() => void confirm(i)}>Confirm</button>
                        <button className="btn sm ghost" disabled={busy} onClick={() => dismiss(i)}>Cancel</button>
                      </div>
                    </>}
                    {m.state === 'done' && <span className="aistate ok">Done</span>}
                    {m.state === 'dismissed' && <span className="aistate">Not done</span>}
                  </div>
                )}
              </div>
            ))}
            {busy && <div className="aim in"><span className="aityping"><span /><span /><span /></span></div>}
          </>
        )}
      </div>
      {msgs.length > 0 && <div className="aiqq">{QUICK.map((x) => <button key={x.q} className="aiqchip" disabled={busy} onClick={() => void ask(x.q)}>{x.ic} {x.q}</button>)}</div>}
      <div className="aicompose">
        <input value={text} placeholder="Type a question…" autoComplete="off" disabled={busy} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') void ask(text) }} />
        <button className="btn sm" disabled={busy || !text.trim()} onClick={() => void ask(text)}>Send</button>
      </div>
    </div>
  )
}
