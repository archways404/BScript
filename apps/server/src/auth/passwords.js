import crypto from 'node:crypto'
import { promisify } from 'node:util'

const scrypt = promisify(crypto.scrypt)
const PARAMS = { N: 16384, r: 8, p: 1 }
const KEY_LENGTH = 64

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  const hash = await scrypt(password, salt, KEY_LENGTH, PARAMS)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(password, stored) {
  const [scheme, salt, expected] = String(stored).split('$')
  if (scheme !== 'scrypt') return false
  const expectedBuf = Buffer.from(expected, 'base64')
  const actual = await scrypt(password, Buffer.from(salt, 'base64'), expectedBuf.length, PARAMS)
  return crypto.timingSafeEqual(actual, expectedBuf)
}
