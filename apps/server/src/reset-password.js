import crypto from 'node:crypto'
import { styleText } from 'node:util'
import { resetAdmin } from './auth/admin.js'
import { openDatabase } from './db/index.js'

const MIN_LENGTH = 8

// Reads a line from the terminal without echoing it.
function promptHidden(question) {
  return new Promise((resolve) => {
    const stdin = process.stdin
    let value = ''
    process.stdout.write(question)
    stdin.setRawMode(true)
    stdin.setEncoding('utf8')
    stdin.resume()

    function finish() {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
      process.stdout.write('\n')
      resolve(value)
    }

    function onData(chunk) {
      for (const char of chunk) {
        if (char === '\r' || char === '\n') return finish()
        if (char === '\u0003') {
          process.stdout.write('\n')
          process.exit(130)
        }
        value = char === '\u007f' || char === '\b' ? value.slice(0, -1) : value + char
      }
    }
    stdin.on('data', onData)
  })
}

// --password wins; otherwise prompt on a terminal, or generate one when piped/scripted.
async function choosePassword(given) {
  if (given !== undefined) return { password: given, generated: false }
  if (!process.stdin.isTTY) return { password: crypto.randomBytes(12).toString('base64url'), generated: true }

  const password = await promptHidden('New password: ')
  if (password.length >= MIN_LENGTH && (await promptHidden('Repeat password: ')) !== password) {
    throw new Error('Passwords do not match')
  }
  return { password, generated: false }
}

export async function resetPasswordCommand({ config, user, password: given }) {
  const { password, generated } = await choosePassword(given)
  if (password.length < MIN_LENGTH) throw new Error(`Password must be at least ${MIN_LENGTH} characters`)

  const db = openDatabase(config.dbPath)
  try {
    const admin = await resetAdmin(db, { user, password })
    console.log(styleText('green', `Password reset for "${admin}".`) + ' Existing sessions are signed out.')
    if (generated) console.log(`New password: ${password}`)
    console.log(styleText('gray', `Database: ${config.dbPath}`))
  } finally {
    db.close()
  }
}
