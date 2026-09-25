#!/usr/bin/env node
// Stand-in for the CNCF Distribution `registry` binary in tests. Speaks just enough of the
// registry API (manifests, tags, catalog, deletes) plus notifications and garbage-collect.
// Each manifest also writes a blob file sized like its layers, so GC visibly frees disk.
import crypto from 'node:crypto'
import fs from 'node:fs'
import http from 'node:http'
import path from 'node:path'

const [command, configFile] = process.argv.slice(2)
if (command === '--version') {
  console.log('fake-registry 0.0.0')
  process.exit(0)
}
const config = JSON.parse(fs.readFileSync(configFile, 'utf8'))
const root = config.storage.filesystem.rootdirectory
const stateFile = path.join(root, 'fake.json')
const blobDir = path.join(root, 'blobs')
fs.mkdirSync(blobDir, { recursive: true })

const load = () => (fs.existsSync(stateFile) ? JSON.parse(fs.readFileSync(stateFile, 'utf8')) : { repos: {} })
const save = (state) => fs.writeFileSync(stateFile, JSON.stringify(state))

if (command === 'garbage-collect') {
  const state = load()
  let removed = 0
  for (const repo of Object.values(state.repos)) {
    const keep = new Set(Object.values(repo.tags))
    for (const digest of [...keep]) for (const child of JSON.parse(repo.manifests[digest].body).manifests ?? []) keep.add(child.digest)
    for (const digest of Object.keys(repo.manifests)) {
      if (!keep.has(digest)) {
        delete repo.manifests[digest]
        fs.rmSync(path.join(blobDir, digest.replace(':', '_')), { force: true })
        removed++
      }
    }
  }
  save(state)
  console.log(`${removed} manifests eligible for deletion`)
  process.exit(0)
}

const endpoint = config.notifications?.endpoints?.[0]
async function notify(event, req) {
  event.request = { useragent: req.headers['user-agent'] ?? '' }
  if (!endpoint) return
  const headers = Object.fromEntries(Object.entries(endpoint.headers ?? {}).map(([k, v]) => [k, v[0]]))
  await fetch(endpoint.url, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/vnd.docker.distribution.events.v2+json' },
    body: JSON.stringify({ events: [{ id: crypto.randomUUID(), timestamp: new Date().toISOString(), ...event }] }),
  }).catch(() => {})
}

const [host, port] = config.http.addr.split(':')
http
  .createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    const body = Buffer.concat(chunks).toString('utf8')
    const url = new URL(req.url, 'http://x')
    const send = (status, json, headers = {}) => {
      res.writeHead(status, { 'content-type': 'application/json', ...headers })
      res.end(req.method === 'HEAD' || json === undefined ? undefined : JSON.stringify(json))
    }
    const state = load()

    if (url.pathname === '/v2/') return send(200, {})
    if (url.pathname === '/v2/_catalog') {
      const repositories = Object.keys(state.repos).filter((r) => Object.keys(state.repos[r].tags).length).sort()
      return send(200, { repositories })
    }
    const match = url.pathname.match(/^\/v2\/(.+)\/(tags\/list|manifests\/(.+))$/)
    if (!match) return send(404, { errors: [{ code: 'NOT_FOUND' }] })
    const [, name, kind, rawRef] = match
    const ref = rawRef && decodeURIComponent(rawRef)
    const repo = (state.repos[name] ??= { tags: {}, manifests: {} })

    if (kind === 'tags/list') return send(200, { name, tags: Object.keys(repo.tags).sort() })

    const digest = ref.startsWith('sha256:') ? ref : repo.tags[ref]
    if (req.method === 'PUT') {
      const pushed = `sha256:${crypto.createHash('sha256').update(body).digest('hex')}`
      const mediaType = req.headers['content-type']
      repo.manifests[pushed] = { mediaType, body }
      const manifest = JSON.parse(body)
      const size = (manifest.config?.size ?? 0) + (manifest.layers ?? []).reduce((s, l) => s + l.size, 0)
      fs.writeFileSync(path.join(blobDir, pushed.replace(':', '_')), Buffer.alloc(size))
      if (!ref.startsWith('sha256:')) repo.tags[ref] = pushed
      save(state)
      await notify({ action: 'push', target: { mediaType, digest: pushed, repository: name, tag: ref.startsWith('sha256:') ? undefined : ref } }, req)
      return send(201, undefined, { 'docker-content-digest': pushed, location: `/v2/${name}/manifests/${pushed}` })
    }
    if (!digest || !repo.manifests[digest]) return send(404, { errors: [{ code: 'MANIFEST_UNKNOWN' }] })
    if (req.method === 'DELETE') {
      if (ref.startsWith('sha256:')) {
        for (const [tag, d] of Object.entries(repo.tags)) if (d === digest) delete repo.tags[tag]
        delete repo.manifests[digest]
      } else {
        delete repo.tags[ref]
      }
      save(state)
      await notify({ action: 'delete', target: { digest, repository: name, tag: ref.startsWith('sha256:') ? undefined : ref } }, req)
      return send(202, undefined)
    }
    const manifest = repo.manifests[digest]
    res.writeHead(200, { 'content-type': manifest.mediaType, 'docker-content-digest': digest })
    res.end(req.method === 'HEAD' ? undefined : manifest.body)
    if (req.method === 'GET') {
      await notify({ action: 'pull', target: { mediaType: manifest.mediaType, digest, repository: name, tag: ref.startsWith('sha256:') ? undefined : ref } }, req)
    }
  })
  .listen(Number(port), host)
