import fs from 'node:fs/promises'
import path from 'node:path'
import { listBScriptFiles, resolveScriptPath, SCRIPTS_DIR } from './discover.js'
import { buildStepEnv } from './env.js'
import { runScript } from './executor/local.js'
import { createWorkspace, resolveRef, syncMirror } from './git.js'
import { createStepLog } from './logs.js'
import { collectRequirements, missingDeclared } from './requirements.js'

// Fails fast, before any step runs, when a script's `# @env NAME` contract isn't met. Only
// declared vars are enforced: inferred ones may sit on code paths that never execute.
async function checkDeclaredEnv(workspaceDir, steps, vars, includeSecrets) {
  const requirements = await collectRequirements({
    steps: steps.filter((step) => !step.continueOnError).map((step) => ({ name: step.name ?? step.script, scriptPath: step.script })),
    files: await listBScriptFiles(workspaceDir),
    read: (file) => fs.readFile(path.join(workspaceDir, SCRIPTS_DIR, file), 'utf8').catch(() => null),
  })
  const available = new Set(vars.filter((v) => includeSecrets || !v.secret).map((v) => v.key))
  const missing = missingDeclared(requirements, available)
  if (missing.length) {
    const list = missing.map((r) => `${r.name} (${r.steps.join(', ')})`).join(', ')
    throw new Error(`Missing required env vars: ${list}. Set them on the project, pipeline or environment.`)
  }
}

function now() {
  return new Date().toISOString()
}

function stepStatus(result) {
  if (result.cancelled) return 'cancelled'
  return result.exitCode === 0 ? 'success' : 'failed'
}

function describeFailure(result, timeoutSec) {
  if (result.timedOut) return `timed out after ${timeoutSec}s`
  if (result.signal) return `killed by ${result.signal}`
  return `exited with code ${result.exitCode}`
}

/**
 * Runs one pipeline end to end: fetch the repo, check out the commit, run each step with bash,
 * in order. Knows nothing about the database; callers persist state from the events.
 *
 * Steps stop at the first failure unless the failing step has continueOnError. A run whose only
 * failures are allowed ones counts as a success.
 *
 * Events: run:start, run:checkout, step:start, step:log, step:end, run:end.
 */
export async function runPipeline({
  runKey,
  repo,
  ref,
  steps,
  vars = [],
  includeSecrets = true,
  meta = {},
  paths,
  signal,
  keepWorkspace = false,
  onEvent = () => {},
}) {
  const workspaceDir = path.join(paths.workDir, String(runKey))
  const logDir = path.join(paths.logsDir, String(runKey))
  const results = steps.map((step, index) => ({
    index,
    name: step.name ?? step.script,
    script: step.script,
    status: 'pending',
    exitCode: null,
    logPath: path.join(logDir, `${index}.log`),
    startedAt: null,
    finishedAt: null,
  }))
  const summary = { status: 'running', commitSha: null, error: null, workspaceDir, steps: results }

  onEvent({ type: 'run:start', at: now() })
  try {
    await syncMirror({ url: repo.url, mirrorDir: repo.mirrorDir, auth: repo.auth, tmpDir: paths.tmpDir })
    summary.commitSha = await resolveRef(repo.mirrorDir, ref)
    await fs.rm(workspaceDir, { recursive: true, force: true })
    await createWorkspace({
      mirrorDir: repo.mirrorDir,
      sha: summary.commitSha,
      workspaceDir,
      originUrl: repo.url,
    })
    onEvent({ type: 'run:checkout', commitSha: summary.commitSha })
    await checkDeclaredEnv(workspaceDir, steps, vars, includeSecrets)

    let stopped = false
    for (const [index, step] of steps.entries()) {
      const result = results[index]
      if (stopped || signal?.aborted) {
        result.status = signal?.aborted ? 'cancelled' : 'skipped'
        continue
      }

      const { env, secrets } = buildStepEnv({
        vars,
        includeSecrets,
        builtins: {
          BSCRIPT_RUN_ID: runKey,
          BSCRIPT_PROJECT: meta.project,
          BSCRIPT_PIPELINE: meta.pipeline,
          BSCRIPT_TRIGGER: meta.trigger,
          BSCRIPT_REF: ref,
          BSCRIPT_BRANCH: meta.branch,
          BSCRIPT_PR_NUMBER: meta.prNumber,
          BSCRIPT_ENVIRONMENT: meta.environment,
          BSCRIPT_COMMIT_SHA: summary.commitSha,
          BSCRIPT_WORKSPACE: workspaceDir,
          BSCRIPT_STEP_NAME: result.name,
          BSCRIPT_STEP_INDEX: index,
        },
      })

      result.status = 'running'
      result.startedAt = now()
      onEvent({ type: 'step:start', index, name: result.name, script: step.script })

      const log = createStepLog({
        file: result.logPath,
        secrets,
        onLine: ({ stream, line }) => onEvent({ type: 'step:log', index, stream, line }),
      })

      let outcome
      try {
        const scriptFile = resolveScriptPath(workspaceDir, step.script)
        await fs.access(scriptFile)
        outcome = await runScript({
          scriptFile,
          cwd: workspaceDir,
          env,
          timeoutSec: step.timeoutSec,
          signal,
          onOutput: log.write,
        })
        if (outcome.exitCode !== 0 && !outcome.cancelled) {
          log.info(`Step ${describeFailure(outcome, step.timeoutSec)}`)
        }
      } catch (err) {
        log.info(err.code === 'ENOENT' ? `Script .BScript/${step.script} not found` : err.message)
        outcome = { exitCode: null, cancelled: false }
      } finally {
        await log.close()
      }

      result.status = stepStatus(outcome)
      result.exitCode = outcome.exitCode
      result.finishedAt = now()
      onEvent({ type: 'step:end', index, status: result.status, exitCode: result.exitCode })

      if (result.status === 'cancelled') stopped = true
      if (result.status === 'failed' && !step.continueOnError) stopped = true
    }

    const blocking = results.find(
      (r, i) => r.status === 'cancelled' || (r.status === 'failed' && !steps[i].continueOnError),
    )
    summary.status = !blocking ? 'success' : blocking.status === 'cancelled' ? 'cancelled' : 'failed'
  } catch (err) {
    summary.status = signal?.aborted ? 'cancelled' : 'failed'
    summary.error = err.message
    for (const result of results) {
      if (result.status === 'pending') result.status = 'skipped'
    }
  } finally {
    if (!keepWorkspace) await fs.rm(workspaceDir, { recursive: true, force: true })
  }

  onEvent({ type: 'run:end', status: summary.status, error: summary.error, at: now() })
  return summary
}
