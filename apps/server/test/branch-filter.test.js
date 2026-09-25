import assert from 'node:assert/strict'
import { test } from 'node:test'
import { matchesBranchFilter } from '../src/triggers/branch-filter.js'

test('branch filter globs', () => {
  const cases = [
    ['*', 'main', true],
    ['*', 'feature/x', false],
    ['**', 'feature/x', true],
    ['', 'anything/here', true],
    ['main', 'main', true],
    ['main', 'maintenance', false],
    ['main, release/*', 'release/1.2', true],
    ['main release/*', 'release/1.2/hotfix', false],
    ['release/**, !release/old', 'release/old', false],
    ['release/**, !release/old', 'release/new', true],
    ['!wip/*', 'main', true],
    ['!wip/*', 'wip/try', false],
    ['v1.?', 'v1.2', true],
    ['v1.?', 'v1x2', false],
  ]
  for (const [filter, branch, expected] of cases) {
    assert.equal(matchesBranchFilter(filter, branch), expected, `"${filter}" vs "${branch}"`)
  }
})
