import { useEffect, useRef, useState } from 'react'
import { api } from '../api'

const POLL_MS = 5000

export default function Chat({ friend, onBack }) {
  const [messages, setMessages] = useState([])
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [sending, setSending] = useState(false)
  const endRef = useRef(null)
  const listRef = useRef(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const rows = await api.messages(friend.id)
        if (alive) setMessages(rows)
      } catch (e) {
        if (alive) setError(e.message)
      }
    }
    tick()
    const t = setInterval(tick, POLL_MS)
    return () => { alive = false; clearInterval(t) }
  }, [friend.id])

  // stay pinned to the newest message unless the user scrolled up to read
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 120
    if (nearBottom) endRef.current?.scrollIntoView({ block: 'end' })
  }, [messages])

  const send = async (e) => {
    e.preventDefault()
    const body = draft.trim()
    if (!body || sending) return
    setSending(true)
    setError('')
    try {
      const sent = await api.sendMessage(friend.id, body)
      setMessages((m) => [...m, sent])
      setDraft('')
      endRef.current?.scrollIntoView({ block: 'end' })
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
    }
  }

  const stamp = (iso) =>
    new Date(iso + (iso.endsWith('Z') ? '' : 'Z'))
      .toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="page chat-page">
      <div className="card chat-card">
        <div className="chat-head">
          <button className="ghost" onClick={onBack}>← Back</button>
          <div className="row" style={{ gap: 8 }}>
            {friend.avatar_url
              ? <img className="avatar" src={friend.avatar_url} alt="" />
              : <span className="avatar initials">{friend.name[0].toUpperCase()}</span>}
            <div>
              <strong>{friend.name}</strong>
              {friend.username && <div className="muted">@{friend.username}</div>}
            </div>
          </div>
        </div>

        <div className="chat-log" ref={listRef}>
          {messages.length === 0 && (
            <p className="muted" style={{ textAlign: 'center' }}>
              No messages yet — say hello.
            </p>
          )}
          {messages.map((m) => (
            <div key={m.id} className={`bubble ${m.mine ? 'mine' : 'theirs'}`}>
              <div>{m.body}</div>
              <div className="stamp">{stamp(m.created_at)}</div>
            </div>
          ))}
          <div ref={endRef} />
        </div>

        {error && <div className="error">{error}</div>}
        <form className="chat-compose" onSubmit={send}>
          <input value={draft} placeholder="Write a message…" maxLength={2000}
                 onChange={(e) => setDraft(e.target.value)} />
          <button disabled={sending || !draft.trim()}>Send</button>
        </form>
        <p className="muted" style={{ margin: '6px 0 0' }}>Text only — no attachments.</p>
      </div>
    </div>
  )
}
