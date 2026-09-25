import { Cron } from 'croner'
import fs from 'node:fs/promises'
import path from 'node:path'
import { HttpError } from '../http-error.js'
import {
  failInterruptedCleanups,
  finishCleanup,
  getRegistrySettings,
  listExternalRegistryCredentials,
  listRepositories,
  listTags,
  markPulled,
  removeDigest,
  removeTag,
  setDigestSize,
  startCleanup,
  syncTags,
  upsertTag,
} from '../store/registry.js'
import { createRegistryAuth, RUN_USER } from './auth.js'
import { writeDockerConfig } from './docker-config.js'
import { createRegistryProcess } from './process.js'
import { planCleanup } from './retention.js'

export const MANIFEST_TYPES = [
  'application/vnd.oci.image.index.v1+json',
  'application/vnd.oci.image.manifest.v1+json',
  'application/vnd.docker.distribution.manifest.list.v2+json',
  'application/vnd.docker.distribution.manifest.v2+json',
]
const INDEX_TYPES = new Set([MANIFEST_TYPES[0], MANIFEST_TYPES[2]])
const ACCEPT = MANIFEST_TYPES.join(', ')
const DISK_CACHE_MS = 60_000
// Sent on BScript's own registry requests, so reading a manifest to size it isn't a "pull".
const INTERNAL_AGENT = 'bscript-internal'
const DRAIN_TIMEOUT_MS = 5 * 60_000
// A push is many requests (blob uploads, then the manifest). Waiting for a quiet spell, not
// just zero open requests, keeps garbage collection from sweeping a half-pushed image's blobs.
const QUIET_MS = 10_000

async function directorySize(dir) {
  let total = 0
  try {
    for (const entry of await fs.readdir(dir, { recursive: true, withFileTypes: true })) {
      if (entry.isFile()) total += (await fs.stat(path.join(entry.parentPath, entry.name))).size
    }
  } catch (err) {
    if (err.code !== 'ENOENT') throw err
  }
  return total
}

// Follows the registry's RFC 5988 pagination (Link: <...>; rel="next").
async function fetchAllPages(url, pick) {
  const items = []
  let next = url
  while (next) {
    const res = await fetch(next, { headers: { 'user-agent': INTERNAL_AGENT } })
    if (!res.ok) throw new Error(`${next} answered ${res.status}`)
    items.push(...(pick(await res.json()) ?? []))
    const link = res.headers.get('link')?.match(/<([^>]+)>;\s*rel="next"/)?.[1]
    next = link ? new URL(link, next).toString() : null
  }
  return items
}

export function createRegistryService({ db, cipher, config, log = console }) {
  const registryProcess = createRegistryProcess({ config, log })
  const auth = createRegistryAuth({ db })
  let writesInFlight = 0
  let lastWriteAt = 0
  let cleanupRunning = false
  let diskCache = { at: 0, bytes: 0 }
  let cleanupJob = null

  const internal = (pathname, init = {}) =>
    fetch(registryProcess.url(pathname), { ...init, headers: { 'user-agent': INTERNAL_AGENT, ...init.headers } })
  const encodeRepo = (repository) => repository.split('/').map(encodeURIComponent).join('/')

  async function fetchManifest(repository, reference) {
    const res = await internal(`/v2/${encodeRepo(repository)}/manifests/${reference}`, { headers: { accept: ACCEPT } })
    if (!res.ok) throw new Error(`Manifest ${repository}@${reference}: ${res.status}`)
    return { json: await res.json(), mediaType: res.headers.get('content-type'), digest: res.headers.get('docker-content-digest') }
  }

  // Compressed size as stored: config plus layers, summed over every platform of an index.
  async function imageSize(repository, digest) {
    const { json, mediaType } = await fetchManifest(repository, digest)
    if (INDEX_TYPES.has(json.mediaType ?? mediaType)) {
      let total = 0
      for (const child of json.manifests ?? []) total += await imageSize(repository, child.digest).catch(() => child.size ?? 0)
      return total
    }
    return (json.config?.size ?? 0) + (json.layers ?? []).reduce((sum, layer) => sum + (layer.size ?? 0), 0)
  }

  function recordSize(repository, digest) {
    imageSize(repository, digest)
      .then((size) => setDigestSize(db, repository, digest, size))
      .catch((err) => log.warn({ repository, digest, err: err.message }, 'Could not size image'))
  }

  // The registry notifies on every blob and manifest; only manifests matter here.
  function handleEvent(event) {
    const { action, target = {} } = event
    const repository = target.repository
    if (!repository) return
    if (action === 'delete') {
      if (target.tag) removeTag(db, repository, target.tag)
      else if (target.digest) removeDigest(db, repository, target.digest)
      diskCache.at = 0
      return
    }
    if (!MANIFEST_TYPES.includes(target.mediaType)) return
    if (action === 'push' && target.tag) {
      upsertTag(db, { repository, tag: target.tag, digest: target.digest, mediaType: target.mediaType, pushedAt: event.timestamp })
      recordSize(repository, target.digest)
      diskCache.at = 0
    } else if (action === 'pull' && target.digest && event.request?.useragent !== INTERNAL_AGENT) {
      markPulled(db, repository, target.digest, event.timestamp)
    }
  }

  function requireRunning() {
    if (!registryProcess.upstream) throw new HttpError(503, `Registry is ${registryProcess.status().state}`)
  }

  // Makes the metadata match the registry: picks up tags from before BScript was watching,
  // or whose notification was lost. Newly found tags are dated now.
  async function sync() {
    requireRunning()
    const repositories = await fetchAllPages(registryProcess.url('/v2/_catalog?n=1000'), (body) => body.repositories)
    const present = []
    for (const repository of repositories) {
      const tags = await fetchAllPages(registryProcess.url(`/v2/${encodeRepo(repository)}/tags/list?n=1000`), (body) => body.tags)
      for (const tag of tags) {
        const res = await internal(`/v2/${encodeRepo(repository)}/manifests/${encodeURIComponent(tag)}`, {
          method: 'HEAD',
          headers: { accept: ACCEPT },
        })
        if (res.ok) present.push({ repository, tag, digest: res.headers.get('docker-content-digest'), mediaType: res.headers.get('content-type') })
      }
    }
    const result = syncTags(db, present)
    for (const tag of listTags(db).filter((t) => t.size == null)) recordSize(tag.repository, tag.digest)
    return result
  }

  async function deleteTags(items) {
    requireRunning()
    const results = []
    for (const { repository, tag } of items) {
      const res = await internal(`/v2/${encodeRepo(repository)}/manifests/${encodeURIComponent(tag)}`, { method: 'DELETE' })
      // 404: already gone from the registry, so the metadata should go too.
      if (res.ok || res.status === 404) removeTag(db, repository, tag)
      results.push({ repository, tag, ok: res.ok || res.status === 404, status: res.status })
    }
    diskCache.at = 0
    return results
  }

  async function diskUsage() {
    if (Date.now() - diskCache.at > DISK_CACHE_MS) diskCache = { at: Date.now(), bytes: await directorySize(registryProcess.status().storageDir) }
    return diskCache.bytes
  }

  async function waitForQuiet() {
    const deadline = Date.now() + DRAIN_TIMEOUT_MS
    const quietMs = config.registryQuietMs ?? QUIET_MS
    while (writesInFlight > 0 || Date.now() - lastWriteAt < quietMs) {
      if (Date.now() > deadline) throw new Error('The registry kept receiving pushes; garbage collection skipped, try again later')
      await new Promise((r) => setTimeout(r, 250))
    }
  }

  /**
   * Deletes the tags the retention policy picks, then garbage-collects: untagged manifests and
   * unreferenced blobs are removed with the registry stopped, since GC must not race pushes.
   * `plan: false` skips tag deletion (garbage collection only).
   */
  async function cleanup({ trigger = 'manual', plan = true } = {}) {
    if (cleanupRunning) throw new HttpError(409, 'A cleanup is already running')
    requireRunning()
    cleanupRunning = true
    const id = startCleanup(db, trigger)
    const lines = []
    let deleted = 0
    try {
      if (plan) {
        await sync()
        const { tags } = planCleanup(listTags(db), getRegistrySettings(db).retention)
        for (const result of await deleteTags(tags)) {
          if (result.ok) deleted++
          lines.push(`${result.ok ? 'deleted' : `failed (${result.status})`} ${result.repository}:${result.tag}`)
        }
      }
      await waitForQuiet()
      const before = await directorySize(registryProcess.status().storageDir)
      const gc = await registryProcess.whileStopped(({ configFile }) => registryProcess.runCommand(['garbage-collect', configFile, '--delete-untagged']))
      const after = await directorySize(registryProcess.status().storageDir)
      diskCache = { at: Date.now(), bytes: after }
      lines.push('', '$ registry garbage-collect --delete-untagged', gc.output.slice(-20_000))
      if (!gc.ok) throw new Error(`Garbage collection failed: ${gc.error}`)
      finishCleanup(db, id, { status: 'success', deletedTags: deleted, freedBytes: Math.max(0, before - after), log: lines.join('\n') })
    } catch (err) {
      finishCleanup(db, id, { status: 'failed', deletedTags: deleted, error: err.message, log: lines.join('\n') })
      log.error({ err: err.message }, 'Registry cleanup failed')
    } finally {
      cleanupRunning = false
    }
    return id
  }

  function scheduleCleanup() {
    cleanupJob?.stop()
    cleanupJob = null
    const { enabled, retention } = getRegistrySettings(db)
    if (!enabled || !retention.enabled || !retention.schedule) return
    try {
      cleanupJob = new Cron(retention.schedule, { protect: true }, () =>
        cleanup({ trigger: 'schedule' }).catch((err) => log.warn({ err: err.message }, 'Scheduled cleanup skipped')),
      )
    } catch (err) {
      log.warn({ err: err.message }, 'Invalid registry cleanup schedule')
    }
  }

  return {
    process: registryProcess,
    auth,
    handleEvent,
    sync,
    deleteTags,
    cleanup,
    scheduleCleanup,

    planCleanup() {
      return planCleanup(listTags(db), getRegistrySettings(db).retention)
    },

    // Proxy bookkeeping, so maintenance can wait for pushes in progress.
    beginWrite() {
      writesInFlight++
      lastWriteAt = Date.now()
    },
    endWrite() {
      writesInFlight = Math.max(0, writesInFlight - 1)
      lastWriteAt = Date.now()
    },

    async overview() {
      const repositories = listRepositories(db)
      return {
        ...registryProcess.status(),
        address: config.registryAddress,
        cleanupRunning,
        nextCleanupAt: cleanupJob?.nextRun()?.toISOString() ?? null,
        settings: getRegistrySettings(db),
        usage: {
          repositories: repositories.length,
          tags: repositories.reduce((sum, r) => sum + r.tags, 0),
          diskBytes: await diskUsage(),
        },
        repositories,
      }
    },

    /**
     * Credentials for one run: a Docker config.json with every external registry plus the
     * local one (via a token that dies with the run), exposed through DOCKER_CONFIG. Nothing
     * for runs without secrets (fork PRs).
     */
    async prepareRun(runId, { includeSecrets, tmpDir }) {
      const none = { vars: [], maskValues: [], release: async () => {} }
      if (!includeSecrets) return none
      const registries = listExternalRegistryCredentials(db, cipher).filter((r) => r.username && r.password)
      const vars = []
      let token = null
      if (getRegistrySettings(db).enabled && registryProcess.upstream) {
        token = auth.issueRunToken(runId)
        registries.push({ url: `http://${config.registryAddress}`, username: RUN_USER, password: token })
        vars.push(
          { key: 'BSCRIPT_REGISTRY', value: config.registryAddress },
          { key: 'BSCRIPT_REGISTRY_USER', value: RUN_USER },
          { key: 'BSCRIPT_REGISTRY_PASSWORD', value: token, secret: true },
        )
      }
      if (!registries.length) return none
      const dir = path.join(tmpDir, `run-${runId}-docker`)
      await writeDockerConfig(dir, registries)
      vars.unshift({ key: 'DOCKER_CONFIG', value: dir })
      return {
        vars,
        maskValues: registries.map((r) => r.password),
        release: async () => {
          if (token) auth.revokeRunToken(token)
          await fs.rm(dir, { recursive: true, force: true })
        },
      }
    },

    async applySettings() {
      const { enabled } = getRegistrySettings(db)
      if (enabled) await registryProcess.start()
      else await registryProcess.stop()
      scheduleCleanup()
    },

    async start() {
      failInterruptedCleanups(db)
      await this.applySettings()
      if (registryProcess.upstream) await sync().catch((err) => log.warn({ err: err.message }, 'Registry sync failed'))
    },

    async stop() {
      cleanupJob?.stop()
      await registryProcess.stop()
    },
  }
}
