import { useMemo } from 'react'
import { fmt } from '../api'

/**
 * Per-product assignment grid, shared by the bill-upload flow and the expense
 * editor so a parsed bill stays as editable afterwards as it was on the way in.
 *
 * Each row is a product; each ticked person shares that row's cost. `items` are
 * plain objects with an `included` Set of user ids.
 */
export function emptyItem(members) {
  return {
    name: 'New item', quantity: 1, unit: '', total: 0,
    included: new Set(members.map((m) => m.id)),
  }
}

/** Turn the API's expense.items into the shape this grid edits. */
export function itemsFromExpense(expense) {
  return (expense?.items || []).map((it) => ({
    name: it.name,
    quantity: it.quantity ?? 1,
    unit: it.unit || '',
    total: it.total,
    included: new Set(it.participants.map((p) => p.user_id)),
  }))
}

/** The payload shape the API expects back. */
export function itemsToPayload(items) {
  return items
    .filter((it) => it.included.size > 0)
    .map((it) => ({
      name: it.name,
      quantity: parseFloat(it.quantity) || 1,
      unit: it.unit || '',
      total: parseFloat(it.total) || 0,
      participant_ids: [...it.included],
    }))
}

export function useItemTotals(items, members) {
  return useMemo(() => {
    const sum = items.reduce((acc, it) => acc + (parseFloat(it.total) || 0), 0)
    const perPerson = {}
    for (const m of members) perPerson[m.id] = 0
    for (const it of items) {
      const t = parseFloat(it.total) || 0
      if (it.included.size === 0) continue
      const share = t / it.included.size
      for (const uid of it.included) perPerson[uid] = (perPerson[uid] || 0) + share
    }
    return { sum: Math.round(sum * 100) / 100, perPerson }
  }, [items, members])
}

export default function ItemMatrix({ items, setItems, members, currency = 'EUR' }) {
  const totals = useItemTotals(items, members)

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

  const setField = (idx, field, value) =>
    setItems((prev) => prev.map((it, i) => (i === idx ? { ...it, [field]: value } : it)))

  const removeItem = (idx) => setItems((prev) => prev.filter((_, i) => i !== idx))

  return (
    <>
      <p className="muted" style={{ margin: '4px 0 8px' }}>
        Untick a person on a row to drop them from that product. Each row splits
        only among the people ticked on it.
      </p>
      <div className="matrix-wrap">
        <table className="matrix">
          <thead>
            <tr>
              <th style={{ minWidth: 170 }}>Product</th>
              <th>Qty</th>
              <th>Total</th>
              {members.map((m) => (
                <th key={m.id} title={`Toggle ${m.name} on every row`}>
                  <label style={{ cursor: 'pointer', display: 'flex', flexDirection: 'column',
                                  alignItems: 'center', gap: 2 }}>
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
                         onChange={(e) => setField(idx, 'name', e.target.value)} />
                </td>
                <td className="num">
                  <input className="total-edit" type="number" step="0.001" min="0"
                         style={{ width: 56 }} value={it.quantity}
                         onChange={(e) => setField(idx, 'quantity', e.target.value)} />
                  {it.unit === 'kg' && <span className="muted"> kg</span>}
                </td>
                <td className="num">
                  <input className="total-edit" type="number" step="0.01" value={it.total}
                         onChange={(e) => setField(idx, 'total', e.target.value)} />
                </td>
                {members.map((m) => (
                  <td className="check" key={m.id}>
                    <input type="checkbox" checked={it.included.has(m.id)}
                           onChange={() => toggle(idx, m.id)} />
                  </td>
                ))}
                <td className="check">
                  <button type="button" className="danger" title="Remove this product"
                          onClick={() => removeItem(idx)}>✕</button>
                </td>
              </tr>
            ))}
            {items.length === 0 && (
              <tr>
                <td colSpan={4 + members.length} className="muted" style={{ padding: 12 }}>
                  No products — add a row below.
                </td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr>
              <th>Total</th>
              <th></th>
              <th className="num">{fmt(totals.sum, currency)}</th>
              {members.map((m) => (
                <th className="num" key={m.id}>{fmt(totals.perPerson[m.id], currency)}</th>
              ))}
              <th></th>
            </tr>
          </tfoot>
        </table>
      </div>
    </>
  )
}
