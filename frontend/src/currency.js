/** Currency symbols and formatting, mirroring services/currency.py. */

export const SYMBOLS = {
  EUR: '€', USD: '$', GBP: '£', INR: '₹', CHF: 'CHF', JPY: '¥',
  AUD: 'A$', CAD: 'C$', SEK: 'kr', NOK: 'kr', DKK: 'kr', PLN: 'zł',
  CZK: 'Kč', HUF: 'Ft', TRY: '₺', SGD: 'S$', HKD: 'HK$', NZD: 'NZ$',
  ZAR: 'R', BRL: 'R$', MXN: 'MX$', CNY: '¥', KRW: '₩', THB: '฿',
  IDR: 'Rp', MYR: 'RM', PHP: '₱', ILS: '₪', AED: 'AED',
}

const ZERO_DECIMAL = new Set(['JPY', 'KRW', 'IDR', 'HUF'])

export const symbolOf = (code) => SYMBOLS[(code || 'EUR').toUpperCase()] || `${code} `

/** fmt(12.4, 'CHF') -> "CHF 12.40"; fmt(12.4) -> "€12.40" */
export function fmt(amount, code = 'EUR') {
  const c = (code || 'EUR').toUpperCase()
  const sym = symbolOf(c)
  const value = (amount ?? 0).toFixed(ZERO_DECIMAL.has(c) ? 0 : 2)
  // multi-letter symbols read better with a space
  return sym.length > 1 && !/[^\w]/.test(sym[0]) ? `${sym} ${value}` : `${sym}${value}`
}
