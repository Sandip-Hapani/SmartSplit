import { useMemo } from 'react'
import { fmt } from '../api'

/**
 * Who put money down. One person by default; switch to "several people" when
 * a bill was paid jointly and enter what each of them covered.
 *
 * `payers` is null for the simple single-payer case, or a {userId: amountText}
 * map once it's been split.
 */
export function payersToPayload(payers) {
  if (!payers) return null
  return Object.entries(payers)
    .map(([id, v]) => ({ user_id: Number(id), amount: parseFloat(v) || 0 }))
    .filter((p) => p.amount > 0)
}

export function payersFromExpense(expense) {
  if (!expense || (expense.payers || []).length < 2) return null
  return Object.fromEntries(expense.payers.map((p) => [p.user_id, String(p.amount)]))
}

export default function PaidByField({
  members, paidBy, setPaidBy, payers, setPayers, amount, currency,
}) {
  const entered = useMemo(
    () => Object.values(payers || {}).reduce((a, v) => a + (parseFloat(v) || 0), 0),
    [payers],
  )
  const remaining = Math.round((amount - entered) * 100) / 100

  const enableSplit = () => {
    // seed with the current single payer covering the whole amount
    setPayers({ [paidBy]: amount ? String(amount) : '' })
  }

  const setOne = (id, value) => setPayers({ ...payers, [id]: value })

  const toggleMember = (id) => {
    const next = { ...payers }
    if (id in next) delete next[id]
    else next[id] = ''
    setPayers(next)
  }

  /** Hand the leftover to whoever is short, so the numbers land exactly. */
  const fillRemainder = (id) => {
    const others = Object.entries(payers)
      .filter(([k]) => Number(k) !== id)
      .reduce((a, [, v]) => a + (parseFloat(v) || 0), 0)
    setOne(id, String(Math.round((amount - others) * 100) / 100))
  }

  if (!payers) {
    return (
      <div className="field">
        <label>Paid by</label>
        <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        <a href="#" className="muted payers-link"
           onClick={(e) => { e.preventDefault(); enableSplit() }}>
          Several people paid
        </a>
      </div>
    )
  }

  return (
    <div className="field payers-field">
      <label>
        Paid by
        <a href="#" className="muted payers-link"
           onClick={(e) => { e.preventDefault(); setPayers(null) }}>
          just one person
        </a>
      </label>
      <div className="payers-grid">
        {members.map((m) => {
          const active = m.id in payers
          return (
            <div key={m.id} className={`payer-row${active ? ' on' : ''}`}>
              <label className="row" style={{ gap: 6 }}>
                <input type="checkbox" checked={active} onChange={() => toggleMember(m.id)} />
                {m.name}
              </label>
              {active && (
                <div className="row" style={{ gap: 4 }}>
                  <input type="number" step="0.01" min="0" style={{ width: 96 }}
                         placeholder="0.00" value={payers[m.id]}
                         onChange={(e) => setOne(m.id, e.target.value)} />
                  {Math.abs(remaining) > 0.005 && (
                    <button type="button" className="ghost" title="Give this person the rest"
                            onClick={() => fillRemainder(m.id)}>
                      +{fmt(Math.abs(remaining), currency)}
                    </button>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
      <p className={Math.abs(remaining) > 0.005 ? 'error' : 'muted'} style={{ margin: '4px 0 0' }}>
        {Math.abs(remaining) < 0.005
          ? `Adds up to ${fmt(amount, currency)}`
          : remaining > 0
            ? `${fmt(remaining, currency)} still unaccounted for`
            : `${fmt(-remaining, currency)} more than the expense`}
      </p>
    </div>
  )
}
