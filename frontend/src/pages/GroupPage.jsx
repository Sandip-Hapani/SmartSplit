import { useCallback, useEffect, useState } from 'react'
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

  const myBalance = balances.find((b) => b.user_id === user.id)

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
            {myBalance && (
              <div className={myBalance.balance >= 0 ? 'pos' : 'neg'} style={{ fontSize: 20 }}>
                {myBalance.balance >= 0 ? 'you are owed ' : 'you owe '}
                {fmt(Math.abs(myBalance.balance))}
              </div>
            )}
            <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
              <button onClick={() => { setEditExpense(null); setShowExpense(true) }}>Add expense</button>
              <button onClick={() => setShowBill(true)}>📄 Upload bill</button>
              <button className="secondary" onClick={() => setShowSettle(true)}>Settle up</button>
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
            {expenses.length === 0 && <p className="muted">No expenses yet.</p>}
            {expenses.map((exp) => (
              <div key={exp.id}>
                <div className="list-item expense-row"
                     onClick={() => setExpanded(expanded === exp.id ? null : exp.id)}>
                  <div>
                    <strong>{exp.description}</strong>
                    {exp.split_type === 'itemized' && <span className="muted"> · {exp.items.length} items</span>}
                    <div className="muted">{exp.date} · paid by {exp.payer_name}</div>
                  </div>
                  <div className="row">
                    <strong>{fmt(exp.amount)}</strong>
                    <button className="secondary" onClick={(e) => { e.stopPropagation(); setEditExpense(exp); setShowExpense(true) }}>Edit</button>
                    <button className="danger" onClick={(e) => { e.stopPropagation(); removeExpense(exp) }}>✕</button>
                  </div>
                </div>
                {expanded === exp.id && (
                  <div className="expense-detail">
                    {exp.items.length > 0 && (
                      <table>
                        <thead><tr><th>Item</th><th>Qty</th><th>Total</th><th>Shared by</th></tr></thead>
                        <tbody>
                          {exp.items.map((it) => (
                            <tr key={it.id}>
                              <td>{it.name}</td>
                              <td>{it.quantity}{it.unit === 'kg' ? ' kg' : it.unit === 'x' ? '×' : ''}</td>
                              <td>{fmt(it.total)}</td>
                              <td>{it.participants.map((p) => p.user_name).join(', ')}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                    <div style={{ marginTop: 6 }}>
                      {exp.splits.map((s) => (
                        <div key={s.user_id}>
                          {s.user_name} owes <strong>{fmt(s.amount)}</strong>
                          {s.user_id === exp.paid_by && <span className="muted"> (paid)</span>}
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
            {balances.map((b) => (
              <div className="list-item" key={b.user_id}>
                <span>{b.user_name}</span>
                <span className={b.balance >= 0 ? 'pos' : 'neg'}>
                  {b.balance >= 0 ? 'gets back ' : 'owes '}{fmt(Math.abs(b.balance))}
                </span>
              </div>
            ))}
            <h3 style={{ marginTop: 18 }}>
              Suggested settlements{' '}
              <span className="muted" style={{ fontWeight: 400, fontSize: 13 }}>
                ({group.simplify_debts
                  ? 'simplified across the group'
                  : 'kept between the original payers'})
              </span>
            </h3>
            {transfers.length === 0 && <p className="muted">All settled up 🎉</p>}
            {transfers.map((t, i) => (
              <div className="list-item" key={i}>
                <span>{t.from_name} → {t.to_name}</span>
                <strong>{fmt(t.amount)}</strong>
              </div>
            ))}
            {settlements.length > 0 && <>
              <h3 style={{ marginTop: 18 }}>Recorded payments</h3>
              {settlements.map((s) => (
                <div className="list-item" key={s.id}>
                  <span>{s.from_name} paid {s.to_name}</span>
                  <span>{fmt(s.amount)} <span className="muted">({s.date})</span></span>
                </div>
              ))}
            </>}
          </>
        )}

        {tab === 'insights' && <Insights groupId={groupId} />}

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
