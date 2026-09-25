import fs from 'node:fs/promises'
import path from 'node:path'

const DOCKER_HUB = new Set(['docker.io', 'index.docker.io', 'registry-1.docker.io', 'registry.hub.docker.com', 'hub.docker.com'])

export function registryHost(url) {
  const withScheme = /^[a-z]+:\/\//i.test(url) ? url : `https://${url}`
  return new URL(withScheme).host
}

// The key Docker (and podman, buildah, skopeo, crane, kaniko) look up in config.json.
export function authKey(url) {
  const host = registryHost(url)
  return DOCKER_HUB.has(host) ? 'https://index.docker.io/v1/' : host
}

// The URL to talk to the registry API at.
export function apiBase(url) {
  const host = registryHost(url)
  if (DOCKER_HUB.has(host)) return 'https://registry-1.docker.io'
  const scheme = /^http:\/\//i.test(url) ? 'http' : 'https'
  return `${scheme}://${host}`
}

// Writes <dir>/config.json with credentials for each registry; tools pick it up via
// DOCKER_CONFIG=<dir>, so scripts can push and pull without `docker login`.
export async function writeDockerConfig(dir, registries) {
  const auths = {}
  for (const { url, username, password } of registries) {
    if (!username || !password) continue
    auths[authKey(url)] = { auth: Buffer.from(`${username}:${password}`).toString('base64') }
  }
  await fs.mkdir(dir, { recursive: true, mode: 0o700 })
  await fs.writeFile(path.join(dir, 'config.json'), JSON.stringify({ auths }, null, 2), { mode: 0o600 })
}
