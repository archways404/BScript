import { EventEmitter } from 'node:events'
import fs from 'node:fs/promises'
import path from 'node:path'
import { HttpError } from '../http-error.js'
import { resolveRunEnv } from '../store/env-vars.js'
import { getPipeline } from '../store/pipelines.js'
import { getProject, getProjectAuth } from '../store/projects.js'
import {
  createRun,
  createStepRuns,
  failInterruptedRuns,
  getRun,
  nextStartableRun,
  pruneRuns,
  updateRun,
  updateStepRun,
} from '../store/runs.js'
import { now } from '../store/util.js'
import { runPipeline } from './pipeline.js'

// Lines kept in memory per step so a client that connects mid-run can catch up.
const REPLAY_LINES_PER_STEP = 5000

function isCommitSha(ref) {
  return /^[0-9a-f]{40}$/i.test(ref)
}

export function mirrorDirFor(config, projectId) {
  return path.join(config.reposDir, `project-${projectId}.git`)
}

export function runPaths(config) {
  return {
    reposDir: config.reposDir,
    workDir: config.workDir,
    logsDir: config.logsDir,
    tmpDir: path.join(config.dataDir, 'tmp'),
  }
}

export async function removeRunLogs(config, runIds) {
  await Promise.all(
    runIds.map((id) => fs.rm(path.join(config.logsDir, String(id)), { recursive: true, force: true })),
  )
}

/**
 * Persists and schedules runs. Queued runs live in SQLite, so they survive a restart; at most
 * `maxConcurrentRuns` execute at once and never two of the same pipeline.
 *
 * Emits on `events`:
 *   `run:<id>`  every runner event for that run (for the live log stream)
 *   `run`       { runId, pipelineId, status } whenever a run changes state (for lists)
 */
export function createRunQueue({ db, cipher, config, log = console }) {
  const events = new EventEmitter()
  events.setMaxListeners(0)
  const active = new Map()
  let stopped = true

  function publish(run, event) {
    events.emit(`run:${run.id}`, event)
    if (event.type.startsWith('run:')) {
      const status = event.status ?? getRun(db, run.id)?.status
      events.emit('run', { runId: run.id, pipelineId: run.pipelineId, status })
    }
  }

  function enqueue({ pipelineId, trigger, ref, branch, prNumber = null, fromFork = false, triggeredBy = null }) {
    const pipeline = getPipeline(db, pipelineId)
    if (!pipeline) throw new HttpError(404, 'Pipeline not found')
    if (!pipeline.steps.length) throw new HttpError(400, 'Pipeline has no steps')
    const project = getProject(db, pipeline.projectId)
    const resolvedRef = ref || project.defaultBranch
    const run = createRun(db, {
      pipelineId,
      trigger,
      ref: resolvedRef,
      // A branch name given as the ref is the branch; a commit sha says nothing about one.
      branch: branch ?? (isCommitSha(resolvedRef) ? null : resolvedRef.replace(/^refs\/heads\//, '')),
      prNumber,
      fromFork,
      triggeredBy,
    })
    publish(run, { type: 'run:queued', status: 'queued' })
    setImmediate(tick)
    return run
  }

  function tick() {
    while (!stopped && active.size < config.maxConcurrentRuns) {
      const runId = nextStartableRun(db)
      if (!runId) return
      start(runId)
    }
  }

  // Marks the run running synchronously, so the next tick() can't pick the same pipeline.
  function start(runId) {
    const run = getRun(db, runId)
    const pipeline = getPipeline(db, run.pipelineId)
    const logDir = path.join(config.logsDir, String(run.id))
    db.transaction(() => {
      updateRun(db, run.id, { status: 'running', startedAt: now() })
      createStepRuns(db, run.id, pipeline.steps, (position) => path.join(logDir, `${position}.log`))
    })()

    const entry = {
      controller: new AbortController(),
      replay: pipeline.steps.map(() => []),
      done: null,
    }
    active.set(run.id, entry)
    publish(run, { type: 'run:start', status: 'running' })

    entry.done = execute(run, pipeline, entry)
      .catch((err) => {
        log.error({ err, runId: run.id }, 'Run crashed')
        updateRun(db, run.id, { status: 'failed', error: err.message, finishedAt: now() })
        publish(run, { type: 'run:end', status: 'failed', error: err.message })
      })
      .finally(async () => {
        active.delete(run.id)
        const pruned = pruneRuns(db, run.pipelineId, config.runRetention)
        await removeRunLogs(config, pruned).catch((err) => log.warn({ err }, 'Failed to remove old logs'))
        tick()
      })
  }

  async function execute(run, pipeline, entry) {
    const project = getProject(db, pipeline.projectId)

    function onEvent(event) {
      switch (event.type) {
        case 'run:checkout':
          updateRun(db, run.id, { commitSha: event.commitSha })
          break
        case 'step:start':
          updateStepRun(db, run.id, event.index, { status: 'running', startedAt: now() })
          break
        case 'step:log': {
          const lines = entry.replay[event.index]
          lines.push(event)
          if (lines.length > REPLAY_LINES_PER_STEP) lines.shift()
          break
        }
        case 'step:end':
          updateStepRun(db, run.id, event.index, {
            status: event.status,
            exitCode: event.exitCode,
            finishedAt: now(),
          })
          break
        case 'run:start':
        case 'run:end':
          return // published by the queue once the DB reflects them
      }
      publish(run, event)
    }

    const summary = await runPipeline({
      runKey: run.id,
      repo: {
        url: project.repoUrl,
        auth: getProjectAuth(db, cipher, project.id),
        mirrorDir: mirrorDirFor(config, project.id),
      },
      ref: run.ref,
      steps: pipeline.steps.map((step) => ({
        name: step.name,
        script: step.scriptPath,
        continueOnError: step.continueOnError,
        timeoutSec: step.timeoutSec,
      })),
      vars: resolveRunEnv(db, cipher, project.id, pipeline.id),
      includeSecrets: !run.fromFork,
      meta: {
        project: project.name,
        pipeline: pipeline.name,
        trigger: run.trigger,
        branch: run.branch ?? undefined,
        prNumber: run.prNumber ?? undefined,
      },
      paths: runPaths(config),
      signal: entry.controller.signal,
      onEvent,
    })

    db.transaction(() => {
      summary.steps.forEach((step, position) => {
        if (step.status === 'skipped' || step.status === 'cancelled') {
          updateStepRun(db, run.id, position, { status: step.status })
        }
      })
      updateRun(db, run.id, {
        status: summary.status,
        commitSha: summary.commitSha,
        error: summary.error,
        finishedAt: now(),
      })
    })()
    publish(run, { type: 'run:end', status: summary.status, error: summary.error })
  }

  function cancel(runId) {
    const run = getRun(db, runId)
    if (!run) throw new HttpError(404, 'Run not found')
    if (run.status === 'queued') {
      updateRun(db, runId, { status: 'cancelled', finishedAt: now() })
      publish(run, { type: 'run:end', status: 'cancelled' })
      return
    }
    const entry = active.get(runId)
    if (!entry) throw new HttpError(409, `Run is already ${run.status}`)
    entry.controller.abort()
  }

  // Snapshot of buffered lines plus a subscription, taken in the same tick so nothing is lost
  // or duplicated between them.
  function subscribe(runId, listener) {
    const entry = active.get(runId)
    const replay = entry ? entry.replay.flat() : []
    events.on(`run:${runId}`, listener)
    return { replay, unsubscribe: () => events.off(`run:${runId}`, listener) }
  }

  return {
    events,
    enqueue,
    cancel,
    subscribe,

    async start() {
      const interrupted = failInterruptedRuns(db)
      if (interrupted.length) log.warn(`Marked ${interrupted.length} interrupted run(s) as failed`)
      await fs.rm(config.workDir, { recursive: true, force: true })
      stopped = false
      tick()
    },

    // Cancels active runs and waits for them to wind down.
    async stop() {
      stopped = true
      for (const entry of active.values()) entry.controller.abort()
      await Promise.allSettled([...active.values()].map((entry) => entry.done))
    },

    setLogger(logger) {
      log = logger
    },

    get activeCount() {
      return active.size
    },
  }
}
