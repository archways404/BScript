// SQLite's datetime('now') has no zone marker; the API always returns ISO-8601 UTC.
export function iso(value) {
  if (!value) return null
  return /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d$/.test(value) ? `${value.replace(' ', 'T')}Z` : value
}

export function now() {
  return new Date().toISOString()
}

// Builds "col = @col, ..." for the keys present in a patch, mapping camelCase to columns.
export function setClause(patch, columns) {
  const entries = Object.entries(columns).filter(([key]) => patch[key] !== undefined)
  return {
    sql: entries.map(([, column]) => `${column} = @${column}`).join(', '),
    params: Object.fromEntries(entries.map(([key, column]) => [column, patch[key]])),
  }
}
