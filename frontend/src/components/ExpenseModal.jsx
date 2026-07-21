import { useState } from 'react'
import { api, fmt } from '../api'
import CurrencySelect from './CurrencySelect'

const TYPES = [
  ['equal', 'Split equally'],
  ['exact', 'Exact amounts'],
  ['percent', 'Percentages'],
  ['shares', 'Shares'],
]

export default function ExpenseModal({ group, user, expense, onClose, onSaved }) {
  const editing = expense && expense.split_type !== 'itemized'
  const [description, setDescription] = useState(expense?.description || '')
  const [amount, setAmount] = useState(expense?.amount ?? '')
  const [ccy, setCcy] = useState(expense?.currency || group.default_currency || 'EUR')
  const [date, setDate] = useState(expense?.date || new Date().toISOString().slice(0, 10))
  const [paidBy, setPaidBy] = useState(expense?.paid_by ?? user.id)
  const [splitType, setSplitType] = useState(editing ? expense.split_type : 'equal')
  const [participants, setParticipants] = useState(
    () => new Set(
      editing && expense.split_type === 'equal'
        ? expense.splits.map((s) => s.user_id)
        : group.members.map((m) => m.id),
    ),
  )
  const [values, setValues] = useState(() => {
    const v = {}
    if (editing && expense.split_type !== 'equal') {
      for (const s of expense.splits) v[s.user_id] = s.amount
    }
    return v
  })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  // itemized expenses are edited via their own flow; block here
  if (expense && expense.split_type === 'itemized') {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <h3>Itemized expense</h3>
          <p>This expense came from a parsed bill. Delete it and re-upload the bill to change item assignments, or adjust via a correcting expense.</p>
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    )
  }

  const toggle = (id) => {
    const next = new Set(participants)
    next.has(id) ? next.delete(id) : next.add(id)
    setParticipants(next)
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    const amt = parseFloat(amount)
    if (!amt || amt <= 0) return setError('Enter a positive amount')
    const payload = {
      description, amount: amt, currency: ccy, date, paid_by: Number(paidBy), split_type: splitType,
    }
    if (splitType === 'equal') {
      if (participants.size === 0) return setError('Pick at least one participant')
      payload.participant_ids = [...participants]
    } else {
      payload.splits = group.members
        .filter((m) => values[m.id] !== undefined && values[m.id] !== '')
        .map((m) => ({ user_id: m.id, value: parseFloat(values[m.id]) || 0 }))
        .filter((s) => s.value > 0)
      if (payload.splits.length === 0) return setError('Enter values for at least one member')
    }
    setBusy(true)
    try {
      if (editing) await api.updateExpense(group.id, expense.id, payload)
      else await api.createExpense(group.id, payload)
      onSaved()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  const unitLabel = { exact: '€', percent: '%', shares: 'shares' }[splitType]

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <h3>{editing ? 'Edit expense' : 'Add expense'}</h3>
        <form onSubmit={submit}>
          <div className="field">
            <label>Description</label>
            <input value={description} required onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="row">
            <div className="field">
              <label>Amount (€)</label>
              <div className="amount-row">
              <input type="number" step="0.01" min="0.01" value={amount} required
                     onChange={(e) => setAmount(e.target.value)} />
              <CurrencySelect value={ccy} onChange={setCcy} />
              </div>
            </div>
            <div className="field">
              <label>Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <div className="field">
              <label>Paid by</label>
              <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                {group.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
              </select>
            </div>
          </div>
          <div className="field">
            <label>Split</label>
            <select value={splitType} onChange={(e) => setSplitType(e.target.value)}>
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          {splitType === 'equal' ? (
            <div className="split-grid">
              {group.members.map((m) => (
                <label key={m.id} className="row" style={{ gap: 6, gridColumn: '1 / -1' }}>
                  <input type="checkbox" checked={participants.has(m.id)} onChange={() => toggle(m.id)} />
                  {m.name}
                  {participants.has(m.id) && amount > 0 && (
                    <span className="muted">{fmt(parseFloat(amount) / participants.size, ccy)}</span>
                  )}
                </label>
              ))}
            </div>
          ) : (
            <div className="split-grid">
              {group.members.map((m) => (
                <div key={m.id} style={{ display: 'contents' }}>
                  <span>{m.name}</span>
                  <div className="row" style={{ gap: 4 }}>
                    <input type="number" step="0.01" min="0" style={{ width: 90 }}
                           value={values[m.id] ?? ''}
                           onChange={(e) => setValues({ ...values, [m.id]: e.target.value })} />
                    <span className="muted">{unitLabel}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          {error && <div className="error">{error}</div>}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button disabled={busy}>{editing ? 'Save' : 'Add'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}
