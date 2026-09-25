import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

const ALGORITHM = 'aes-256-gcm'
const VERSION = 'v1'

export function parseKey(raw) {
  const trimmed = raw.trim()
  const key = /^[0-9a-f]{64}$/i.test(trimmed)
    ? Buffer.from(trimmed, 'hex')
    : Buffer.from(trimmed, 'base64')
  if (key.length !== 32) {
    throw new Error('BSCRIPT_SECRET_KEY must be 32 bytes, hex or base64 (openssl rand -hex 32)')
  }
  return key
}

// Production must supply the key. In development a key is generated once and kept in the data
// dir so local setup works without ceremony.
export function resolveKey(config, log = console) {
  if (config.secretKey) return parseKey(config.secretKey)
  if (config.production) throw new Error('BSCRIPT_SECRET_KEY is required in production')

  const keyFile = path.join(config.dataDir, 'dev-secret.key')
  if (!fs.existsSync(keyFile)) {
    fs.mkdirSync(config.dataDir, { recursive: true })
    fs.writeFileSync(keyFile, crypto.randomBytes(32).toString('hex'), { mode: 0o600 })
    log.warn(`No BSCRIPT_SECRET_KEY set; generated a development key at ${keyFile}`)
  }
  return parseKey(fs.readFileSync(keyFile, 'utf8'))
}

export function createCipher(key) {
  return {
    encrypt(plaintext) {
      const iv = crypto.randomBytes(12)
      const cipher = crypto.createCipheriv(ALGORITHM, key, iv)
      const data = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()])
      const tag = cipher.getAuthTag()
      return [VERSION, iv, tag, data].map((part) =>
        typeof part === 'string' ? part : part.toString('base64'),
      ).join(':')
    },

    decrypt(payload) {
      const [version, iv, tag, data] = payload.split(':')
      if (version !== VERSION) throw new Error(`Unknown secret format "${version}"`)
      const decipher = crypto.createDecipheriv(ALGORITHM, key, Buffer.from(iv, 'base64'))
      decipher.setAuthTag(Buffer.from(tag, 'base64'))
      return Buffer.concat([
        decipher.update(Buffer.from(data, 'base64')),
        decipher.final(),
      ]).toString('utf8')
    },
  }
}
