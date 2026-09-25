import { AnsiUp } from 'ansi_up'
import { Check, ChevronDown, ChevronUp, Copy, Download, Search, WrapText } from 'lucide-react'
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

const ANSI = /\x1b\[[0-9;?]*[A-Za-z]/g
const plain = (line) => line.line.replace(ANSI, '')
const WRAP_KEY = 'bscript-log-wrap'

function readWrap() {
  try {
    return localStorage.getItem(WRAP_KEY) !== '0'
  } catch {
    return true
  }
}

/**
 * Scrollable log with line numbers and a toolbar: search (Enter / Shift+Enter to step through
 * matches, Esc to clear), matches-only, wrap, copy and download. Follows the tail while the
 * user is at the bottom and not searching.
 */
export function LogView({ lines, empty = 'No output.', downloadName = 'log.txt' }) {
  const html = useAnsiHtml(lines)
  const box = useRef(null)
  const pinned = useRef(true)
  const [query, setQuery] = useState('')
  const [current, setCurrent] = useState(0)
  const [onlyMatches, setOnlyMatches] = useState(false)
  const [wrap, setWrap] = useState(readWrap)
  const [copied, setCopied] = useState(false)

  const needle = query.trim().toLowerCase()
  const matches = useMemo(() => {
    if (!needle) return []
    const found = []
    lines.forEach((line, i) => plain(line).toLowerCase().includes(needle) && found.push(i))
    return found
  }, [lines, needle])
  const matchSet = useMemo(() => new Set(matches), [matches])
  const currentLine = matches.length ? matches[Math.min(current, matches.length - 1)] : null

  useLayoutEffect(() => {
    if (!needle && pinned.current && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [html.length, needle])

  useEffect(() => {
    if (currentLine == null || !box.current) return
    // Scroll the log box only; scrollIntoView would also move the page.
    const row = box.current.querySelector(`[data-line="${currentLine}"]`)
    if (row) box.current.scrollTop = row.offsetTop - box.current.clientHeight / 2 + row.offsetHeight / 2
  }, [currentLine])

  function step(delta) {
    if (!matches.length) return
    setCurrent((c) => (Math.min(c, matches.length - 1) + delta + matches.length) % matches.length)
  }

  function toggleWrap() {
    setWrap((w) => {
      try {
        localStorage.setItem(WRAP_KEY, w ? '0' : '1')
      } catch {
        // storage unavailable: the choice lasts for this page only
      }
      return !w
    })
  }

  async function copy() {
    await navigator.clipboard.writeText(lines.map(plain).join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  function download() {
    const url = URL.createObjectURL(new Blob([`${lines.map(plain).join('\n')}\n`], { type: 'text/plain' }))
    const a = Object.assign(document.createElement('a'), { href: url, download: downloadName })
    a.click()
    URL.revokeObjectURL(url)
  }

  const start = Math.max(0, lines.length - MAX_RENDERED)
  const shown = []
  for (let i = start; i < lines.length; i++) if (!onlyMatches || !needle || matchSet.has(i)) shown.push(i)

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap items-center gap-1.5">
        <div className="relative min-w-40 flex-1 sm:max-w-72">
          <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value)
              setCurrent(0)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                step(e.shiftKey ? -1 : 1)
              } else if (e.key === 'Escape') {
                setQuery('')
              }
            }}
            placeholder="Search log"
            className="h-8 pl-8 text-sm"
            aria-label="Search log"
          />
        </div>
        {needle && (
          <>
            <span className="text-muted-foreground min-w-16 text-xs tabular-nums" aria-live="polite">
              {matches.length ? `${Math.min(current, matches.length - 1) + 1} / ${matches.length}` : 'No matches'}
            </span>
            <Button variant="ghost" size="icon" className="size-8" onClick={() => step(-1)} disabled={!matches.length} aria-label="Previous match">
              <ChevronUp />
            </Button>
            <Button variant="ghost" size="icon" className="size-8" onClick={() => step(1)} disabled={!matches.length} aria-label="Next match">
              <ChevronDown />
            </Button>
            <Button variant={onlyMatches ? 'secondary' : 'ghost'} size="sm" className="h-8" onClick={() => setOnlyMatches(!onlyMatches)} aria-pressed={onlyMatches}>
              Matches only
            </Button>
          </>
        )}
        <div className="ml-auto flex items-center gap-0.5">
          <Button variant={wrap ? 'secondary' : 'ghost'} size="icon" className="size-8" onClick={toggleWrap} aria-pressed={wrap} title="Wrap long lines" aria-label="Wrap long lines">
            <WrapText />
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={copy} disabled={!lines.length} title="Copy log" aria-label="Copy log">
            {copied ? <Check className="text-success" /> : <Copy />}
          </Button>
          <Button variant="ghost" size="icon" className="size-8" onClick={download} disabled={!lines.length} title="Download log" aria-label="Download log">
            <Download />
          </Button>
        </div>
      </div>

      <div
        ref={box}
        onScroll={(e) => {
          const el = e.currentTarget
          pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24
        }}
        className="max-h-[60vh] overflow-auto rounded-lg bg-black/85 py-3 font-mono text-[12.5px] leading-5 text-neutral-200 dark:bg-black/60"
      >
        {lines.length === 0 && <div className="px-4 text-neutral-500">{empty}</div>}
        {start > 0 && <div className="px-4 pb-2 text-neutral-500">… {start} earlier lines hidden. Download or open the raw log for everything.</div>}
        <table className={cn('border-collapse', wrap ? 'w-full' : 'min-w-full')}>
          <tbody>
            {shown.map((i) => {
              const line = lines[i]
              return (
                <tr
                  key={i}
                  data-line={i}
                  className={cn(
                    'hover:bg-white/5',
                    matchSet.has(i) && 'bg-amber-300/10',
                    i === currentLine && 'bg-amber-300/15 outline outline-1 -outline-offset-1 outline-amber-300/60',
                  )}
                >
                  <td className="w-12 pr-4 pl-4 text-right align-top text-neutral-600 tabular-nums select-none">{i + 1}</td>
                  <td
                    className={cn(
                      'pr-4',
                      wrap ? 'break-all whitespace-pre-wrap' : 'whitespace-pre',
                      line.stream === 'stderr' && 'text-rose-200/90',
                      line.stream === 'info' && 'text-neutral-400 italic',
                    )}
                    dangerouslySetInnerHTML={{ __html: html[i] || '&nbsp;' }}
                  />
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
