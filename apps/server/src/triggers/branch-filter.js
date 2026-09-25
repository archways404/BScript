function globToRegExp(glob) {
  let source = ''
  for (let i = 0; i < glob.length; i++) {
    const char = glob[i]
    if (char === '*' && glob[i + 1] === '*') {
      source += '.*'
      i++
    } else if (char === '*') {
      source += '[^/]*'
    } else if (char === '?') {
      source += '[^/]'
    } else {
      source += char.replace(/[.+^${}()|[\]\\]/g, '\\$&')
    }
  }
  return new RegExp(`^${source}$`)
}

/**
 * Branch filter: comma- or space-separated globs. `*` matches within a path segment, `**`
 * across segments, and a leading `!` excludes. "main, release/*, !release/old" runs on main
 * and every release branch except release/old. An empty filter matches everything.
 */
export function matchesBranchFilter(filter, branch) {
  const patterns = String(filter ?? '').split(/[\s,]+/).filter(Boolean)
  const include = patterns.filter((p) => !p.startsWith('!'))
  const exclude = patterns.filter((p) => p.startsWith('!')).map((p) => p.slice(1))
  if (exclude.some((p) => globToRegExp(p).test(branch))) return false
  return include.length === 0 || include.some((p) => globToRegExp(p).test(branch))
}
