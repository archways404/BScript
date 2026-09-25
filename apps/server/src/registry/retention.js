import { matchesBranchFilter } from '../triggers/branch-filter.js'

const DAY_MS = 24 * 60 * 60 * 1000

function matchesAny(patterns, value) {
  return Boolean(patterns?.trim()) && matchesBranchFilter(patterns.replace(/(^|[\s,])!/g, '$1'), value)
}

// First rule whose repository glob matches wins; its unset fields fall back to the defaults.
export function policyFor(repository, retention) {
  const rule = (retention.rules ?? []).find((r) => r.repository && matchesBranchFilter(r.repository, repository))
  if (!rule) return { ...retention, keepForever: false, rule: null }
  return {
    keepForever: Boolean(rule.keepForever),
    keepLast: rule.keepLast === undefined ? retention.keepLast : rule.keepLast,
    olderThanDays: rule.olderThanDays === undefined ? retention.olderThanDays : rule.olderThanDays,
    protect: rule.protect === undefined ? retention.protect : rule.protect,
    rule: rule.repository,
  }
}

/**
 * Which tags a cleanup deletes. Per repository, a tag goes when it is not protected, is not
 * among the `keepLast` newest unprotected tags, and is older than `olderThanDays`. Both limits
 * must agree, so recent tags survive even past the count and a busy repo keeps its newest ones
 * however old. A limit set to null is ignored; with both null nothing is deleted.
 *
 * Returns the doomed tags and an upper bound on the space freed: the size of every image left
 * with no tags (layers shared with surviving images are only freed if nothing else uses them).
 */
export function planCleanup(tags, retention, now = Date.now()) {
  const byRepository = Map.groupBy(tags, (t) => t.repository)
  const doomed = []

  for (const [repository, repoTags] of byRepository) {
    const policy = policyFor(repository, retention)
    if (policy.keepForever || (policy.keepLast == null && policy.olderThanDays == null)) continue

    const unprotected = repoTags
      .filter((t) => !matchesAny(policy.protect, t.tag))
      .sort((a, b) => Date.parse(b.pushedAt) - Date.parse(a.pushedAt))

    unprotected.forEach((tag, index) => {
      const pastCount = policy.keepLast == null || index >= policy.keepLast
      const ageDays = (now - Date.parse(tag.pushedAt)) / DAY_MS
      const pastAge = policy.olderThanDays == null || ageDays > policy.olderThanDays
      if (!pastCount || !pastAge) return
      const reasons = []
      if (policy.keepLast != null) reasons.push(`beyond the newest ${policy.keepLast}`)
      if (policy.olderThanDays != null) reasons.push(`older than ${policy.olderThanDays} days`)
      doomed.push({ ...tag, reason: reasons.join(', '), rule: policy.rule })
    })
  }

  const doomedKeys = new Set(doomed.map((t) => `${t.repository}:${t.tag}`))
  const survivingDigests = new Set(
    tags.filter((t) => !doomedKeys.has(`${t.repository}:${t.tag}`)).map((t) => `${t.repository}@${t.digest}`),
  )
  const freedImages = new Map()
  for (const tag of doomed) {
    const key = `${tag.repository}@${tag.digest}`
    if (!survivingDigests.has(key)) freedImages.set(key, tag.size ?? 0)
  }
  return { tags: doomed, reclaimableBytes: [...freedImages.values()].reduce((a, b) => a + b, 0) }
}
