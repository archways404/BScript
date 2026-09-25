import crypto from 'node:crypto'
import { getSetting, setSetting } from '../store/settings.js'
import { hashPassword, verifyPassword } from './passwords.js'

export function getAdmin(db) {
  return {
    user: getSetting(db, 'admin_user'),
    passwordHash: getSetting(db, 'admin_password_hash'),
    sessionVersion: Number(getSetting(db, 'session_version') ?? 1),
  }
}

// First boot creates the single admin from env. Without BSCRIPT_ADMIN_PASSWORD a random one is
// generated and logged once. After that the stored password wins; env changes are ignored.
export async function ensureAdmin(db, config, log) {
  if (getSetting(db, 'admin_password_hash')) return
  const password = config.adminPassword || crypto.randomBytes(12).toString('base64url')
  setSetting(db, 'admin_user', config.adminUser)
  setSetting(db, 'admin_password_hash', await hashPassword(password))
  setSetting(db, 'session_version', 1)
  if (!config.adminPassword) {
    log.warn(`Created admin "${config.adminUser}" with generated password: ${password}  (change it in Settings)`)
  }
}

export async function checkCredentials(db, user, password) {
  const admin = getAdmin(db)
  const passwordOk = await verifyPassword(password, admin.passwordHash ?? '')
  return passwordOk && user === admin.user ? admin : null
}

export async function changePassword(db, newPassword) {
  setSetting(db, 'admin_password_hash', await hashPassword(newPassword))
  const version = getAdmin(db).sessionVersion + 1
  setSetting(db, 'session_version', version)
  return version
}
