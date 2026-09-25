import fs from 'node:fs/promises'
import path from 'node:path'

export const SCRIPTS_DIR = '.BScript'

export function isScript(name, mode) {
  return name.endsWith('.sh') || (mode & 0o111) !== 0
}

// Files and folders starting with `_` hold helpers that steps `source` (e.g. _lib/log.sh);
// they are never offered as steps themselves.
export function isHelperPath(relativePath) {
  return relativePath.split('/').some((segment) => segment.startsWith('_'))
}

// Lists scripts under <repoDir>/.BScript, recursively, as sorted POSIX paths relative to it.
export async function discoverScripts(repoDir) {
  const root = path.join(repoDir, SCRIPTS_DIR)
  const found = []

  async function walk(dir) {
    let entries
    try {
      entries = await fs.readdir(dir, { withFileTypes: true })
    } catch (err) {
      if (err.code === 'ENOENT') return
      throw err
    }
    for (const entry of entries) {
      if (entry.name.startsWith('_')) continue
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.isFile()) {
        const { mode } = await fs.stat(full)
        if (isScript(entry.name, mode)) found.push(path.relative(root, full).split(path.sep).join('/'))
      }
    }
  }

  await walk(root)
  return found.sort()
}

// Resolves a step's script path and refuses anything that escapes .BScript/.
export function resolveScriptPath(repoDir, scriptPath) {
  const root = path.resolve(repoDir, SCRIPTS_DIR)
  const full = path.resolve(root, scriptPath)
  if (!full.startsWith(root + path.sep)) {
    throw new Error(`Script "${scriptPath}" is outside ${SCRIPTS_DIR}/`)
  }
  return full
}
