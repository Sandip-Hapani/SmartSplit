import { useMemo, useState } from 'react'
import { api, fmt, symbolOf } from '../api'
import CurrencySelect from './CurrencySelect'
import Sheet from './Sheet'
import { payersFromExpense, payersToPayload } from './PaidByField'
import ItemMatrix, {
  emptyItem, itemsFromExpense, itemsToPayload, useItemTotals,
} from './ItemMatrix'

const TYPES = [
  ['equal', 'split equally', 'Everyone in the split pays the same.'],
  ['exact', 'split by exact amounts', 'Type what each person owes.'],
  ['percent', 'split by percentage', 'Shares must add up to 100%.'],
  ['shares', 'split by shares', 'Weights, e.g. 2 shares vs 1.'],
  ['itemized', 'split by product', 'Tick who shares each line of the bill.'],
]

const LABEL = Object.fromEntries(TYPES.map(([v, l]) => [v, l]))

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
    v[s.user_id] = expense.split_type === 'percent'
      ? (total ? Math.round((s.amount / total) * 10000) / 100 : 0)
      : s.amount
  }
  return v
}

const firstName = (n) => (n || '').split(' ')[0]

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
  const [sheet, setSheet] = useState(null)          // 'payer' | 'split' | null
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const itemTotals = useItemTotals(items, members)
  const isItemized = splitType === 'itemized'
  const total = isItemized ? itemTotals.sum : parseFloat(amount) || 0
  const ready = description.trim() !== '' && total > 0

  const nameOf = (id) => {
    const m = members.find((x) => x.id === id)
    return id === user.id ? 'you' : firstName(m?.name) || 'someone'
  }

  /** "you", "you and Maya", "3 people" — the sentence fragment after "Paid by". */
  const payerLabel = () => {
    if (!payers) return nameOf(Number(paidBy))
    const ids = Object.keys(payers).map(Number)
    if (ids.length === 0) return 'nobody yet'
    if (ids.length === 1) return nameOf(ids[0])
    if (ids.length === 2) return `${nameOf(ids[0])} and ${nameOf(ids[1])}`
    return `${ids.length} people`
  }

  const splitLabel = () => {
    if (splitType === 'equal') {
      const n = participants.size
      return n === members.length ? 'split equally' : `split between ${n}`
    }
    return LABEL[splitType]
  }

  const toggleParticipant = (id) => {
    const next = new Set(participants)
    next.has(id) ? next.delete(id) : next.add(id)
    setParticipants(next)
  }

  const chooseSplit = (next) => {
    if (next === 'itemized' && items.length === 0) {
      const seed = emptyItem(members)
      seed.name = description || 'Item 1'
      seed.total = parseFloat(amount) || 0
      setItems([seed])
    }
    setSplitType(next)
  }

  // ---- payer sheet state -------------------------------------------------
  const paidEntered = useMemo(
    () => Object.values(payers || {}).reduce((a, v) => a + (parseFloat(v) || 0), 0),
    [payers],
  )
  const remaining = Math.round((total - paidEntered) * 100) / 100

  const enableMultiPayer = () => setPayers({ [paidBy]: total ? String(total) : '' })
  const setPayerAmount = (id, v) => setPayers({ ...payers, [id]: v })
  const togglePayer = (id) => {
    const next = { ...payers }
    if (id in next) delete next[id]
    else next[id] = ''
    setPayers(next)
  }
  const giveRest = (id) => {
    const others = Object.entries(payers)
      .filter(([k]) => Number(k) !== id)
      .reduce((a, [, v]) => a + (parseFloat(v) || 0), 0)
    setPayerAmount(id, String(Math.round((total - others) * 100) / 100))
  }

  const enteredSplit = useMemo(
    () => members.reduce((a, m) => a + (parseFloat(values[m.id]) || 0), 0),
    [values, members],
  )

  // ---- save --------------------------------------------------------------
  const submit = async (e) => {
    e?.preventDefault()
    setError('')

    const payload = {
      description: description.trim(),
      amount: total,
      currency: ccy,
      date,
      split_type: splitType,
      notes: expense?.notes || '',
    }

    const multi = payersToPayload(payers)
    if (multi) {
      if (multi.length === 0) return setError('Enter what each person paid')
      const paid = multi.reduce((a, p) => a + p.amount, 0)
      if (Math.abs(paid - total) > 0.011) {
        setSheet('payer')
        return setError(
          `Payments add up to ${fmt(paid, ccy)} but the expense is ${fmt(total, ccy)}`)
      }
      payload.payers = multi
    } else {
      payload.paid_by = Number(paidBy)
    }

    if (isItemized) {
      const orphan = items.find(
        (it) => it.included.size === 0 && (parseFloat(it.total) || 0) !== 0)
      if (orphan) {
        setSheet('split')
        return setError(`"${orphan.name}" has nobody ticked`)
      }
      payload.items = itemsToPayload(items)
      if (payload.items.length === 0) { setSheet('split'); return setError('Add at least one product') }
    } else if (splitType === 'equal') {
      if (participants.size === 0) { setSheet('split'); return setError('Pick at least one person') }
      payload.participant_ids = [...participants]
    } else {
      payload.splits = members
        .filter((m) => values[m.id] !== undefined && values[m.id] !== '')
        .map((m) => ({ user_id: m.id, value: parseFloat(values[m.id]) || 0 }))
        .filter((s) => s.value > 0)
      if (payload.splits.length === 0) { setSheet('split'); return setError('Enter the split values') }
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

  const unit = { exact: symbolOf(ccy), percent: '%', shares: 'shares' }[splitType]

  return (
    <div className="xp-backdrop" onClick={onClose}>
      <div className="xp" onClick={(e) => e.stopPropagation()}>
        <header className="xp-head">
          <button type="button" className="xp-link" onClick={onClose}>Cancel</button>
          <span className="xp-title">{editing ? 'Edit expense' : 'Add expense'}</span>
          <button type="button" className="xp-link strong" disabled={!ready || busy}
                  onClick={submit}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </header>

        <form className="xp-body" onSubmit={submit}>
          <div className="xp-with">
            <span className="muted">With you and:</span>
            {members.filter((m) => m.id !== user.id).map((m) => (
              <button type="button" key={m.id}
                      className={`xp-chip${participants.has(m.id) ? ' on' : ''}`}
                      onClick={() => toggleParticipant(m.id)}>
                {firstName(m.name)}
              </button>
            ))}
          </div>

          <input className="xp-desc" value={description} autoFocus
                 placeholder="What was it for?"
                 onChange={(e) => setDescription(e.target.value)} />

          <div className="xp-amount">
            <CurrencySelect value={ccy} onChange={setCcy} className="xp-ccy" />
            {isItemized ? (
              <input className="xp-amt" value={itemTotals.sum.toFixed(2)} readOnly
                     title="Adds up from the products" />
            ) : (
              <input className="xp-amt" type="number" step="0.01" min="0" inputMode="decimal"
                     placeholder="0.00" value={amount}
                     onChange={(e) => setAmount(e.target.value)} />
            )}
          </div>

          {ready ? (
            <p className="xp-sentence">
              {'Paid by '}
              <button type="button" className="xp-inline" onClick={() => setSheet('payer')}>
                {payerLabel()}
              </button>
              {' and '}
              <button type="button" className="xp-inline" onClick={() => setSheet('split')}>
                {splitLabel()}
              </button>
            </p>
          ) : (
            <p className="xp-hint muted">Add a description and an amount to continue.</p>
          )}

          {error && <div className="error">{error}</div>}

          <div className="xp-foot">
            <input type="date" className="xp-date" value={date}
                   onChange={(e) => setDate(e.target.value)} />
            <button className="xp-save" disabled={!ready || busy}>
              {busy ? 'Saving…' : `Save ${total > 0 ? fmt(total, ccy) : ''}`}
            </button>
          </div>
        </form>
      </div>

      {/* ---------------- who paid ---------------- */}
      <Sheet open={sheet === 'payer'} title="Who paid?" onClose={() => setSheet(null)}>
        {!payers ? (
          <>
            <div className="pick-list">
              {members.map((m) => (
                <button type="button" key={m.id}
                        className={`pick${Number(paidBy) === m.id ? ' on' : ''}`}
                        onClick={() => { setPaidBy(m.id); setSheet(null) }}>
                  <span>{m.id === user.id ? 'You' : m.name}</span>
                  {Number(paidBy) === m.id && <span className="tick">✓</span>}
                </button>
              ))}
            </div>
            <button type="button" className="xp-inline block" onClick={enableMultiPayer}>
              Several people paid
            </button>
          </>
        ) : (
          <>
            <div className="pick-list">
              {members.map((m) => {
                const on = m.id in payers
                return (
                  <div key={m.id} className={`pick split-row${on ? ' on' : ''}`}>
                    <label className="row" style={{ gap: 8 }}>
                      <input type="checkbox" checked={on} onChange={() => togglePayer(m.id)} />
                      {m.id === user.id ? 'You' : m.name}
                    </label>
                    {on && (
                      <span className="row" style={{ gap: 6 }}>
                        <input type="number" step="0.01" min="0" className="xp-num"
                               placeholder="0.00" value={payers[m.id]}
                               onChange={(e) => setPayerAmount(m.id, e.target.value)} />
                        {Math.abs(remaining) > 0.005 && (
                          <button type="button" className="xp-inline"
                                  onClick={() => giveRest(m.id)}>
                            +{fmt(Math.abs(remaining), ccy)}
                          </button>
                        )}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
            <p className={Math.abs(remaining) > 0.005 ? 'error' : 'muted'}>
              {Math.abs(remaining) < 0.005
                ? `Adds up to ${fmt(total, ccy)}`
                : remaining > 0
                  ? `${fmt(remaining, ccy)} still unaccounted for`
                  : `${fmt(-remaining, ccy)} more than the expense`}
            </p>
            <button type="button" className="xp-inline block" onClick={() => setPayers(null)}>
              Just one person paid
            </button>
          </>
        )}
      </Sheet>

      {/* ---------------- how it splits ---------------- */}
      <Sheet open={sheet === 'split'} title="How should it split?" onClose={() => setSheet(null)}
             footer={<button type="button" className="xp-save" onClick={() => setSheet(null)}>Done</button>}>
        <div className="split-types">
          {TYPES.map(([v, l, hint]) => (
            <button type="button" key={v} className={`pick${splitType === v ? ' on' : ''}`}
                    onClick={() => chooseSplit(v)}>
              <span>
                <strong>{l[0].toUpperCase() + l.slice(1)}</strong>
                <span className="muted block">{hint}</span>
              </span>
              {splitType === v && <span className="tick">✓</span>}
            </button>
          ))}
        </div>

        {splitType === 'equal' && (
          <div className="pick-list">
            {members.map((m) => (
              <label key={m.id} className={`pick split-row${participants.has(m.id) ? ' on' : ''}`}>
                <span className="row" style={{ gap: 8 }}>
                  <input type="checkbox" checked={participants.has(m.id)}
                         onChange={() => toggleParticipant(m.id)} />
                  {m.id === user.id ? 'You' : m.name}
                </span>
                {participants.has(m.id) && total > 0 && (
                  <span className="muted">{fmt(total / participants.size, ccy)}</span>
                )}
              </label>
            ))}
          </div>
        )}

        {['exact', 'percent', 'shares'].includes(splitType) && (
          <>
            <div className="pick-list">
              {members.map((m) => (
                <div key={m.id} className="pick split-row on">
                  <span>{m.id === user.id ? 'You' : m.name}</span>
                  <span className="row" style={{ gap: 6 }}>
                    <input type="number" step="0.01" min="0" className="xp-num"
                           value={values[m.id] ?? ''}
                           onChange={(e) => setValues({ ...values, [m.id]: e.target.value })} />
                    <span className="muted">{unit}</span>
                  </span>
                </div>
              ))}
            </div>
            <p className="muted">
              {splitType === 'exact' && `${fmt(enteredSplit, ccy)} of ${fmt(total, ccy)}`}
              {splitType === 'percent' && `${enteredSplit.toFixed(1)}% of 100%`}
              {splitType === 'shares' && `${enteredSplit} share${enteredSplit === 1 ? '' : 's'}`}
            </p>
          </>
        )}

        {isItemized && (
          <>
            <ItemMatrix items={items} setItems={setItems} members={members} currency={ccy} />
            <button type="button" className="xp-inline block"
                    onClick={() => setItems([...items, emptyItem(members)])}>
              + Add product
            </button>
          </>
        )}
      </Sheet>
    </div>
  )
}
