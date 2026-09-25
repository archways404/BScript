import path from 'node:path'

// Shell and runner variables that scripts read but nobody needs to configure.
const IGNORED = new Set([
  'BASH', 'BASHPID', 'BASH_SOURCE', 'BASH_VERSION', 'CI', 'EDITOR', 'EUID', 'FUNCNAME', 'HOME',
  'HOSTNAME', 'HOSTTYPE', 'IFS', 'LANG', 'LC_ALL', 'LINENO', 'MACHTYPE', 'OLDPWD', 'OPTARG',
  'OPTIND', 'OSTYPE', 'PATH', 'PIPESTATUS', 'PPID', 'PWD', 'RANDOM', 'REPLY', 'SECONDS', 'SHELL',
  'SHLVL', 'TERM', 'TMPDIR', 'TZ', 'UID', 'USER',
])
const SECRET_HINT = /TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE|CREDENTIAL|API_KEY|_KEY$|^KEY$/
const LEVEL_RANK = { referenced: 0, optional: 1, required: 2 }

function isConfigurable(name) {
  return !IGNORED.has(name) && name !== 'BSCRIPT' && !name.startsWith('BSCRIPT_')
}

// `# @env NAME [secret] [optional|required] Free-text description`
function parseDeclaration(rest) {
  const words = rest.trim().split(/\s+/).filter(Boolean)
  const flags = { secret: false, optional: false }
  while (['secret', 'optional', 'required'].includes(words[0]?.toLowerCase())) {
    const flag = words.shift().toLowerCase()
    if (flag === 'secret') flags.secret = true
    if (flag === 'optional') flags.optional = true
    if (flag === 'required') flags.optional = false
  }
  return { ...flags, description: words.join(' ') || null }
}

/**
 * Reads one script. Declarations (# @env) are the script's explicit contract; everything else
 * is inferred: `require_env A B` and `${A:?}` are required, `${A:-x}` is optional, and any
 * other $UPPER_CASE the script reads but never assigns is "referenced".
 */
export function parseScript(text) {
  const declared = new Map()
  const required = new Set()
  const optional = new Set()
  const referenced = new Set()
  const assigned = new Set()
  const sources = []

  for (const rawLine of text.split('\n')) {
    const declaration = rawLine.match(/^\s*#\s*@env\s+([A-Za-z_][A-Za-z0-9_]*)(.*)$/)
    if (declaration) {
      declared.set(declaration[1], parseDeclaration(declaration[2]))
      continue
    }
    if (/^\s*#/.test(rawLine)) continue
    const line = rawLine.replace(/\s#.*$/, '')

    const sourced = line.match(/^\s*(?:source|\.)\s+.*?([A-Za-z0-9_.\/-]+\.(?:sh|bash))["']?\s*(?:[;&|].*)?$/)
    if (sourced) sources.push(sourced[1].replace(/^\/+/, ''))

    for (const match of line.matchAll(/\brequire_env\s+([^;&|)]+)/g)) {
      for (const name of match[1].trim().split(/\s+/)) if (/^[A-Za-z_]\w*$/.test(name)) required.add(name)
    }
    for (const match of line.matchAll(/\$\{([A-Za-z_]\w*):\?/g)) required.add(match[1])
    for (const match of line.matchAll(/\$\{([A-Za-z_]\w*):?[-=+]/g)) optional.add(match[1])
    for (const match of line.matchAll(/(?:^|[\s;&|(])(?:export\s+|local\s+|readonly\s+|declare\s+(?:-\w+\s+)*)?([A-Za-z_]\w*)=/g)) {
      assigned.add(match[1])
    }
    for (const match of line.matchAll(/\b(?:for|read(?:\s+-\w+)*)\s+([A-Za-z_]\w*)/g)) assigned.add(match[1])
    for (const match of line.matchAll(/\$\{?([A-Z_][A-Z0-9_]+)/g)) referenced.add(match[1])
  }

  const keep = (set) => new Set([...set].filter((name) => isConfigurable(name) && !assigned.has(name)))
  const requiredSet = keep(required)
  const optionalSet = new Set([...keep(optional)].filter((name) => !requiredSet.has(name)))
  const referencedSet = new Set([...keep(referenced)].filter((name) => !requiredSet.has(name) && !optionalSet.has(name)))
  return { declared, required: requiredSet, optional: optionalSet, referenced: referencedSet, sources }
}

// Resolves a sourced path the way the script would, falling back to a unique basename match
// when the path was built at runtime (e.g. "$here/../_lib/log.sh").
function resolveSource(fromScript, candidate, files) {
  const direct = path.posix.normalize(path.posix.join(path.posix.dirname(fromScript), candidate))
  if (files.includes(direct)) return direct
  const byName = files.filter((file) => path.posix.basename(file) === path.posix.basename(candidate))
  return byName.length === 1 ? byName[0] : null
}

/**
 * What env vars a set of steps needs, following each step's `source`d helpers.
 *
 *   steps: [{ name, scriptPath }]           paths relative to .BScript/
 *   files: ['10-build.sh', '_lib/log.sh']   every file under .BScript/
 *   read:  async (relativePath) => text | null
 *
 * Returns [{ name, level: required|optional|referenced, declared, secret, description, steps }]
 * sorted by level, then name.
 */
export async function collectRequirements({ steps, files, read }) {
  const cache = new Map()
  const parse = async (file) => {
    if (!cache.has(file)) {
      const text = await read(file)
      cache.set(file, text === null ? null : parseScript(text))
    }
    return cache.get(file)
  }

  const variables = new Map()
  function note(name, stepName, { level, declared = null }) {
    const entry = variables.get(name) ?? { name, level: 'referenced', declared: false, secret: false, description: null, steps: new Set() }
    entry.steps.add(stepName)
    if (declared) {
      const declaredLevel = declared.optional ? 'optional' : 'required'
      // An explicit declaration beats inference; between declarations, required wins.
      entry.level = entry.declared ? (LEVEL_RANK[declaredLevel] > LEVEL_RANK[entry.level] ? declaredLevel : entry.level) : declaredLevel
      entry.declared = true
      entry.secret ||= declared.secret
      entry.description ??= declared.description
    } else if (!entry.declared && LEVEL_RANK[level] > LEVEL_RANK[entry.level]) {
      entry.level = level
    }
    variables.set(name, entry)
  }

  for (const step of steps) {
    const queue = [step.scriptPath]
    const seen = new Set()
    while (queue.length) {
      const file = queue.shift()
      if (seen.has(file)) continue
      seen.add(file)
      const parsed = await parse(file)
      if (!parsed) continue
      for (const [name, declared] of parsed.declared) note(name, step.name, { declared })
      for (const name of parsed.required) note(name, step.name, { level: 'required' })
      for (const name of parsed.optional) note(name, step.name, { level: 'optional' })
      for (const name of parsed.referenced) note(name, step.name, { level: 'referenced' })
      for (const candidate of parsed.sources) {
        const resolved = resolveSource(file, candidate, files)
        if (resolved) queue.push(resolved)
      }
    }
  }

  return [...variables.values()]
    .map((entry) => ({
      ...entry,
      secret: entry.secret || SECRET_HINT.test(entry.name),
      steps: [...entry.steps],
    }))
    .sort((a, b) => LEVEL_RANK[b.level] - LEVEL_RANK[a.level] || a.name.localeCompare(b.name))
}

// Declared-required vars a run doesn't have. Steps allowed to fail are not held to theirs.
export function missingDeclared(requirements, availableKeys) {
  return requirements.filter((r) => r.declared && r.level === 'required' && !availableKeys.has(r.name))
}
