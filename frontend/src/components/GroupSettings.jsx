import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import CurrencySelect, { useCurrencies } from './CurrencySelect'

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

  const toggleSimplify = () => save({ simplify_debts: !group.simplify_debts })

  const save = async (body, msg) => {
    setError('')
    try {
      await api.updateGroup(group.id, body)
      if (msg) flash(msg)
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
          <strong>Group currency</strong>
          <p className="muted" style={{ margin: '2px 0 0' }}>
            The default for new expenses, and what totals are shown in. Existing
            expenses keep the currency they were entered in.
          </p>
        </div>
        <CurrencySelect value={group.default_currency}
                        onChange={(c) => save({ default_currency: c }, `Currency set to ${c}.`)} />
      </div>

      <RatePanel group={group} />

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


/** Rates the group would use, with the option to pin one. */
function RatePanel({ group }) {
  const [rates, setRates] = useState([])
  const [draft, setDraft] = useState({})
  const [error, setError] = useState('')
  const { ratesAsOf } = useCurrencies()

  const load = useCallback(() => {
    api.groupRates(group.id).then(setRates).catch((e) => setError(e.message))
  }, [group.id])
  useEffect(() => { load() }, [load])

  if (rates.length === 0) return null

  const pin = async (r) => {
    const value = parseFloat(draft[r.base])
    if (!value || value <= 0) return
    try {
      await api.pinRate(group.id, { base: r.base, quote: r.quote, rate: value })
      setDraft({ ...draft, [r.base]: '' })
      load()
    } catch (e) { setError(e.message) }
  }

  const unpin = async (r) => {
    try { await api.unpinRate(group.id, r.base, r.quote); load() }
    catch (e) { setError(e.message) }
  }

  return (
    <div className="setting-block">
      <strong>Exchange rates</strong>
      <p className="muted" style={{ margin: '2px 0 8px' }}>
        Used only to show combined totals — balances always stay in the currency
        each expense was entered in, so no rate is ever baked into what someone owes.
      </p>
      {error && <div className="error">{error}</div>}
      {rates.map((r) => (
        <div className="rate-row" key={`${r.base}-${r.quote}`}>
          <span>1 {r.base} =</span>
          <input type="number" step="0.0001" min="0" placeholder={r.rate.toFixed(4)}
                 value={draft[r.base] ?? ''}
                 onChange={(e) => setDraft({ ...draft, [r.base]: e.target.value })} />
          <span>{r.quote}</span>
          <span className={`pill ${r.source === 'manual' ? 'pinned' : ''}`}>{r.source}</span>
          <button className="ghost" onClick={() => pin(r)} disabled={!draft[r.base]}>Pin</button>
          {r.source === 'manual' && (
            <button className="ghost" onClick={() => unpin(r)}>Use live</button>
          )}
        </div>
      ))}
      <p className="muted" style={{ margin: '6px 0 0' }}>
        Live rates from the European Central Bank{ratesAsOf ? `, updated ${ratesAsOf}` : ''}.
      </p>
    </div>
  )
}
