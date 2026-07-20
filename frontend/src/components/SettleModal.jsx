import { useState } from 'react'
import { api, fmt } from '../api'

export default function SettleModal({ group, user, transfers, onClose, onSaved }) {
  const suggestion = transfers.find((t) => t.from_user === user.id) || transfers[0]
  const [fromUser, setFromUser] = useState(suggestion?.from_user ?? user.id)
  const [toUser, setToUser] = useState(
    suggestion?.to_user ?? group.members.find((m) => m.id !== user.id)?.id ?? user.id,
  )
  const [amount, setAmount] = useState(suggestion?.amount ?? '')
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api.settle(group.id, {
        from_user: Number(fromUser), to_user: Number(toUser), amount: parseFloat(amount),
      })
      onSaved()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>Record a payment</h3>
        {transfers.length > 0 && (
          <p className="muted">
            Suggested: {transfers.map((t) => `${t.from_name} → ${t.to_name} ${fmt(t.amount)}`).join(' · ')}
          </p>
        )}
        <form onSubmit={submit}>
          <div className="row">
            <div className="field">
              <label>Who paid</label>
              <select value={fromUser} onChange={(e) => setFromUser(e.target.value)}>
                {group.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Received by</label>
              <select value={toUser} onChange={(e) => setToUser(e.target.value)}>
                {group.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Amount (€)</label>
              <input type="number" step="0.01" min="0.01" required value={amount}
                     onChange={(e) => setAmount(e.target.value)} />
            </div>
          </div>
          {error && <div className="error">{error}</div>}
          <div className="row" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button>Record</button>
          </div>
        </form>
      </div>
    </div>
  )
}
