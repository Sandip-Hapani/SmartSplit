import { useEffect, useState } from 'react'
import { api } from '../api'
import { SYMBOLS } from '../currency'

let cache = null   // the list is identical for everyone, so fetch it once

export function useCurrencies() {
  const [list, setList] = useState(cache?.currencies || [])
  const [asOf, setAsOf] = useState(cache?.rates_as_of || null)

  useEffect(() => {
    if (cache) return
    api.currencies()
      .then((r) => { cache = r; setList(r.currencies); setAsOf(r.rates_as_of) })
      .catch(() => {
        // fall back to the built-in symbol table if the call fails
        const fallback = Object.keys(SYMBOLS).sort()
          .map((code) => ({ code, symbol: SYMBOLS[code], name: code }))
        setList(fallback)
      })
  }, [])

  return { currencies: list, ratesAsOf: asOf }
}

export default function CurrencySelect({ value, onChange, id, className = '' }) {
  const { currencies } = useCurrencies()
  return (
    <select id={id} className={`ccy-select ${className}`} value={value || 'EUR'}
            onChange={(e) => onChange(e.target.value)}>
      {currencies.map((c) => (
        <option key={c.code} value={c.code}>
          {c.code} {c.symbol !== c.code ? c.symbol : ''}
        </option>
      ))}
    </select>
  )
}
