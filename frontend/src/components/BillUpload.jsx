import { useMemo, useRef, useState } from 'react'
import { api, fmt } from '../api'

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

  const toggle = (idx, memberId) => {
    setItems((prev) => prev.map((it, i) => {
      if (i !== idx) return it
      const included = new Set(it.included)
      included.has(memberId) ? included.delete(memberId) : included.add(memberId)
      return { ...it, included }
    }))
  }

  const toggleAllForMember = (memberId, checked) => {
    setItems((prev) => prev.map((it) => {
      const included = new Set(it.included)
      checked ? included.add(memberId) : included.delete(memberId)
      return { ...it, included }
    }))
  }

  const setItemField = (idx, field, value) => {
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)))
  }

  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx))
  const addItem = () => setItems((prev) => [...prev, {
    name: 'New item', quantity: 1, unit: '', total: 0,
    included: new Set(group.members.map((m) => m.id)),
  }])

  const totals = useMemo(() => {
    const sum = items.reduce((acc, it) => acc + (parseFloat(it.total) || 0), 0)
    const perPerson = {}
    for (const m of group.members) perPerson[m.id] = 0
    for (const it of items) {
      const t = parseFloat(it.total) || 0
      if (it.included.size === 0) continue
      const share = t / it.included.size
      for (const uid of it.included) perPerson[uid] += share
    }
    return { sum: Math.round(sum * 100) / 100, perPerson }
  }, [items, group.members])

  const mismatch = bill?.total != null && Math.abs(totals.sum - bill.total) > 0.011

  const save = async () => {
    setError('')
    const bad = items.find((it) => it.included.size === 0 && (parseFloat(it.total) || 0) !== 0)
    if (bad) return setError(`"${bad.name}" has no one assigned — tick at least one person or remove the row.`)
    if (items.length === 0) return setError('No items to save.')
    setBusy(true)
    try {
      await api.createExpense(group.id, {
        description: description || 'Bill',
        amount: totals.sum,
        date,
        paid_by: Number(paidBy),
        split_type: 'itemized',
        notes: bill?.store ? `Parsed from bill (${bill.source})` : '',
        items: items
          .filter((it) => it.included.size > 0)
          .map((it) => ({
            name: it.name,
            quantity: parseFloat(it.quantity) || 1,
            unit: it.unit || '',
            total: parseFloat(it.total) || 0,
            participant_ids: [...it.included],
          })),
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
              <div className="field">
                <label>Paid by</label>
                <select value={paidBy} onChange={(e) => setPaidBy(e.target.value)}>
                  {group.members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </div>
            </div>

            <p className="muted" style={{ margin: '4px 0 8px' }}>
              Untick a person on a row to exclude them from that product. Each row splits among the ticked people.
            </p>

            <div className="matrix-wrap">
              <table className="matrix">
                <thead>
                  <tr>
                    <th style={{ minWidth: 180 }}>Product</th>
                    <th>Qty</th>
                    <th>Total</th>
                    {group.members.map((m) => (
                      <th key={m.id} title={`Toggle ${m.name} on all rows`}>
                        <label style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                          {m.name}
                          <input type="checkbox"
                                 checked={items.length > 0 && items.every((it) => it.included.has(m.id))}
                                 onChange={(e) => toggleAllForMember(m.id, e.target.checked)} />
                        </label>
                      </th>
                    ))}
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((it, idx) => (
                    <tr key={idx} className={it.included.size === 0 ? 'excluded' : ''}>
                      <td>
                        <input className="name-edit" value={it.name}
                               onChange={(e) => setItemField(idx, 'name', e.target.value)} />
                      </td>
                      <td className="num muted">
                        {it.unit === 'kg' ? `${it.quantity} kg` : it.quantity > 1 ? `${it.quantity}×` : ''}
                      </td>
                      <td className="num">
                        <input className="total-edit" type="number" step="0.01" value={it.total}
                               onChange={(e) => setItemField(idx, 'total', e.target.value)} />
                      </td>
                      {group.members.map((m) => (
                        <td className="check" key={m.id}>
                          <input type="checkbox" checked={it.included.has(m.id)}
                                 onChange={() => toggle(idx, m.id)} />
                        </td>
                      ))}
                      <td className="check">
                        <button className="danger" title="Remove row" onClick={() => removeItem(idx)}>✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <th>Total</th>
                    <th></th>
                    <th className="num">{fmt(totals.sum)}</th>
                    {group.members.map((m) => (
                      <th className="num" key={m.id}>{fmt(totals.perPerson[m.id])}</th>
                    ))}
                    <th></th>
                  </tr>
                </tfoot>
              </table>
            </div>

            <div className="row spread" style={{ marginTop: 10 }}>
              <button className="secondary" onClick={addItem}>+ Add row</button>
              <div className="muted">
                {bill.total != null && <>Receipt total: <strong>{fmt(bill.total)}</strong>{' '}
                  {mismatch
                    ? <span className="neg">≠ items {fmt(totals.sum)}</span>
                    : <span className="pos">✓ matches</span>}
                </>}
              </div>
            </div>

            {error && <div className="error">{error}</div>}
            <div className="row" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button className="secondary" onClick={onClose}>Cancel</button>
              <button onClick={save} disabled={busy}>Save expense ({fmt(totals.sum)})</button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
