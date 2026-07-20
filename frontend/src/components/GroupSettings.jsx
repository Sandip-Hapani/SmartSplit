import { useState } from 'react'
import { api } from '../api'

export default function GroupSettings({ group, onChange }) {
  const [name, setName] = useState(group.name)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  const [busy, setBusy] = useState(false)

  const flash = (m) => { setSaved(m); setTimeout(() => setSaved(''), 2500) }

  const rename = async (e) => {
    e.preventDefault()
    if (!name.trim() || name.trim() === group.name) return
    setBusy(true); setError('')
    try {
      await api.updateGroup(group.id, { name: name.trim() })
      flash('Group renamed.')
      onChange()
    } catch (err) { setError(err.message) } finally { setBusy(false) }
  }

  const toggleSimplify = async () => {
    setError('')
    try {
      await api.updateGroup(group.id, { simplify_debts: !group.simplify_debts })
      onChange()
    } catch (err) { setError(err.message) }
  }

  return (
    <div className="stack">
      {error && <div className="error">{error}</div>}
      {saved && <div className="notice">{saved}</div>}

      <form onSubmit={rename} className="stack">
        <label>
          <span className="muted">Group name</span>
          <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} />
        </label>
        <button disabled={busy || !name.trim() || name.trim() === group.name}>Rename</button>
      </form>

      <div className="setting-row">
        <div>
          <strong>Simplify debts</strong>
          <p className="muted" style={{ margin: '2px 0 0' }}>
            {group.simplify_debts
              ? 'On — SmartSplit nets everything down to the fewest possible payments, even between people who never shared an expense.'
              : 'Off — everyone repays the person who actually paid. More transfers, but each one traces back to a real expense.'}
          </p>
        </div>
        <button type="button" role="switch" aria-checked={group.simplify_debts}
                className={`toggle${group.simplify_debts ? ' on' : ''}`}
                onClick={toggleSimplify}>
          <span className="knob" />
        </button>
      </div>

      <div>
        <strong>Members</strong>
        {group.members.map((m) => (
          <div className="list-item" key={m.id}>
            <span>{m.name}{m.username && <span className="muted"> @{m.username}</span>}</span>
            {m.id === group.created_by && <span className="pill">creator</span>}
          </div>
        ))}
      </div>
    </div>
  )
}
