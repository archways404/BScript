import { spawn } from 'node:child_process'

const KILL_GRACE_MS = 10_000

function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal)
  } catch (err) {
    if (err.code !== 'ESRCH') throw err
  }
}

// Runs one script with bash in its own process group so a timeout or cancel also takes down
// anything it started. Background processes still alive when the script exits are killed too;
// a step must not leak daemons into the next one.
export function runScript({ scriptFile, cwd, env, timeoutSec, signal, onOutput }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return resolve({ exitCode: null, signal: null, timedOut: false, cancelled: true })

    const child = spawn('bash', [scriptFile], {
      cwd,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })

    let timedOut = false
    let cancelled = false
    let exit = { code: null, signal: null }
    let graceTimer

    function stop() {
      killGroup(child.pid, 'SIGTERM')
      graceTimer = setTimeout(() => killGroup(child.pid, 'SIGKILL'), KILL_GRACE_MS)
      graceTimer.unref()
    }

    const timeoutTimer = timeoutSec
      ? setTimeout(() => {
          timedOut = true
          stop()
        }, timeoutSec * 1000)
      : null

    const onAbort = () => {
      cancelled = true
      stop()
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (chunk) => onOutput('stdout', chunk))
    child.stderr.on('data', (chunk) => onOutput('stderr', chunk))

    child.on('error', reject)
    child.on('exit', (code, sig) => {
      exit = { code, signal: sig }
      killGroup(child.pid, 'SIGKILL')
    })
    child.on('close', () => {
      clearTimeout(timeoutTimer)
      clearTimeout(graceTimer)
      signal?.removeEventListener('abort', onAbort)
      resolve({ exitCode: exit.code, signal: exit.signal, timedOut, cancelled })
    })
  })
}
