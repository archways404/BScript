import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useReducer, useState } from 'react'

// Lines kept per step in the browser; the raw log link has the rest.
const MAX_LINES_PER_STEP = 10_000
const FLUSH_MS = 100
import { FINISHED } from '@/lib/format'
import { keys } from '@/lib/queries'

function reducer(state, action) {
  switch (action.type) {
    // Sent first on every (re)connect, followed by the buffered lines: start over.
    case 'snapshot':
      return { run: action.run, lines: {}, live: true }
    // Lines arrive in batches (see flush below): one copy per batch, not per line.
    case 'lines': {
      const lines = { ...state.lines }
      for (const [index, added] of Object.entries(action.byStep)) {
        const merged = (lines[index] ?? []).concat(added)
        lines[index] = merged.length > MAX_LINES_PER_STEP ? merged.slice(-MAX_LINES_PER_STEP) : merged
      }
      return { ...state, lines }
    }
    case 'step:start':
    case 'step:end': {
      const status = action.type === 'step:start' ? 'running' : action.status
      const now = new Date().toISOString()
      const steps = state.run.steps.map((step) =>
        step.position === action.index
          ? {
              ...step,
              status,
              exitCode: action.exitCode ?? step.exitCode,
              startedAt: action.type === 'step:start' ? now : step.startedAt,
              finishedAt: action.type === 'step:end' ? now : step.finishedAt,
            }
          : step,
      )
      return { ...state, run: { ...state.run, steps } }
    }
    case 'run:checkout':
      return { ...state, run: { ...state.run, commitSha: action.commitSha } }
    default:
      return state
  }
}

/**
 * Follows a run live over SSE while it is queued or running. Returns the stream's view of
 * the run (null until the first snapshot) and the log lines per step. `live` stays true
 * after the run ends so the page keeps the lines it already has instead of refetching.
 */
export function useRunStream(runId, initialStatus) {
  const queryClient = useQueryClient()
  const [state, dispatch] = useReducer(reducer, { run: null, lines: {}, live: false })
  const [generation, setGeneration] = useState(0)
  const follow = initialStatus !== undefined && !FINISHED.has(initialStatus)

  useEffect(() => {
    if (!follow) return
    const source = new EventSource(`/api/runs/${runId}/stream`)
    let buffer = {}
    const flush = () => {
      if (Object.keys(buffer).length === 0) return
      dispatch({ type: 'lines', byStep: buffer })
      buffer = {}
    }
    const flushTimer = setInterval(flush, FLUSH_MS)
    const finish = () => {
      flush()
      source.close()
      queryClient.invalidateQueries({ queryKey: keys.run(runId) })
    }

    source.addEventListener('snapshot', (e) => {
      const run = JSON.parse(e.data)
      buffer = {}
      dispatch({ type: 'snapshot', run })
      // A finished run's stream closes right away; stop EventSource from reconnecting.
      if (FINISHED.has(run.status)) finish()
    })
    source.addEventListener('step:log', (e) => {
      const line = JSON.parse(e.data)
      ;(buffer[line.index] ??= []).push(line)
    })
    // Status events flush pending lines first so output never lands after its step ended.
    for (const type of ['step:start', 'step:end', 'run:checkout']) {
      source.addEventListener(type, (e) => {
        flush()
        dispatch(JSON.parse(e.data))
      })
    }
    // A queued run has no steps yet; reconnect once it starts to get a snapshot with them.
    source.addEventListener('run:start', () => {
      clearInterval(flushTimer)
      source.close()
      queryClient.invalidateQueries({ queryKey: keys.run(runId) })
      setGeneration((g) => g + 1)
    })
    source.addEventListener('run:end', finish)
    return () => {
      clearInterval(flushTimer)
      source.close()
    }
  }, [runId, follow, generation, queryClient])

  return state
}
