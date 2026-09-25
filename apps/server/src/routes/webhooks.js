import crypto from 'node:crypto'
import { notFound } from '../http-error.js'
import { listPipelines } from '../store/pipelines.js'
import { getProject, getWebhookSecret } from '../store/projects.js'
import { matchesBranchFilter } from '../triggers/branch-filter.js'
import { idParams } from './schemas.js'

const PR_ACTIONS = new Set(['opened', 'synchronize', 'reopened'])
const SKIP_CI = /\[(skip ci|ci skip|no ci|skip bscript)\]/i

function signatureValid(secret, rawBody, header) {
  if (!header?.startsWith('sha256=')) return false
  const expected = Buffer.from(`sha256=${crypto.createHmac('sha256', secret).update(rawBody).digest('hex')}`)
  const actual = Buffer.from(header)
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected)
}

function parsePayload(request) {
  const text = request.body.toString('utf8')
  const json = request.headers['content-type']?.startsWith('application/x-www-form-urlencoded')
    ? new URLSearchParams(text).get('payload')
    : text
  return JSON.parse(json)
}

// Turns a GitHub event into what to run, or a reason to ignore it.
function describeEvent(event, payload, { allowForkPrs }) {
  if (event === 'push') {
    if (payload.deleted) return { ignore: 'branch deleted' }
    if (!payload.ref?.startsWith('refs/heads/')) return { ignore: `not a branch push (${payload.ref})` }
    if (SKIP_CI.test(payload.head_commit?.message ?? '')) return { ignore: 'commit message asks to skip CI' }
    const branch = payload.ref.slice('refs/heads/'.length)
    return {
      trigger: 'push',
      filterBranch: branch,
      run: { ref: payload.after, branch, triggeredBy: payload.pusher?.name ?? payload.sender?.login ?? null },
    }
  }

  if (event === 'pull_request') {
    if (!PR_ACTIONS.has(payload.action)) return { ignore: `pull request ${payload.action}` }
    const pr = payload.pull_request
    const fromFork = pr.head.repo?.full_name !== pr.base.repo.full_name
    if (fromFork && !allowForkPrs) return { ignore: 'pull request from a fork (set BSCRIPT_ALLOW_FORK_PRS=true to run these)' }
    return {
      trigger: 'pull_request',
      // Like GitHub Actions, PR filters match the branch the PR targets.
      filterBranch: pr.base.ref,
      run: {
        ref: pr.head.sha,
        branch: pr.head.ref,
        prNumber: pr.number,
        fromFork,
        triggeredBy: payload.sender?.login ?? null,
      },
    }
  }

  return { ignore: `event "${event}" is not handled` }
}

export default async function webhookRoutes(app, { queue }) {
  const { db, cipher, config } = app

  // The signature covers the exact bytes GitHub sent, so this route keeps the raw body.
  app.removeContentTypeParser(['application/json'])
  app.addContentTypeParser(
    ['application/json', 'application/x-www-form-urlencoded'],
    { parseAs: 'buffer', bodyLimit: 25 * 1024 * 1024 },
    (request, body, done) => done(null, body),
  )

  app.post('/api/hooks/github/:id', { schema: { params: idParams } }, async (request, reply) => {
    const project = getProject(db, request.params.id)
    if (!project) throw notFound('Project')

    const secret = getWebhookSecret(db, cipher, project.id)
    if (!Buffer.isBuffer(request.body) || !signatureValid(secret, request.body, request.headers['x-hub-signature-256'])) {
      return reply.code(401).send({ error: 'Invalid signature' })
    }

    let payload
    try {
      payload = parsePayload(request)
    } catch {
      return reply.code(400).send({ error: 'Payload is not valid JSON' })
    }

    const event = request.headers['x-github-event']
    if (event === 'ping') return { ok: true, zen: payload.zen ?? null }

    const plan = describeEvent(event, payload, config)
    if (plan.ignore) return reply.code(202).send({ event, triggered: [], ignored: plan.ignore })

    const triggered = []
    const skipped = []
    for (const pipeline of listPipelines(db, project.id)) {
      if (!pipeline.enabled || !pipeline.triggers[plan.trigger]) continue
      if (!matchesBranchFilter(pipeline.branchFilter, plan.filterBranch)) continue
      try {
        const run = queue.enqueue({ pipelineId: pipeline.id, trigger: plan.trigger, ...plan.run })
        triggered.push({ pipelineId: pipeline.id, runId: run.id })
      } catch (err) {
        skipped.push({ pipelineId: pipeline.id, reason: err.message })
      }
    }
    request.log.info({ projectId: project.id, event, triggered, skipped }, 'GitHub webhook')
    return reply.code(202).send({ event, triggered, skipped })
  })
}
