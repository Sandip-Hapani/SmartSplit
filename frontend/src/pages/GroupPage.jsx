import { useCallback, useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router-dom'
import { api, fmt } from '../api'
import ExpenseModal from '../components/ExpenseModal'
import BillUpload from '../components/BillUpload'
import SettleModal from '../components/SettleModal'
import RecurringTab from '../components/RecurringTab'
import ActivityList from '../components/ActivityList'
import Whiteboard from '../components/Whiteboard'
import GroupSettings from '../components/GroupSettings'
import Insights from '../components/Insights'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { UI } from '../icons'

/** "paid by you", "paid by Maya", or "paid by you and 2 others". */
const paidByLabel = (row, meId) => {
  const payers = row.payers?.length ? row.payers : [{ user_id: row.paid_by, user_name: row.payer_name }]
  const name = (p) => (p.user_id === meId ? 'you' : p.user_name)
  if (payers.length === 1) return `paid by ${name(payers[0])}`
  if (payers.length === 2) return `paid by ${name(payers[0])} and ${name(payers[1])}`
  return `paid by ${name(payers[0])} and ${payers.length - 1} others`
}

const monthLabel = (iso) =>
  iso ? new Date(`${iso}T00:00:00`).toLocaleDateString([], { month: 'long', year: 'numeric' }) : ''

/** "Jun 30" stacked in the left gutter, like the mobile apps do it. */
const shortDate = (iso) => {
  if (!iso) return ''
  const d = new Date(`${iso}T00:00:00`)
  return `${d.toLocaleDateString([], { month: 'short' })} ${d.getDate()}`
}

export default function GroupPage({ user }) {
  const { groupId } = useParams()
  const [group, setGroup] = useState(null)
  const [tab, setTab] = useState('expenses')
  const [expenses, setExpenses] = useState([])
  const [balances, setBalances] = useState([])
  const [transfers, setTransfers] = useState([])
  const [activity, setActivity] = useState([])
  const [settlements, setSettlements] = useState([])
  const [expanded, setExpanded] = useState(null)
  const [showExpense, setShowExpense] = useState(false)
  const [editExpense, setEditExpense] = useState(null)
  const [showBill, setShowBill] = useState(false)
  const [showSettle, setShowSettle] = useState(false)
  const [memberQuery, setMemberQuery] = useState('')
  const [error, setError] = useState('')

  const reload = useCallback(() => {
    api.group(groupId).then(setGroup).catch((e) => setError(e.message))
    api.expenses(groupId).then(setExpenses).catch(() => {})
    api.balances(groupId).then(setBalances).catch(() => {})
    api.simplify(groupId).then(setTransfers).catch(() => {})
    api.activity(groupId).then(setActivity).catch(() => {})
    api.settlements(groupId).then(setSettlements).catch(() => {})
  }, [groupId])

  useEffect(() => { reload() }, [reload])

  const addMember = async (e) => {
    e.preventDefault()
    setError('')
    try {
      const q = memberQuery.trim()
      // accept either an email or an @username
      await api.addMember(groupId, q.includes('@') && q.indexOf('@') > 0
        ? { email: q } : { username: q.replace(/^@/, '') })
      setMemberQuery('')
      reload()
    } catch (err) {
      setError(err.message)
    }
  }

  // Expenses and settlements share one chronological list, split by month.
  const timeline = useMemo(() => {
    const entries = [
      ...expenses.map((e) => ({ ...e, kind: 'expense', key: `e${e.id}` })),
      ...settlements.map((s) => ({ ...s, kind: 'payment', key: `s${s.id}` })),
    ].sort((a, b) => (a.date === b.date ? b.id - a.id : (a.date < b.date ? 1 : -1)))

    const out = []
    let month = null
    for (const entry of entries) {
      const m = (entry.date || '').slice(0, 7)
      if (m !== month) {
        month = m
        out.push({ kind: 'month', key: `m${m}`, label: monthLabel(entry.date) })
      }
      out.push(entry)
    }
    return out
  }, [expenses, settlements])

  // balances + suggested payments, bucketed by currency
  const byCurrency = useMemo(() => {
    const order = []
    const map = new Map()
    for (const b of balances) {
      if (!map.has(b.currency)) { map.set(b.currency, { currency: b.currency, rows: [], transfers: [] }); order.push(b.currency) }
      map.get(b.currency).rows.push(b)
    }
    for (const t of transfers) {
      if (!map.has(t.currency)) { map.set(t.currency, { currency: t.currency, rows: [], transfers: [] }); order.push(t.currency) }
      map.get(t.currency).transfers.push(t)
    }
    return order.map((c) => map.get(c))
  }, [balances, transfers])

  const undoActivity = async (row) => {
    setError('')
    try {
      await api.undoActivity(groupId, row.id)
      reload()
    } catch (err) {
      setError(err.message)
    }
  }

  const removeExpense = async (exp) => {
    if (!confirm(`Delete "${exp.description}"?`)) return
    await api.deleteExpense(groupId, exp.id)
    reload()
  }

  if (!group) return <div className="page"><div className="card">Loading…</div></div>

  // one line per currency the user actually has a balance in
  const myBalances = balances.filter(
    (b) => b.user_id === user.id && Math.abs(b.balance) > 0.005)

  return (
    <div className="page">
      <div className="card">
        <div className="row spread">
          <div>
            <h2 style={{ marginBottom: 4 }}>{group.name}</h2>
            <div className="row" style={{ gap: 6 }}>
              {group.members.map((m) => <span className="chip" key={m.id}>{m.name}</span>)}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            {myBalances.length === 0 && <div className="muted">all settled up</div>}
            {myBalances.map((b) => (
              <div key={b.currency} className={b.balance >= 0 ? 'pos' : 'neg'}
                   style={{ fontSize: 20 }}>
                {b.balance >= 0 ? 'you are owed ' : 'you owe '}
                {fmt(Math.abs(b.balance), b.currency)}
              </div>
            ))}
            <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setEditExpense(null); setShowExpense(true) }}>Add expense</button>
              <button onClick={() => setShowBill(true)}>
                <FontAwesomeIcon icon={UI.bill} /> Upload bill
              </button>
              <button className="secondary" onClick={() => setShowSettle(true)}>
                <FontAwesomeIcon icon={UI.settle} /> Settle up
              </button>
            </div>
          </div>
        </div>
        <form className="row" style={{ marginTop: 12 }} onSubmit={addMember}>
          <input placeholder="Add member by @username or email" value={memberQuery}
                 onChange={(e) => setMemberQuery(e.target.value)} />
          <button className="secondary">Add member</button>
        </form>
        {error && <div className="error">{error}</div>}
      </div>

      <div className="card">
        <div className="tabs">
          {['expenses', 'balances', 'insights', 'whiteboard', 'activity', 'recurring', 'settings'].map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {tab === 'expenses' && (
          <>
            {timeline.length === 0 && <p className="muted">No expenses yet.</p>}
            {timeline.map((row) => row.kind === 'month' ? (
              <h4 className="month-head" key={row.key}>{row.label}</h4>
            ) : row.kind === 'payment' ? (
              /* Settlements are notices in the timeline, not editable entries:
                 they record money moving, so there is nothing to split or edit. */
              <div className="payment-row" key={row.key}>
                <span className="pay-date">{shortDate(row.date)}</span>
                <span className="pay-icon"><FontAwesomeIcon icon={UI.settle} fixedWidth /></span>
                <span className="pay-text">
                  {row.from_user === user.id ? 'You' : row.from_name}
                  {' paid '}
                  {row.to_user === user.id ? 'you' : row.to_name}
                  {' '}<strong>{fmt(row.amount, row.currency)}</strong>
                </span>
                <span className="pill">payment</span>
              </div>
            ) : (
              <div key={row.key}>
                <div className="list-item expense-row"
                     onClick={() => setExpanded(expanded === row.id ? null : row.id)}>
                  <span className="pay-date">{shortDate(row.date)}</span>
                  <div className="ex-main">
                    <strong>{row.description}</strong>
                    {row.split_type === 'itemized' && <span className="muted"> · {row.items.length} items</span>}
                    <div className="muted">{paidByLabel(row, user.id)}</div>
                  </div>
                  <div className="row">
                    <strong>{fmt(row.amount, row.currency)}</strong>
                    <button className="icon-btn edit" title="Edit this entry"
                            aria-label={`Edit ${row.description}`}
                            onClick={(e) => { e.stopPropagation(); setEditExpense(row); setShowExpense(true) }}>
                      <FontAwesomeIcon icon={UI.editEntry} />
                    </button>
                    <button className="icon-btn delete" title="Delete this entry"
                            aria-label={`Delete ${row.description}`}
                            onClick={(e) => { e.stopPropagation(); removeExpense(row) }}>
                      <FontAwesomeIcon icon={UI.deleteEntry} />
                    </button>
                  </div>
                </div>
                {expanded === row.id && (
                  <div className="expense-detail">
                    {row.items.length > 0 && (
                      <table>
                        <thead><tr><th>Item</th><th>Qty</th><th>Total</th><th>Shared by</th></tr></thead>
                        <tbody>
                          {row.items.map((it) => (
                            <tr key={it.id}>
                              <td>{it.name}</td>
                              <td>{it.quantity}{it.unit === 'kg' ? ' kg' : it.unit === 'x' ? '×' : ''}</td>
                              <td>{fmt(it.total, row.currency)}</td>
                              <td>{it.participants.map((p) => p.user_name).join(', ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    {row.payers.length > 1 && (
                      <div className="paid-lines">
                        {row.payers.map((p) => (
                          <div key={p.user_id}>
                            {p.user_id === user.id ? 'You' : p.user_name} paid{' '}
                            <strong>{fmt(p.amount, row.currency)}</strong>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ marginTop: 6 }}>
                      {row.splits.map((s) => (
                        <div key={s.user_id}>
                          {s.user_name} owes <strong>{fmt(s.amount, row.currency)}</strong>
                          {s.user_id === row.paid_by && <span className="muted"> (paid)</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ))}
          </>
        )}

        {tab === 'balances' && (
          <>
            {byCurrency.map(({ currency, rows, transfers: tr }) => (
              <div key={currency} className="ccy-block">
                {byCurrency.length > 1 && (
                  <h4 className="ccy-head">{currency}</h4>
                )}
                {rows.map((b) => (
                  <div className="list-item" key={`${currency}-${b.user_id}`}>
                    <span>{b.user_name}</span>
                    <span className={b.balance >= 0 ? 'pos' : 'neg'}>
                      {b.balance >= 0 ? 'gets back ' : 'owes '}
                      {fmt(Math.abs(b.balance), currency)}
                    </span>
                  </div>
                ))}
                {tr.length > 0 && (
                  <div className="settle-list">
                    {tr.map((t, i) => (
                      <div className="list-item" key={i}>
                        <span>{t.from_name} → {t.to_name}</span>
                        <strong>{fmt(t.amount, currency)}</strong>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
            <p className="muted">
              Suggested settlements are shown under each currency
              ({group.simplify_debts
                ? 'simplified across the group'
                : 'kept between the original payers'}).
              Currencies are never netted against each other.
            </p>
            {byCurrency.length === 0 && <p className="muted">All settled up.</p>}
            {settlements.length > 0 && (
              <p className="muted" style={{ marginTop: 18 }}>
                {settlements.length} payment{settlements.length === 1 ? '' : 's'} recorded —
                they appear in the Expenses timeline.
              </p>
            )}
          </>
        )}

        {tab === 'insights' && <Insights groupId={groupId} baseCurrency={group.default_currency} />}

        {tab === 'whiteboard' && <Whiteboard groupId={groupId} user={user} />}

        {tab === 'activity' && (
          <>
            <p className="muted" style={{ marginTop: 0 }}>
              Undoing an entry appends a new one — nothing is erased.
            </p>
            {activity.length === 0 && <p className="muted">Nothing yet.</p>}
            <ActivityList rows={activity} onUndo={undoActivity} />
          </>
        )}

        {tab === 'recurring' && <RecurringTab groupId={groupId} group={group} onChange={reload} />}

        {tab === 'settings' && <GroupSettings group={group} onChange={reload} />}
      </div>

      {showExpense && (
        <ExpenseModal
          group={group} user={user} expense={editExpense}
          onClose={() => setShowExpense(false)}
          onSaved={() => { setShowExpense(false); reload() }}
        />
      )}
      {showBill && (
        <BillUpload
          group={group} user={user}
          onClose={() => setShowBill(false)}
          onSaved={() => { setShowBill(false); reload() }}
        />
      )}
      {showSettle && (
        <SettleModal
          group={group} user={user} transfers={transfers}
          onClose={() => setShowSettle(false)}
          onSaved={() => { setShowSettle(false); reload() }}
        />
      )}
    </div>
  )
}
