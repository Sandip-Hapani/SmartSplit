import { useMemo, useState } from 'react'
import { fmt, symbolOf } from '../api'

/**
 * Monthly spending as grouped columns: what the group spent, and your share of it.
 * Both series are the same currency, so they share one axis.
 *
 * Palette is categorical slots 1 (blue) and 2 (green), validated for colour-vision
 * deficiency against this app's own card surfaces in light and dark.
 */
const W = 760
const H = 260
const PAD = { top: 14, right: 10, bottom: 30, left: 52 }
const BAR_GAP = 2        // surface gap between the two bars in a month
const RADIUS = 4         // rounded data-ends

/** Axis ticks stay terse: "€750", "CHF 750", "€1.2k". */
const axisTick = (t, code) => {
  const sym = symbolOf(code)
  const n = t >= 1000 ? `${Math.round(t / 100) / 10}k` : t
  return sym.length > 1 && /\w/.test(sym[0]) ? `${sym} ${n}` : `${sym}${n}`
}

const niceMax = (v) => {
  if (v <= 0) return 10
  const mag = 10 ** Math.floor(Math.log10(v))
  return Math.ceil(v / mag * 2) / 2 * mag
}

/** Rounded only at the data end, square where it meets the baseline. */
function barPath(x, y, w, h) {
  const r = Math.min(RADIUS, w / 2, h)
  if (h <= 0) return ''
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} ` +
         `L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`
}

export default function SpendChart({ monthly, currency = 'EUR', title = 'Monthly spending' }) {
  const [hover, setHover] = useState(null)
  const [showTable, setShowTable] = useState(false)

  const max = useMemo(
    () => niceMax(Math.max(0, ...monthly.map((m) => m.total))),
    [monthly],
  )

  const plotW = W - PAD.left - PAD.right
  const plotH = H - PAD.top - PAD.bottom
  const band = plotW / Math.max(monthly.length, 1)
  const barW = Math.max(4, (band * 0.62 - BAR_GAP) / 2)
  const yOf = (v) => PAD.top + plotH - (v / max) * plotH
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => Math.round(max * f * 100) / 100)

  const hasData = monthly.some((m) => m.total > 0)
  const newest = monthly.length - 1

  return (
    <div className="chart-block">
      <div className="row spread chart-head">
        <div>
          <strong>{title}</strong>
          <div className="chart-legend">
            <span><i className="key s1" /> Group total</span>
            <span><i className="key s2" /> Your share</span>
          </div>
        </div>
        <button className="ghost" onClick={() => setShowTable((s) => !s)}>
          {showTable ? 'Show chart' : 'Show table'}
        </button>
      </div>

      {showTable ? (
        <div className="table-scroll">
          <table className="data-table">
            <thead>
              <tr><th>Month</th><th>Expenses</th><th>Group total</th><th>Your share</th></tr>
            </thead>
            <tbody>
              {monthly.map((m) => (
                <tr key={m.month}>
                  <td>{m.label} {m.year}</td>
                  <td className="num">{m.count}</td>
                  <td className="num">{fmt(m.total, currency)}</td>
                  <td className="num">{fmt(m.mine, currency)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-wrap">
          <svg viewBox={`0 0 ${W} ${H}`} className="spend-chart" role="img"
               aria-label={`${title}. Switch to the table view for exact figures.`}>
            {ticks.map((t) => (
              <g key={t}>
                <line className="grid" x1={PAD.left} x2={W - PAD.right} y1={yOf(t)} y2={yOf(t)} />
                <text className="axis" x={PAD.left - 8} y={yOf(t) + 4} textAnchor="end">
                  {axisTick(t, currency)}
                </text>
              </g>
            ))}
            <line className="baseline" x1={PAD.left} x2={W - PAD.right}
                  y1={yOf(0)} y2={yOf(0)} />

            {monthly.map((m, i) => {
              const cx = PAD.left + band * i + band / 2
              const x1 = cx - barW - BAR_GAP / 2
              const x2 = cx + BAR_GAP / 2
              const active = hover === i
              return (
                <g key={m.month}>
                  <rect className={`hit${active ? ' on' : ''}`} x={PAD.left + band * i}
                        y={PAD.top} width={band} height={plotH}
                        onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
                  <path className="s1" d={barPath(x1, yOf(m.total), barW, plotH - (yOf(m.total) - PAD.top))} />
                  <path className="s2" d={barPath(x2, yOf(m.mine), barW, plotH - (yOf(m.mine) - PAD.top))} />
                  <text className={`axis${active ? ' strong' : ''}`} x={cx} y={H - 10}
                        textAnchor="middle">{m.label}</text>
                  {/* one selective direct label: the most recent month */}
                  {i === newest && m.total > 0 && !active && (
                    <text className="bar-label" x={cx} y={yOf(m.total) - 7} textAnchor="middle">
                      {fmt(m.total, currency)}
                    </text>
                  )}
                </g>
              )
            })}
          </svg>

          {hover !== null && (
            <div className="chart-tip" style={{
              left: `${((PAD.left + band * hover + band / 2) / W) * 100}%`,
            }}>
              <strong>{monthly[hover].label} {monthly[hover].year}</strong>
              <div><i className="key s1" /> Group total <b>{fmt(monthly[hover].total, currency)}</b></div>
              <div><i className="key s2" /> Your share <b>{fmt(monthly[hover].mine, currency)}</b></div>
              <div className="muted">
                {monthly[hover].count} expense{monthly[hover].count === 1 ? '' : 's'}
              </div>
            </div>
          )}

          {!hasData && <p className="muted chart-empty">No expenses in the last 12 months.</p>}
        </div>
      )}
    </div>
  )
}
