import { spawn } from 'node:child_process'

const KILL_GRACE_MS = 10_000
// After the script exits, how long to keep reading output from anything it left holding the
// pipes (e.g. a daemon started with setsid, which is outside the process group).
const PIPE_GRACE_MS = 2_000

// Called from timers and exit handlers, so it must never throw. ESRCH means the group is gone;
// macOS reports EPERM instead when the remaining members are zombies being reaped.
function killGroup(pid, signal) {
  try {
    process.kill(-pid, signal)
  } catch (err) {
    if (err.code !== 'ESRCH' && err.code !== 'EPERM') console.warn(`Failed to signal process group ${pid}:`, err)
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
    let stopping = false
    let finished = false
    let exit = { code: null, signal: null }
    const timers = []

    function finish() {
      if (finished) return
      finished = true
      for (const timer of timers) clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
      resolve({ exitCode: exit.code, signal: exit.signal, timedOut, cancelled })
    }

    function later(ms, fn) {
      const timer = setTimeout(fn, ms)
      timer.unref()
      timers.push(timer)
    }

    // Once only, so a timeout and a cancel don't leave a stray SIGKILL timer behind.
    function stop() {
      if (stopping) return
      stopping = true
      killGroup(child.pid, 'SIGTERM')
      later(KILL_GRACE_MS, () => killGroup(child.pid, 'SIGKILL'))
    }

    if (timeoutSec) {
      later(timeoutSec * 1000, () => {
        timedOut = true
        stop()
      })
    }

    const onAbort = () => {
      cancelled = true
      stop()
    }
    signal?.addEventListener('abort', onAbort, { once: true })

    child.stdout.on('data', (chunk) => onOutput('stdout', chunk))
    child.stderr.on('data', (chunk) => onOutput('stderr', chunk))

    child.on('error', (err) => {
      finished = true
      reject(err)
    })
    child.on('exit', (code, sig) => {
      exit = { code, signal: sig }
      killGroup(child.pid, 'SIGKILL')
      // 'close' waits for every holder of the pipes; don't let an escaped daemon hold the
      // step (and its concurrency slot) open forever.
      later(PIPE_GRACE_MS, () => {
        child.stdout.destroy()
        child.stderr.destroy()
        finish()
      })
    })
    child.on('close', finish)
  })
}
