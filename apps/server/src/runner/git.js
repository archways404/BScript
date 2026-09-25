import { execFile } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import { SCRIPTS_DIR, isHelperPath, isScript } from './discover.js'

const mirrorLocks = new Map()

function run(args, { cwd, env = {} } = {}) {
  return new Promise((resolve, reject) => {
    execFile(
      'git',
      args,
      {
        cwd,
        maxBuffer: 64 * 1024 * 1024,
        env: {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          GIT_TERMINAL_PROMPT: '0',
          ...env,
        },
      },
      (err, stdout, stderr) => {
        if (err) {
          err.message = `git ${args[0]} failed: ${stderr.trim() || err.message}`
          return reject(err)
        }
        resolve(stdout)
      },
    )
  })
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`
}

// Credentials are passed through env (GIT_CONFIG_* / GIT_SSH_COMMAND) so they never land in
// argv, where `ps` could show them, or in the mirror's git config.
async function withAuth(auth, tmpDir, fn) {
  if (!auth || auth.type === 'none') return fn({})

  if (auth.type === 'token') {
    const basic = Buffer.from(`x-access-token:${auth.token}`).toString('base64')
    return fn({
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.extraHeader',
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
    })
  }

  if (auth.type === 'ssh') {
    await fs.mkdir(tmpDir, { recursive: true })
    const keyFile = path.join(tmpDir, `key-${crypto.randomUUID()}`)
    const knownHosts = path.join(tmpDir, 'known_hosts')
    const key = auth.privateKey.endsWith('\n') ? auth.privateKey : `${auth.privateKey}\n`
    await fs.writeFile(keyFile, key, { mode: 0o600 })
    try {
      return await fn({
        GIT_SSH_COMMAND: [
          'ssh',
          `-i ${shellQuote(keyFile)}`,
          '-o IdentitiesOnly=yes',
          '-o StrictHostKeyChecking=accept-new',
          `-o UserKnownHostsFile=${shellQuote(knownHosts)}`,
        ].join(' '),
      })
    } finally {
      await fs.rm(keyFile, { force: true })
    }
  }

  throw new Error(`Unknown auth type "${auth.type}"`)
}

async function exists(file) {
  try {
    await fs.access(file)
    return true
  } catch {
    return false
  }
}

// One bare mirror per repo, cloned once and fetched before every run. Runs against the same
// mirror are serialised so concurrent fetches don't fight over refs.
export async function syncMirror({ url, mirrorDir, auth, tmpDir }) {
  const previous = mirrorLocks.get(mirrorDir) ?? Promise.resolve()
  const current = previous.catch(() => {}).then(async () => {
    await withAuth(auth, tmpDir, async (env) => {
      if (await exists(path.join(mirrorDir, 'HEAD'))) {
        await run(['remote', 'set-url', 'origin', url], { cwd: mirrorDir })
        await run(['fetch', '--prune', '--quiet', 'origin'], { cwd: mirrorDir, env })
        return
      }
      await fs.mkdir(path.dirname(mirrorDir), { recursive: true })
      try {
        await run(['clone', '--mirror', '--quiet', '--', url, mirrorDir], { env })
      } catch (err) {
        await fs.rm(mirrorDir, { recursive: true, force: true })
        throw err
      }
    })
  })
  mirrorLocks.set(mirrorDir, current)
  try {
    await current
  } finally {
    if (mirrorLocks.get(mirrorDir) === current) mirrorLocks.delete(mirrorDir)
  }
}

export async function resolveRef(mirrorDir, ref) {
  const candidates = /^[0-9a-f]{7,40}$/i.test(ref)
    ? [ref]
    : [`refs/heads/${ref}`, `refs/tags/${ref}`, ref]
  for (const candidate of candidates) {
    try {
      const sha = await run(['rev-parse', '--verify', '--quiet', `${candidate}^{commit}`], {
        cwd: mirrorDir,
      })
      return sha.trim()
    } catch {
      // try the next candidate
    }
  }
  throw new Error(`Ref "${ref}" not found in repository`)
}

// A throwaway local clone at an exact commit. Local clones hardlink objects, so this is cheap.
export async function createWorkspace({ mirrorDir, sha, workspaceDir, originUrl }) {
  await fs.mkdir(path.dirname(workspaceDir), { recursive: true })
  await run(['clone', '--quiet', '--no-checkout', '--', mirrorDir, workspaceDir])
  await run(['-c', 'advice.detachedHead=false', 'checkout', '--quiet', '--detach', sha], {
    cwd: workspaceDir,
  })
  if (originUrl) await run(['remote', 'set-url', 'origin', originUrl], { cwd: workspaceDir })
}

// Lists .BScript scripts at a commit straight from the mirror, without a checkout. Used by the
// UI to offer scripts when building a pipeline.
export async function listScriptsAtCommit(mirrorDir, sha) {
  let out
  try {
    out = await run(['ls-tree', '-r', '-z', '--full-tree', sha, '--', SCRIPTS_DIR], {
      cwd: mirrorDir,
    })
  } catch {
    return []
  }
  return out
    .split('\0')
    .filter(Boolean)
    .map((line) => {
      const [meta, file] = line.split('\t')
      const [mode, type] = meta.split(' ')
      return { mode: Number.parseInt(mode, 8), type, file }
    })
    .filter(({ type, file, mode }) => type === 'blob' && isScript(path.posix.basename(file), mode))
    .map(({ file }) => file.slice(SCRIPTS_DIR.length + 1))
    .filter((file) => !isHelperPath(file))
    .sort()
}
