import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { test } from 'node:test'
import { listBScriptFiles } from '../src/runner/discover.js'
import { collectRequirements, parseScript } from '../src/runner/requirements.js'

const EXAMPLES = path.resolve(import.meta.dirname, '../../../examples')

test('parseScript: declarations, inference, and what it leaves out', () => {
  const parsed = parseScript(`
# @env API_TOKEN secret  Token for the deploy API
# @env RETRIES optional
set -euo pipefail
require_env DEPLOY_HOST DEPLOY_PATH
: "\${REGION:?set REGION}"
echo "\${LOG_LEVEL:-info} $BSCRIPT_COMMIT_SHA $HOME $IMAGE"
tag="$IMAGE:latest"   # a comment mentioning $NOT_A_VAR
NODE_ENV=production npm run build
echo "$NODE_ENV $lowercase \${!indirect}"
for FILE in *.txt; do echo "$FILE"; done
`)
  assert.deepEqual(Object.fromEntries(parsed.declared), {
    API_TOKEN: { secret: true, optional: false, description: 'Token for the deploy API' },
    RETRIES: { secret: false, optional: true, description: null },
  })
  assert.deepEqual([...parsed.required].sort(), ['DEPLOY_HOST', 'DEPLOY_PATH', 'REGION'])
  assert.deepEqual([...parsed.optional], ['LOG_LEVEL'])
  assert.deepEqual([...parsed.referenced], ['IMAGE'], 'no built-ins, shell vars, assigned vars or comments')
})

test('collectRequirements follows sourced helpers (deploy-ssh example)', async () => {
  const repo = path.join(EXAMPLES, 'deploy-ssh')
  const files = await listBScriptFiles(repo)
  const read = (file) => fs.promises.readFile(path.join(repo, '.BScript', file), 'utf8').catch(() => null)
  const vars = await collectRequirements({
    steps: [{ name: 'Production', scriptPath: 'deploy/production.sh' }],
    files,
    read,
  })
  const byName = Object.fromEntries(vars.map((v) => [v.name, v]))
  assert.deepEqual(
    vars.map((v) => `${v.name}:${v.level}`),
    ['DEPLOY_HOST:required', 'DEPLOY_PATH:required', 'SSH_KNOWN_HOSTS:required', 'SSH_PRIVATE_KEY:required', 'DEPLOY_RESTART:optional'],
  )
  assert.equal(byName.SSH_PRIVATE_KEY.secret, true)
  assert.equal(byName.SSH_PRIVATE_KEY.declared, true)
  assert.match(byName.DEPLOY_HOST.description, /user@host/)
  assert.deepEqual(byName.DEPLOY_HOST.steps, ['Production'])
})

test('collectRequirements merges steps; declarations beat inference', async () => {
  const files = { 'a.sh': '# @env TOKEN optional\necho "$TOKEN"', 'b.sh': 'require_env TOKEN\necho "$OTHER"' }
  const vars = await collectRequirements({
    steps: [{ name: 'A', scriptPath: 'a.sh' }, { name: 'B', scriptPath: 'b.sh' }],
    files: Object.keys(files),
    read: async (file) => files[file] ?? null,
  })
  assert.deepEqual(vars.map((v) => [v.name, v.level, v.declared, v.steps]), [
    ['TOKEN', 'optional', true, ['A', 'B']],
    ['OTHER', 'referenced', false, ['B']],
  ])
})
