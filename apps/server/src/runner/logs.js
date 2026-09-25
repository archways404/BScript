import fs from 'node:fs'
import path from 'node:path'

// Secrets shorter than this are not masked; masking "1" or "on" would shred the whole log.
const MIN_MASK_LENGTH = 4

export function createMasker(secrets) {
  const values = [...new Set(secrets)]
    .filter((value) => value.length >= MIN_MASK_LENGTH)
    .sort((a, b) => b.length - a.length)
  return (line) => values.reduce((out, value) => out.replaceAll(value, '***'), line)
}

// Writes a step's output to its log file line by line, masking secrets. Output is buffered per
// stream until a newline so a secret split across two chunks is still caught.
export function createStepLog({ file, secrets = [], onLine = () => {} }) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const out = fs.createWriteStream(file)
  const mask = createMasker(secrets)
  const pending = { stdout: '', stderr: '' }

  function emit(stream, raw) {
    const line = mask(raw)
    out.write(`${line}\n`)
    onLine({ stream, line })
  }

  return {
    write(stream, chunk) {
      const lines = (pending[stream] + chunk.toString('utf8')).split('\n')
      pending[stream] = lines.pop()
      for (const line of lines) emit(stream, line)
    },

    info(line) {
      emit('info', line)
    },

    close() {
      for (const stream of Object.keys(pending)) {
        if (pending[stream]) emit(stream, pending[stream])
        pending[stream] = ''
      }
      return new Promise((resolve) => out.end(resolve))
    },
  }
}
