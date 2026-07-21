import { useMemo, useState } from 'react'
import { api, fmt, symbolOf } from '../api'
import CurrencySelect from './CurrencySelect'
import PaidByField, { payersFromExpense, payersToPayload } from './PaidByField'
import ItemMatrix, {
  emptyItem, itemsFromExpense, itemsToPayload, useItemTotals,
} from './ItemMatrix'

const TYPES = [
  ['equal', 'Split equally'],
  ['exact', 'Exact amounts'],
  ['percent', 'Percentages'],
  ['shares', 'Shares'],
  ['itemized', 'By product'],
]

/**
 * Splits are stored as money, so editing a percent or shares expense has to work
 * back to the numbers that were typed. Percentages recover exactly; shares
 * recover proportionally, which yields the identical split.
 */
function initialValues(expense) {
  const v = {}
  if (!expense || expense.split_type === 'equal' || expense.split_type === 'itemized') return v
  const total = expense.amount || 0
  for (const s of expense.splits) {
    if (expense.split_type === 'percent') {
      v[s.user_id] = total ? Math.round((s.amount / total) * 10000) / 100 : 0
    } else {
      v[s.user_id] = s.amount
    }
  }
  return v
}

export default function ExpenseModal({ group, user, expense, onClose, onSaved }) {
  const editing = Boolean(expense)
  const members = group.members

  const [description, setDescription] = useState(expense?.description || '')
  const [amount, setAmount] = useState(expense?.amount ?? '')
  const [ccy, setCcy] = useState(expense?.currency || group.default_currency || 'EUR')
  const [date, setDate] = useState(expense?.date || new Date().toISOString().slice(0, 10))
  const [paidBy, setPaidBy] = useState(expense?.paid_by ?? user.id)
  const [payers, setPayers] = useState(() => payersFromExpense(expense))
  const [splitType, setSplitType] = useState(expense?.split_type || 'equal')
  const [participants, setParticipants] = useState(
    () => new Set(
      expense && expense.split_type === 'equal'
        ? expense.splits.map((s) => s.user_id)
        : members.map((m) => m.id),
    ),
  )
  const [values, setValues] = useState(() => initialValues(expense))
  const [items, setItems] = useState(() => itemsFromExpense(expense))
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const itemTotals = useItemTotals(items, members)
  const isItemized = splitType === 'itemized'
  // an itemized expense's amount is the sum of its rows, never typed directly
  const effectiveAmount = isItemized ? itemTotals.sum : parseFloat(amount) || 0

  const toggle = (id) => {
    const next = new Set(participants)
    next.has(id) ? next.delete(id) : next.add(id)
    setParticipants(next)
  }

  /** Seed rows when switching an existing expense over to per-product splitting. */
  const changeSplitType = (next) => {
    setError('')
    if (next === 'itemized' && items.length === 0) {
      const seed = emptyItem(members)
      seed.name = description || 'Item 1'
      seed.total = parseFloat(amount) || 0
      setItems([seed])
    }
    setSplitType(next)
  }

  const submit = async (e) => {
    e.preventDefault()
    setError('')

    const payload = {
      description,
      amount: effectiveAmount,
      currency: ccy,
      date,
      split_type: splitType,
      notes: expense?.notes || '',
    }

    const multi = payersToPayload(payers)
    if (multi) {
      if (multi.length === 0) return setError('Enter what each person paid')
      const paid = multi.reduce((a, p) => a + p.amount, 0)
      if (Math.abs(paid - effectiveAmount) > 0.011) {
        return setError(
          `Payments add up to ${paid.toFixed(2)} but the expense is ${effectiveAmount.toFixed(2)}`)
      }
      payload.payers = multi
    } else {
      payload.paid_by = Number(paidBy)
    }

    if (isItemized) {
      if (items.length === 0) return setError('Add at least one product')
      const orphan = items.find(
        (it) => it.included.size === 0 && (parseFloat(it.total) || 0) !== 0)
      if (orphan) {
        return setError(`"${orphan.name}" has nobody ticked — tick someone or remove the row.`)
      }
      payload.items = itemsToPayload(items)
      if (payload.items.length === 0) return setError('Every product was removed')
      if (payload.amount <= 0) return setError('Product totals add up to zero')
    } else {
      if (!effectiveAmount || effectiveAmount <= 0) return setError('Enter a positive amount')
      if (splitType === 'equal') {
        if (participants.size === 0) return setError('Pick at least one participant')
        payload.participant_ids = [...participants]
      } else {
        payload.splits = members
          .filter((m) => values[m.id] !== undefined && values[m.id] !== '')
          .map((m) => ({ user_id: m.id, value: parseFloat(values[m.id]) || 0 }))
          .filter((s) => s.value > 0)
        if (payload.splits.length === 0) return setError('Enter values for at least one member')
      }
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

  const unitLabel = { exact: symbolOf(ccy), percent: '%', shares: 'shares' }[splitType]
  const entered = useMemo(
    () => members.reduce((a, m) => a + (parseFloat(values[m.id]) || 0), 0),
    [values, members],
  )

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: isItemized ? 880 : 560 }}
           onClick={(e) => e.stopPropagation()}>
        <h3>{editing ? 'Edit expense' : 'Add expense'}</h3>
        <form onSubmit={submit}>
          <div className="field">
            <label>Description</label>
            <input value={description} required onChange={(e) => setDescription(e.target.value)} />
          </div>
          <div className="row">
            <div className="field">
              <label>Amount</label>
              <div className="amount-row">
                {isItemized ? (
                  <input value={itemTotals.sum.toFixed(2)} readOnly
                         title="Adds up from the product rows below" />
                ) : (
                  <input type="number" step="0.01" min="0.01" value={amount} required
                         onChange={(e) => setAmount(e.target.value)} />
                )}
                <CurrencySelect value={ccy} onChange={setCcy} />
              </div>
            </div>
            <div className="field">
              <label>Date</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>
            <PaidByField members={members} paidBy={paidBy} setPaidBy={setPaidBy}
                         payers={payers} setPayers={setPayers}
                         amount={effectiveAmount} currency={ccy} />
          </div>
          <div className="field">
            <label>Split</label>
            <select value={splitType} onChange={(e) => changeSplitType(e.target.value)}>
              {TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
          </div>

          {isItemized ? (
            <>
              <ItemMatrix items={items} setItems={setItems} members={members} currency={ccy} />
              <div className="row" style={{ marginTop: 8 }}>
                <button type="button" className="secondary"
                        onClick={() => setItems([...items, emptyItem(members)])}>
                  + Add product
                </button>
              </div>
            </>
          ) : splitType === 'equal' ? (
            <div className="split-grid">
              {members.map((m) => (
                <label key={m.id} className="row" style={{ gap: 6, gridColumn: '1 / -1' }}>
                  <input type="checkbox" checked={participants.has(m.id)}
                         onChange={() => toggle(m.id)} />
                  {m.name}
                  {participants.has(m.id) && effectiveAmount > 0 && (
                    <span className="muted">{fmt(effectiveAmount / participants.size, ccy)}</span>
                  )}
                </label>
              ))}
            </div>
          ) : (
            <>
              <div className="split-grid">
                {members.map((m) => (
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
              <p className="muted" style={{ margin: '6px 0 0' }}>
                {splitType === 'exact'
                  && `Entered ${fmt(entered, ccy)} of ${fmt(effectiveAmount, ccy)}`}
                {splitType === 'percent' && `Entered ${entered.toFixed(1)}% of 100%`}
                {splitType === 'shares' && `${entered} share${entered === 1 ? '' : 's'} total`}
              </p>
            </>
          )}

          {error && <div className="error">{error}</div>}
          <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
            <button type="button" className="secondary" onClick={onClose}>Cancel</button>
            <button disabled={busy}>
              {editing ? 'Save' : 'Add'} ({fmt(effectiveAmount, ccy)})
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
