import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export function tempDir(t) {
  const dir = fs.mkdtempSync(path.join(process.env.TMPDIR || os.tmpdir(), 'bscript-test-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  return dir
}

// Creates a git repo whose .BScript/ holds the given { 'path.sh': 'body' } scripts.
export function makeRepo(dir, scripts, { branch = 'main' } = {}) {
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: dir,
      env: {
        PATH: process.env.PATH,
        HOME: dir,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    }).toString().trim()

  fs.mkdirSync(dir, { recursive: true })
  git('init', '--quiet', '-b', branch)
  for (const [file, body] of Object.entries(scripts)) {
    const full = path.join(dir, '.BScript', file)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, body, { mode: path.extname(file) ? 0o644 : 0o755 })
  }
  fs.writeFileSync(path.join(dir, 'README'), 'hello\n')
  git('add', '-A')
  git('commit', '--quiet', '-m', 'init')
  return { sha: git('rev-parse', 'HEAD'), git }
}
