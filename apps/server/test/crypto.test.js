import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { test } from 'node:test'
import { createCipher, parseKey } from '../src/crypto.js'

test('encrypt/decrypt round-trips and uses a fresh IV each time', () => {
  const cipher = createCipher(crypto.randomBytes(32))
  const a = cipher.encrypt('hunter2')
  const b = cipher.encrypt('hunter2')
  assert.notEqual(a, b)
  assert.equal(cipher.decrypt(a), 'hunter2')
})

test('decrypt rejects tampered ciphertext', () => {
  const cipher = createCipher(crypto.randomBytes(32))
  const parts = cipher.encrypt('secret').split(':')
  parts[3] = Buffer.from('tampered').toString('base64')
  assert.throws(() => cipher.decrypt(parts.join(':')))
})

test('parseKey accepts hex and base64, rejects wrong lengths', () => {
  const key = crypto.randomBytes(32)
  assert.deepEqual(parseKey(key.toString('hex')), key)
  assert.deepEqual(parseKey(key.toString('base64')), key)
  assert.throws(() => parseKey('short'))
})
