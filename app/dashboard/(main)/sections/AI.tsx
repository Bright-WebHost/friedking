'use client'

import { useEffect, useRef, useState } from 'react'
import { useDash } from '../kit'

interface Msg { role: 'user' | 'assistant'; content: string; at: string }

const QUICK = [
  { ic: '💰', q: "What are today's sales?" },
  { ic: '📦', q: "What's running low on stock?" },
  { ic: '🍽️', q: 'Which tables are still open?' },
  { ic: '⭐', q: 'What are my best-selling items this week?' },
  { ic: '🛵', q: 'How much cash do riders still owe us?' },
  { ic: '👥', q: 'Who are my top customers?' },
]

/** Ask about sales, stock, tables and riders. Answers come from the branch's live data (read-only), through the same OpenAI model as the WhatsApp bot. */
export default function AI() {
  const { api, staff, slug } = useDash()
  const key = `fk_ai_${slug}`
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => { try { setMsgs(JSON.parse(localStorage.getItem(key) ?? '[]')) } catch { /* no storage */ } }, [key])
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(msgs.slice(-30))) } catch { /* no storage */ } box.current?.scrollTo(0, box.current.scrollHeight) }, [msgs, key])

  const ask = async (q: string) => {
    const question = q.trim()
    if (!question || busy) return
    const next: Msg[] = [...msgs, { role: 'user', content: question, at: new Date().toISOString() }]
    setMsgs(next); setText(''); setBusy(true)
    try {
      const r = await api.post<{ reply: string }>('ai', 'ask', { question, history: msgs.slice(-6).map((m) => ({ role: m.role, content: m.content })) })
      setMsgs([...next, { role: 'assistant', content: r.reply, at: new Date().toISOString() }])
    } catch (e) {
      setMsgs([...next, { role: 'assistant', content: e instanceof Error ? e.message : 'Something went wrong. Try again.', at: new Date().toISOString() }])
    } finally { setBusy(false) }
  }

  return (
    <div className="aipanel">
      <div className="aihead">
        <div className="aihead-ic">🤖</div>
        <div style={{ flex: 1 }}><h2>AI Assistant</h2><p>Ask about sales, stock, tables and riders. It reads your live data and cannot change anything.</p></div>
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
            {msgs.map((m, i) => <div key={i} className={`aim ${m.role === 'user' ? 'out' : 'in'}`}>{m.content}</div>)}
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
