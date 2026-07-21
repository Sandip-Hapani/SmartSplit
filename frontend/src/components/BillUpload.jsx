import { useRef, useState } from 'react'
import { api, fmt } from '../api'
import CurrencySelect from './CurrencySelect'
import PaidByField, { payersToPayload } from './PaidByField'
import ItemMatrix, { emptyItem, itemsToPayload, useItemTotals } from './ItemMatrix'

/**
 * Upload a bill (PDF/image) -> parsed line items -> assignment matrix:
 * one row per product, one checkbox column per group member.
 * Everyone is included by default; untick a person to exclude them from
 * that product. Each item's cost splits among its checked people.
 */
export default function BillUpload({ group, user, onClose, onSaved }) {
  const [stage, setStage] = useState('upload') // upload | parsing | assign
  const [bill, setBill] = useState(null)
  const [items, setItems] = useState([]) // {name, quantity, unit, total, included:Set}
  const [description, setDescription] = useState('')
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [ccy, setCcy] = useState(group.default_currency || 'EUR')
  const [payers, setPayers] = useState(null)
  const [paidBy, setPaidBy] = useState(user.id)
  const [error, setError] = useState('')
  const [drag, setDrag] = useState(false)
  const [busy, setBusy] = useState(false)
  const fileRef = useRef()

  const handleFile = async (file) => {
    if (!file) return
    setError('')
    setStage('parsing')
    try {
      const parsed = await api.parseBill(group.id, file)
      setBill(parsed)
      setItems(parsed.items.map((it) => ({
        ...it,
        included: new Set(group.members.map((m) => m.id)),
      })))
      // Prefix the receipt's own date so bill-created entries are identifiable
      // in the list and in exports, even when several bills share a store.
      const billDate = parsed.date || date
      const label = parsed.store || file.name.replace(/\.[^.]+$/, '')
      setDescription(`${billDate} ${label}`)
      if (parsed.date) setDate(parsed.date)
      setStage('assign')
      if (parsed.items.length === 0) {
        setError('No items could be parsed — you can add rows manually below.')
      }
    } catch (err) {
      setError(err.message)
      setStage('upload')
    }
  }

  const addItem = () => setItems((prev) => [...prev, emptyItem(group.members)])
  const totals = useItemTotals(items, group.members)

  const mismatch = bill?.total != null && Math.abs(totals.sum - bill.total) > 0.011

  const save = async () => {
    setError('')
    const bad = items.find((it) => it.included.size === 0 && (parseFloat(it.total) || 0) !== 0)
    if (bad) return setError(`"${bad.name}" has no one assigned — tick at least one person or remove the row.`)
    if (items.length === 0) return setError('No items to save.')
    const multi = payersToPayload(payers)
    if (multi && Math.abs(multi.reduce((a, p) => a + p.amount, 0) - totals.sum) > 0.011) {
      return setError('What each person paid must add up to the bill total.')
    }
    setBusy(true)
    try {
      await api.createExpense(group.id, {
        description: description || 'Bill',
        amount: totals.sum,
        currency: ccy,
        date,
        ...(payersToPayload(payers)?.length
          ? { payers: payersToPayload(payers) }
          : { paid_by: Number(paidBy) }),
        split_type: 'itemized',
        notes: bill?.store ? `Parsed from bill (${bill.source})` : '',
        items: itemsToPayload(items),
      })
      onSaved()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" style={{ width: stage === 'assign' ? 860 : 560 }}
           onClick={(e) => e.stopPropagation()}>
        <h3>Upload bill</h3>

        {stage === 'upload' && (
          <>
            <div
              className={`dropzone ${drag ? 'drag' : ''}`}
              onClick={() => fileRef.current.click()}
              onDragOver={(e) => { e.preventDefault(); setDrag(true) }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); handleFile(e.dataTransfer.files[0]) }}
            >
              <p style={{ fontSize: 34, margin: '0 0 8px' }}>🧾</p>
              <p>Drop a receipt here or click to choose<br />
                <span className="muted">PDF or photo (JPG/PNG)</span></p>
            </div>
            <input ref={fileRef} type="file" accept=".pdf,image/*" hidden
                   onChange={(e) => handleFile(e.target.files[0])} />
            {error && <div className="error">{error}</div>}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 10 }}>
              <button className="secondary" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}

        {stage === 'parsing' && <p>Parsing your bill…</p>}

        {stage === 'assign' && (
          <>
            {bill.warnings.map((w, i) => <div className="warn" key={i}>⚠ {w}</div>)}
            <div className="row" style={{ marginBottom: 10 }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Description</label>
                <input value={description} onChange={(e) => setDescription(e.target.value)} />
              </div>
              <div className="field">
                <label>Date</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
              </div>
              <PaidByField members={group.members} paidBy={paidBy} setPaidBy={setPaidBy}
                           payers={payers} setPayers={setPayers}
                           amount={totals.sum} currency={ccy} />
              <div className="field">
                <label>Currency</label>
                <CurrencySelect value={ccy} onChange={setCcy} />
              </div>
            </div>

            <ItemMatrix items={items} setItems={setItems}
                        members={group.members} currency={ccy} />

            <div className="row spread" style={{ marginTop: 10 }}>
              <button className="secondary" onClick={addItem}>+ Add row</button>
              <div className="muted">
                {bill.total != null && <>Receipt total: <strong>{fmt(bill.total, ccy)}</strong>{' '}
                  {mismatch
                    ? <span className="neg">≠ items {fmt(totals.sum, ccy)}</span>
                    : <span className="pos">✓ matches</span>}
                </>}
              </div>
            </div>

            {error && <div className="error">{error}</div>}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="secondary" onClick={onClose}>Cancel</button>
              <button onClick={save} disabled={busy}>Save expense ({fmt(totals.sum, ccy)})</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
