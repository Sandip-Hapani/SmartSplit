import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'

/** Shared notes everyone in the group can read and add to. */
export default function Whiteboard({ groupId, user }) {
  const [notes, setNotes] = useState([])
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(null)
  const [editBody, setEditBody] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    api.notes(groupId).then(setNotes).catch((e) => setError(e.message))
  }, [groupId])

  useEffect(() => { load() }, [load])

  const add = async (e) => {
    e.preventDefault()
    const body = draft.trim()
    if (!body) return
    setBusy(true); setError('')
    try {
      setNotes([await api.addNote(groupId, body), ...notes])
      setDraft('')
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const saveEdit = async (note) => {
    const body = editBody.trim()
    if (!body) return
    try {
      const updated = await api.editNote(groupId, note.id, body)
      setNotes(notes.map((n) => (n.id === note.id ? updated : n)))
      setEditing(null)
    } catch (err) { setError(err.message) }
  }

  const remove = async (note) => {
    if (!confirm('Delete this note?')) return
    try {
      await api.deleteNote(groupId, note.id)
      setNotes(notes.filter((n) => n.id !== note.id))
    } catch (err) { setError(err.message) }
  }

  const when = (iso) =>
    new Date(iso + (iso.endsWith('Z') ? '' : 'Z'))
      .toLocaleString([], { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <>
      <p className="muted" style={{ marginTop: 0 }}>
        Shared notes for everyone in this group — packing lists, reminders, house rules.
      </p>
      <form className="row" onSubmit={add}>
        <input value={draft} placeholder="Write a note for the group…" maxLength={4000}
               onChange={(e) => setDraft(e.target.value)} />
        <button disabled={busy || !draft.trim()}>Post</button>
      </form>
      {error && <div className="error">{error}</div>}

      {notes.length === 0 && <p className="muted">The whiteboard is empty.</p>}
      <div className="notes">
        {notes.map((n) => (
          <div className="note" key={n.id}>
            {editing === n.id ? (
              <>
                <textarea value={editBody} rows={3} onChange={(e) => setEditBody(e.target.value)} />
                <div className="row">
                  <button onClick={() => saveEdit(n)}>Save</button>
                  <button className="ghost" onClick={() => setEditing(null)}>Cancel</button>
                </div>
              </>
            ) : (
              <>
                <div className="note-body">{n.body}</div>
                <div className="row spread note-meta">
                  <span className="muted">
                    {n.author_name} · {when(n.created_at)}
                    {n.updated_at && ' · edited'}
                  </span>
                  {n.user_id === user.id && (
                    <span className="row">
                      <button className="ghost" onClick={() => { setEditing(n.id); setEditBody(n.body) }}>
                        Edit
                      </button>
                      <button className="ghost danger" onClick={() => remove(n)}>Delete</button>
                    </span>
                  )}
                </div>
              </>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
