import { useEffect, useState } from 'react'
import { api, fmt } from '../api'

export default function RecurringTab({ groupId, group, onChange }) {
  const [rows, setRows] = useState([])
  const [description, setDescription] = useState('')
  const [amount, setAmount] = useState('')
  const [paidBy, setPaidBy] = useState(group.members[0]?.id)
  const [frequency, setFrequency] = useState('monthly')
  const [nextDate, setNextDate] = useState(new Date().toISOString().slice(0, 10))
  const [error, setError] = useState('')

  const load = () => api.recurring(groupId).then(setRows).catch((e) => setError(e.message))
  useEffect(() => { load() }, [groupId])

  const create = async (e) => {
    e.preventDefault()
    setError('')
    try {
      await api.createRecurring(groupId, {
        description, amount: parseFloat(amount), paid_by: Number(paidBy),
        frequency, next_date: nextDate,
      })
      setDescription(''); setAmount('')
      load(); onChange()
    } catch (err) {
      setError(err.message)
    }
  }

  const stop = async (id) => {
    await api.deleteRecurring(groupId, id)
    load()
  }

  return (
    <>
      <p className="muted">Recurring expenses are split equally among all members and added automatically when due.</p>
      {rows.filter((r) => r.active).map((r) => (
        <div className="list-item" key={r.id}>
          <div>
            <strong>{r.description}</strong>
            <div className="muted">{r.frequency} · next on {r.next_date} · paid by {r.payer_name}</div>
          </div>
          <div className="row">
            <strong>{fmt(r.amount)}</strong>
            <button className="danger" onClick={() => stop(r.id)}>Stop</button>
          </div>
        </div>
      ))}
      <form className="row" style={{ marginTop: 14 }} onSubmit={create}>
        <input placeholder="Description (e.g. Rent)" required value={description}
               onChange={(e) => setDescription(e.target.value)} />
        <input type="number" placeholder="€" step="0.01" min="0.01" required style={{ width: 90 }}
               value={amount} onChange={(e) => setAmount(e.target.value)} />
        <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
          {group.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <select value={frequency} onChange={(e) => setFrequency(e.target.value)}>
          <option value="monthly">Monthly</option>
          <option value="weekly">Weekly</option>
        </select>
        <input type="date" value={nextDate} onChange={(e) => setNextDate(e.target.value)} />
        <button>Add recurring</button>
      </form>
      {error && <div className="error">{error}</div>}
    </>
  )
}
