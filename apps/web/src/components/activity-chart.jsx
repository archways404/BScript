import { Table2, BarChart3 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { plural } from '@/lib/format'

const WIDTH = 560
const SLOT = WIDTH / 14
const BAR = Math.min(24, SLOT * 0.55)
const RADIUS = 4

// A column rounded at the data end and square at the baseline.
function columnPath(x, y, width, height) {
  if (height <= 0) return ''
  const r = Math.min(RADIUS, height, width / 2)
  return `M${x},${y + height} V${y + r} Q${x},${y} ${x + r},${y} H${x + width - r} Q${x + width},${y} ${x + width},${y + r} V${y + height} Z`
}

const dayLabel = (date, style = 'short') =>
  new Date(`${date}T12:00:00Z`).toLocaleDateString(undefined, style === 'short' ? { month: 'short', day: 'numeric' } : { weekday: 'long', month: 'long', day: 'numeric' })

function Row({ title, icon, days, value, color, height, max, hover, setHover }) {
  const scale = (n) => (max ? (n / max) * (height - 6) : 0)
  return (
    <div>
      <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs">
        {icon}
        {title}
        <span className="ml-auto tabular-nums">max {max}</span>
      </div>
      <svg viewBox={`0 0 ${WIDTH} ${height}`} className="block h-auto w-full overflow-visible" role="presentation">
        <line x1="0" x2={WIDTH} y1={height - 0.5} y2={height - 0.5} className="stroke-border" strokeWidth="1" />
        {days.map((day, i) => {
          const h = scale(value(day))
          return (
            <g key={day.date}>
              {hover === i && <rect x={i * SLOT} y="0" width={SLOT} height={height} className="fill-accent" rx="4" />}
              <path d={columnPath(i * SLOT + (SLOT - BAR) / 2, height - 1 - h, BAR, h)} fill={color} />
              {/* Hit target: the whole slot, far larger than the mark. */}
              <rect
                x={i * SLOT}
                y="0"
                width={SLOT}
                height={height}
                fill="transparent"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/**
 * Runs and failures per day as two aligned single-series column charts (small multiples),
 * so reading them never depends on telling red from green. Hover a day for its numbers, or
 * switch to the table.
 */
export function ActivityChart({ daily }) {
  const [hover, setHover] = useState(null)
  const [table, setTable] = useState(false)
  const max = Math.max(1, ...daily.map((d) => d.total))
  const maxFailed = Math.max(1, ...daily.map((d) => d.failed))
  const day = hover != null ? daily[hover] : null

  return (
    <div className="glass rounded-xl p-4">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-sm font-medium">Activity</h2>
        <span className="text-muted-foreground text-xs">last 14 days (UTC)</span>
        <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setTable(!table)} aria-pressed={table}>
          {table ? <BarChart3 /> : <Table2 />} {table ? 'Chart' : 'Table'}
        </Button>
      </div>

      {daily.every((d) => d.total === 0) ? (
        <p className="text-muted-foreground py-12 text-center text-sm">No runs in the last 14 days.</p>
      ) : table ? (
        <div className="max-h-64 overflow-auto">
          <table className="w-full text-sm">
            <thead className="text-muted-foreground text-left text-xs">
              <tr>
                <th className="py-1 font-normal">Day</th>
                <th className="py-1 text-right font-normal">Runs</th>
                <th className="py-1 text-right font-normal">Succeeded</th>
                <th className="py-1 text-right font-normal">Failed</th>
                <th className="py-1 text-right font-normal">Cancelled</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y tabular-nums">
              {[...daily].reverse().map((d) => (
                <tr key={d.date}>
                  <td className="py-1">{dayLabel(d.date)}</td>
                  <td className="py-1 text-right">{d.total}</td>
                  <td className="py-1 text-right">{d.success}</td>
                  <td className="py-1 text-right">{d.failed}</td>
                  <td className="py-1 text-right">{d.cancelled}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="relative grid gap-3">
          <Row title="Runs" days={daily} value={(d) => d.total} color="var(--chart-runs)" height={72} max={max} hover={hover} setHover={setHover} />
          <Row
            title="Failures"
            icon={<span aria-hidden className="text-[var(--chart-failed)]">✕</span>}
            days={daily}
            value={(d) => d.failed}
            color="var(--chart-failed)"
            height={36}
            max={maxFailed}
            hover={hover}
            setHover={setHover}
          />
          <div className="text-muted-foreground flex justify-between text-[11px]">
            <span>{dayLabel(daily[0].date)}</span>
            <span>{dayLabel(daily[7].date)}</span>
            <span>Today</span>
          </div>
          {day && (
            <div
              className="bg-popover text-popover-foreground pointer-events-none absolute top-0 z-10 w-44 -translate-y-2 rounded-lg border px-3 py-2 text-xs shadow-xl backdrop-blur-xl"
              style={{ left: `clamp(0px, calc(${((hover + 0.5) / 14) * 100}% - 5.5rem), calc(100% - 11rem))` }}
            >
              <div className="mb-1 font-medium">{dayLabel(day.date, 'long')}</div>
              <div className="flex justify-between"><span className="text-muted-foreground">Runs</span><span className="tabular-nums">{day.total}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Succeeded</span><span className="tabular-nums">{day.success}</span></div>
              <div className="flex justify-between"><span className="text-muted-foreground">Failed</span><span className="tabular-nums">{day.failed}</span></div>
              {day.cancelled > 0 && <div className="flex justify-between"><span className="text-muted-foreground">Cancelled</span><span className="tabular-nums">{day.cancelled}</span></div>}
            </div>
          )}
        </div>
      )}
      <p className="sr-only">{plural(daily.reduce((s, d) => s + d.total, 0), 'run')} in the last 14 days, of which {daily.reduce((s, d) => s + d.failed, 0)} failed.</p>
    </div>
  )
}
