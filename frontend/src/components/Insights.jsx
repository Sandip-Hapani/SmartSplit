import { useCallback, useEffect, useState } from 'react'
import { api, fmt, getToken } from '../api'
import SpendChart from './SpendChart'
import CurrencySelect from './CurrencySelect'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { UI } from '../icons'

/** Downloads via fetch so the Authorization header is sent. */
async function downloadCsv(path, fallbackName) {
  const res = await fetch(path, { headers: { Authorization: `Bearer ${getToken()}` } })
  if (!res.ok) throw new Error(`Export failed (HTTP ${res.status})`)
  const disp = res.headers.get('content-disposition') || ''
  const match = disp.match(/filename="([^"]+)"/)
  const blob = await res.blob()
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = match ? match[1] : fallbackName
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function Tile({ label, value, sub, hero = false, currency = 'EUR' }) {
  return (
    <div className={`stat-tile${hero ? ' hero' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{fmt(value, currency)}</div>
      {sub && <div className="stat-sub muted">{sub}</div>}
    </div>
  )
}

/** `groupId` omitted = account-wide view across every group. */
export default function Insights({ groupId, baseCurrency = 'EUR' }) {
  const [display, setDisplay] = useState(baseCurrency)
  const [stats, setStats] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const csvPath = groupId ? `/api/groups/${groupId}/expenses.csv` : '/api/account/expenses.csv'

  const load = useCallback(() => {
    (groupId ? api.groupStats(groupId, display) : api.accountStats(display))
      .then(setStats)
      .catch((e) => setError(e.message))
  }, [groupId, display])

  useEffect(() => { load() }, [load])

  const exportCsv = async () => {
    setBusy(true); setError('')
    try {
      await downloadCsv(csvPath, 'smartsplit-expenses.csv')
    } catch (e) {
      setError(e.message)
    } finally {
      setBusy(false)
    }
  }

  if (error && !stats) return <div className="error">{error}</div>
  if (!stats) return <p className="muted">Loading…</p>

  const delta = stats.this_month_total - stats.last_month_total
  const trend = stats.last_month_total > 0
    ? `${delta >= 0 ? '+' : ''}${Math.round((delta / stats.last_month_total) * 100)}% vs last month`
    : null

  return (
    <div className="stack">
      <div className="row spread">
        <p className="muted" style={{ margin: 0 }}>
          {stats.expense_count} expense{stats.expense_count === 1 ? '' : 's'} recorded
          {groupId ? ' in this group' : ' across all your groups'}.
        </p>
        <div className="row">
        <CurrencySelect value={display} onChange={setDisplay} />
        <button className="secondary" onClick={exportCsv} disabled={busy}>
          {busy ? 'Preparing…' : <><FontAwesomeIcon icon={UI.download} /> Export CSV</>}
        </button>
        </div>
      </div>
      {error && <div className="error">{error}</div>}

      {stats.converted && (
        <div className="notice">
          {groupId ? 'This group has' : 'Your groups have'} expenses in{' '}
          {stats.by_currency.map((c) => c.currency).join(', ')}.
          Totals below are converted to {stats.currency} at today's rate for comparison only —
          balances stay in their original currency.
          {stats.unconverted.length > 0 && (
            <> No rate available for {stats.unconverted.join(', ')}, so those are excluded.</>
          )}
        </div>
      )}

      <div className="stat-row">
        <Tile hero currency={stats.currency} label="All-time spending"
              value={stats.all_time_total}
              sub={`your share ${fmt(stats.all_time_mine, stats.currency)}`} />
        <Tile currency={stats.currency} label={stats.this_month_label}
              value={stats.this_month_total}
              sub={trend || `your share ${fmt(stats.this_month_mine, stats.currency)}`} />
        <Tile currency={stats.currency} label={stats.last_month_label}
              value={stats.last_month_total}
              sub={`your share ${fmt(stats.last_month_mine, stats.currency)}`} />
        <Tile currency={stats.currency} label="Your share this month"
              value={stats.this_month_mine}
              sub={`of ${fmt(stats.this_month_total, stats.currency)} total`} />
      </div>

      {stats.by_currency.length > 1 && (
        <div>
          <strong>Spent per currency (original amounts)</strong>
          {stats.by_currency.map((c) => (
            <div className="list-item" key={c.currency}>
              <span>{c.currency}</span>
              <span>{fmt(c.total, c.currency)}
                <span className="muted"> · your share {fmt(c.mine, c.currency)}</span>
              </span>
            </div>
          ))}
        </div>
      )}

      <SpendChart monthly={stats.monthly} currency={stats.currency} />
    </div>
  )
}
