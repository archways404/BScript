import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { test } from 'node:test'
import { changePassword, checkCredentials, ensureAdmin, getAdmin, resetAdmin } from '../src/auth/admin.js'
import { loadConfig } from '../src/config.js'
import { openDatabase } from '../src/db/index.js'
import { tempDir } from './helpers.js'

const silent = { warn() {} }
const CLI = path.resolve(import.meta.dirname, '../src/cli.js')

test('resetAdmin replaces the password and signs out existing sessions', async () => {
  const db = openDatabase(':memory:')
  await ensureAdmin(db, loadConfig({ BSCRIPT_ADMIN_PASSWORD: 'first-password' }), silent)
  const before = getAdmin(db).sessionVersion

  assert.equal(await resetAdmin(db, { password: 'second-password' }), 'admin')
  assert.equal(await checkCredentials(db, 'admin', 'first-password'), null)
  assert.ok(await checkCredentials(db, 'admin', 'second-password'))
  assert.equal(getAdmin(db).sessionVersion, before + 1)
})

test('resetAdmin can rename the admin and works before first boot', async () => {
  const db = openDatabase(':memory:')
  assert.equal(await resetAdmin(db, { user: 'ops', password: 'ops-password' }), 'ops')
  assert.ok(await checkCredentials(db, 'ops', 'ops-password'))
  await ensureAdmin(db, loadConfig({ BSCRIPT_ADMIN_PASSWORD: 'ignored-now' }), silent)
  assert.ok(await checkCredentials(db, 'ops', 'ops-password'), 'first-boot setup must not overwrite a reset')
  await changePassword(db, 'changed-later')
  assert.ok(await checkCredentials(db, 'ops', 'changed-later'))
})

function cli(dataDir, ...args) {
  return execFileSync(process.execPath, [CLI, 'reset-password', '--data-dir', dataDir, ...args], {
    encoding: 'utf8',
    stdio: ['pipe', 'pipe', 'pipe'],
  })
}

test('pnpm bscript reset-password sets a given password', async (t) => {
  const dataDir = tempDir(t)
  assert.match(cli(dataDir, '--password', 'from-the-cli'), /Password reset for "admin"/)
  const db = openDatabase(path.join(dataDir, 'bscript.db'))
  t.after(() => db.close())
  assert.ok(await checkCredentials(db, 'admin', 'from-the-cli'))
})

test('reset-password generates and prints a password when not on a terminal', async (t) => {
  const dataDir = tempDir(t)
  const out = cli(dataDir)
  const password = out.match(/New password: (\S+)/)?.[1]
  assert.ok(password, out)
  const db = openDatabase(path.join(dataDir, 'bscript.db'))
  t.after(() => db.close())
  assert.ok(await checkCredentials(db, 'admin', password))
})

test('reset-password rejects short passwords', (t) => {
  assert.throws(() => cli(tempDir(t), '--password', 'short'), /at least 8 characters/)
})

test('the default data dir is fixed, not relative to the working directory', () => {
  assert.equal(loadConfig({}).dataDir, path.resolve(import.meta.dirname, '../.data'))
})
