import { AnsiUp } from 'ansi_up'
import { useLayoutEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

const MAX_RENDERED = 10_000

// Converts lines to HTML incrementally: only new lines are processed on each render, and a
// single AnsiUp instance per log carries colour state across lines like a terminal would.
function useAnsiHtml(lines) {
  const cache = useRef({ source: null, count: 0, html: [], ansi: null })
  const c = cache.current
  if (c.source !== lines && (lines.length < c.count || c.source?.[0] !== lines[0])) {
    c.count = 0
    c.html = []
    c.ansi = null
  }
  if (!c.ansi) {
    c.ansi = new AnsiUp()
    c.ansi.use_classes = false
  }
  for (let i = c.count; i < lines.length; i++) c.html.push(c.ansi.ansi_to_html(lines[i].line))
  c.count = lines.length
  c.source = lines
  return c.html
}

// Scrollable log with line numbers. Follows the tail while the user is at the bottom.
export function LogView({ lines, empty = 'No output.' }) {
  const html = useAnsiHtml(lines)
  const box = useRef(null)
  const pinned = useRef(true)

  useLayoutEffect(() => {
    if (pinned.current && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [html.length])

  const start = Math.max(0, lines.length - MAX_RENDERED)

  return (
    <div
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
      }}
      className="max-h-[60vh] overflow-auto rounded-lg bg-black/85 py-3 font-mono text-[12.5px] leading-5 text-neutral-200 dark:bg-black/60"
    >
      {lines.length === 0 && <div className="px-4 text-neutral-500">{empty}</div>}
      {start > 0 && <div className="px-4 pb-2 text-neutral-500">… {start} earlier lines hidden. Open the raw log for everything.</div>}
      <table className="w-full border-collapse">
        <tbody>
          {lines.slice(start).map((line, i) => (
            <tr key={start + i} className="hover:bg-white/5">
              <td className="w-12 select-none pr-4 pl-4 text-right align-top text-neutral-600 tabular-nums">{start + i + 1}</td>
              <td
                className={cn(
                  'pr-4 break-all whitespace-pre-wrap',
                  line.stream === 'stderr' && 'text-rose-200/90',
                  line.stream === 'info' && 'text-neutral-400 italic',
                )}
                dangerouslySetInnerHTML={{ __html: html[start + i] || '&nbsp;' }}
              />
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
