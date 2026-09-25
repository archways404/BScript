#!/usr/bin/env node
// Drives the runner without the server, to try "clone → run .BScript steps in order" locally,
// and handles admin recovery.
//
//   pnpm bscript reset-password [--user admin] [--password <pw>]
//   pnpm bscript scripts --repo <url|path> [--ref main]
//   pnpm bscript run --repo <url|path> [--ref main] [--step a.sh --step b.sh]
//                    [--allow-fail lint.sh] [--timeout 600]
//                    [--env-file .env.ci] [--secret NAME] [--no-secrets] [--keep]
//
// With no --step, every script found in .BScript/ runs in sorted order.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { parseArgs, parseEnv, styleText } from 'node:util'
import { loadConfig } from './config.js'
import { resetPasswordCommand } from './reset-password.js'
import { listScriptsAtCommit, resolveRef, syncMirror } from './runner/git.js'
import { runPipeline } from './runner/pipeline.js'

const USAGE = `Usage:
  bscript reset-password [--user <name>] [--password <pw>]
      Sets the admin password (prompts if --password is omitted) and signs out all sessions.
  bscript scripts --repo <url|path> [--ref <ref>] [--token <t> | --ssh-key <file>]
  bscript run     --repo <url|path> [--ref <ref>] [--step <script>]... [--allow-fail <script>]...
                  [--timeout <sec>] [--env-file <file>] [--secret <NAME>]... [--no-secrets] [--keep]`

const { values, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    repo: { type: 'string' },
    ref: { type: 'string', default: 'HEAD' },
    token: { type: 'string' },
    'ssh-key': { type: 'string' },
    step: { type: 'string', multiple: true, default: [] },
    'allow-fail': { type: 'string', multiple: true, default: [] },
    timeout: { type: 'string', default: '3600' },
    'env-file': { type: 'string' },
    secret: { type: 'string', multiple: true, default: [] },
    'no-secrets': { type: 'boolean', default: false },
    keep: { type: 'boolean', default: false },
    'data-dir': { type: 'string' },
    user: { type: 'string' },
    password: { type: 'string' },
    help: { type: 'boolean', short: 'h', default: false },
  },
})

const command = positionals[0]
const config = loadConfig({ ...process.env, BSCRIPT_DATA_DIR: values['data-dir'] ?? process.env.BSCRIPT_DATA_DIR })

if (command === 'reset-password' && !values.help) {
  try {
    await resetPasswordCommand({ config, user: values.user, password: values.password })
    process.exit(0)
  } catch (err) {
    console.error(styleText('red', err.message))
    process.exit(1)
  }
}

if (values.help || !command || !values.repo) {
  console.log(USAGE)
  process.exit(values.help ? 0 : 1)
}
const url = fs.existsSync(values.repo) ? path.resolve(values.repo) : values.repo
const auth = values.token
  ? { type: 'token', token: values.token }
  : values['ssh-key']
    ? { type: 'ssh', privateKey: fs.readFileSync(values['ssh-key'], 'utf8') }
    : { type: 'none' }
const repo = {
  url,
  auth,
  mirrorDir: path.join(config.reposDir, `cli-${crypto.createHash('sha1').update(url).digest('hex').slice(0, 12)}.git`),
}
const paths = {
  reposDir: config.reposDir,
  workDir: config.workDir,
  logsDir: config.logsDir,
  tmpDir: path.join(config.dataDir, 'tmp'),
}

async function scripts() {
  await syncMirror({ ...repo, tmpDir: paths.tmpDir })
  const sha = await resolveRef(repo.mirrorDir, values.ref)
  return listScriptsAtCommit(repo.mirrorDir, sha)
}

if (command === 'scripts') {
  const found = await scripts()
  console.log(found.length ? found.join('\n') : 'No scripts found in .BScript/')
  process.exit(0)
}

if (command !== 'run') {
  console.error(`Unknown command "${command}"\n\n${USAGE}`)
  process.exit(1)
}

const stepScripts = values.step.length ? values.step : await scripts()
if (!stepScripts.length) {
  console.error('No steps to run: pass --step or add scripts to .BScript/')
  process.exit(1)
}

const envFile = values['env-file'] ? parseEnv(fs.readFileSync(values['env-file'], 'utf8')) : {}
const secretKeys = new Set(values.secret)
const vars = Object.entries(envFile).map(([key, value]) => ({ key, value, secret: secretKeys.has(key) }))
const steps = stepScripts.map((script) => ({
  script,
  name: script,
  continueOnError: values['allow-fail'].includes(script),
  timeoutSec: Number(values.timeout),
}))

const controller = new AbortController()
process.once('SIGINT', () => {
  console.error(styleText('yellow', '\nCancelling…'))
  controller.abort()
})

const STATUS_COLOR = { success: 'green', failed: 'red', cancelled: 'yellow', skipped: 'gray' }
const runKey = `cli-${Date.now()}`

const summary = await runPipeline({
  runKey,
  repo,
  ref: values.ref,
  steps,
  vars,
  includeSecrets: !values['no-secrets'],
  meta: { project: path.basename(url), pipeline: 'cli', trigger: 'manual', branch: values.ref },
  paths,
  signal: controller.signal,
  keepWorkspace: values.keep,
  onEvent(event) {
    switch (event.type) {
      case 'run:checkout':
        console.log(styleText('gray', `Checked out ${event.commitSha.slice(0, 12)}`))
        break
      case 'step:start':
        console.log(styleText('bold', `\n▶ ${event.name}`))
        break
      case 'step:log':
        console.log(
          event.stream === 'stdout' ? event.line : styleText(event.stream === 'stderr' ? 'red' : 'gray', event.line),
        )
        break
      case 'step:end':
        console.log(styleText(STATUS_COLOR[event.status] ?? 'white', `■ ${event.status}`))
        break
    }
  },
})

console.log('')
for (const step of summary.steps) {
  console.log(`${styleText(STATUS_COLOR[step.status] ?? 'white', step.status.padEnd(10))} ${step.name}`)
}
if (summary.error) console.error(styleText('red', `\nError: ${summary.error}`))
console.log(styleText('gray', `\nLogs: ${path.join(config.logsDir, runKey)}`))
if (values.keep) console.log(styleText('gray', `Workspace: ${summary.workspaceDir}`))
console.log(styleText(STATUS_COLOR[summary.status] ?? 'white', `Run ${summary.status}`))
process.exit(summary.status === 'success' ? 0 : 1)
