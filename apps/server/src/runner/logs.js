import fs from 'node:fs'
import path from 'node:path'
import { StringDecoder } from 'node:string_decoder'

// Secrets shorter than this are not masked; masking "1" or "on" would shred the whole log.
const MIN_MASK_LENGTH = 4

// Logs are matched line by line, so a multi-line secret (an SSH key, a PEM certificate) is
// also masked one line at a time.
export function createMasker(secrets) {
  const values = new Set()
  for (const secret of secrets) {
    values.add(secret)
    if (secret.includes('\n')) for (const line of secret.split(/\r?\n/)) values.add(line.trim())
  }
  const sorted = [...values].filter((value) => value.length >= MIN_MASK_LENGTH).sort((a, b) => b.length - a.length)
  return (line) => sorted.reduce((out, value) => out.replaceAll(value, '***'), line)
}

// Writes a step's output to its log file line by line, masking secrets. Output is buffered per
// stream until a newline so a secret split across two chunks is still caught, and decoded per
// stream so a multi-byte character split across chunks survives.
export function createStepLog({ file, secrets = [], onLine = () => {} }) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const out = fs.createWriteStream(file)
  const closed = new Promise((resolve) => out.once('close', resolve))
  let writeError = null
  const mask = createMasker(secrets)
  const pending = { stdout: '', stderr: '' }
  const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') }

  function emit(stream, raw) {
    const line = mask(raw)
    if (!writeError) out.write(`${line}\n`)
    onLine({ stream, line })
  }

  // A full disk must fail loudly in the live log, not crash the server.
  out.on('error', (err) => {
    writeError = err
    onLine({ stream: 'info', line: `Could not write the log file: ${err.message}` })
  })

  return {
    write(stream, chunk) {
      const lines = (pending[stream] + decoders[stream].write(chunk)).split('\n')
      pending[stream] = lines.pop()
      for (const line of lines) emit(stream, line)
    },

    info(line) {
      emit('info', line)
    },

    get writeError() {
      return writeError
    },

    close() {
      for (const stream of Object.keys(pending)) {
        const rest = pending[stream] + decoders[stream].end()
        if (rest) emit(stream, rest)
        pending[stream] = ''
      }
      out.end()
      return closed
    },
  }
}
