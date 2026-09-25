import fs from 'node:fs/promises'
import { notFound, HttpError } from '../http-error.js'
import { mirrorDirFor, removeRunLogs, runPaths } from '../runner/queue.js'
import { listScriptsAtCommit, resolveRef, syncMirror } from '../runner/git.js'
import {
  createProject,
  deleteProject,
  getProject,
  getProjectAuth,
  getWebhookSecret,
  listProjects,
  rotateWebhookSecret,
  updateProject,
} from '../store/projects.js'
import { idParams, name } from './schemas.js'

const projectFields = {
  name,
  repoUrl: { type: 'string', minLength: 1, maxLength: 2000 },
  defaultBranch: { type: 'string', minLength: 1, maxLength: 255 },
  authType: { type: 'string', enum: ['none', 'token', 'ssh'] },
  credential: { type: ['string', 'null'], maxLength: 20000 },
}

export function hasRunningRun(db, where, id) {
  return Boolean(
    db
      .prepare(
        `SELECT 1 FROM runs r JOIN pipelines p ON p.id = r.pipeline_id
         WHERE r.status = 'running' AND ${where} = ? LIMIT 1`,
      )
      .get(id),
  )
}

export default async function projectRoutes(app, { scheduler }) {
  const { db, cipher, config } = app

  function requireProject(id) {
    const project = getProject(db, id)
    if (!project) throw notFound('Project')
    return project
  }

  app.get('/api/projects', async () => listProjects(db))

  app.post(
    '/api/projects',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name', 'repoUrl'],
          additionalProperties: false,
          properties: projectFields,
        },
      },
    },
    async (request, reply) => {
      const { authType = 'none', credential } = request.body
      if (authType !== 'none' && !credential) throw new HttpError(400, `A credential is required for ${authType} auth`)
      return reply.code(201).send(createProject(db, cipher, request.body))
    },
  )

  app.get('/api/projects/:id', { schema: { params: idParams } }, async (request) =>
    requireProject(request.params.id),
  )

  app.patch(
    '/api/projects/:id',
    {
      schema: {
        params: idParams,
        body: { type: 'object', additionalProperties: false, properties: projectFields },
      },
    },
    async (request) => {
      const current = requireProject(request.params.id)
      const patch = { ...request.body }
      if (patch.authType === 'none') patch.credential = null
      const authType = patch.authType ?? current.authType
      const willHaveCredential = patch.credential === undefined ? current.hasCredential : Boolean(patch.credential)
      if (authType !== 'none' && !willHaveCredential) {
        throw new HttpError(400, `A credential is required for ${authType} auth`)
      }
      return updateProject(db, cipher, request.params.id, patch)
    },
  )

  app.delete('/api/projects/:id', { schema: { params: idParams } }, async (request, reply) => {
    requireProject(request.params.id)
    if (hasRunningRun(db, 'p.project_id', request.params.id)) {
      throw new HttpError(409, 'Cancel running runs before deleting this project')
    }
    const runIds = deleteProject(db, request.params.id)
    await removeRunLogs(config, runIds)
    await fs.rm(mirrorDirFor(config, request.params.id), { recursive: true, force: true })
    scheduler?.sync()
    return reply.code(204).send()
  })

  app.get(
    '/api/projects/:id/scripts',
    {
      schema: {
        params: idParams,
        querystring: { type: 'object', properties: { ref: { type: 'string', minLength: 1 } } },
      },
    },
    async (request) => {
      const project = requireProject(request.params.id)
      const ref = request.query.ref || project.defaultBranch
      const mirrorDir = mirrorDirFor(config, project.id)
      try {
        await syncMirror({
          url: project.repoUrl,
          mirrorDir,
          auth: getProjectAuth(db, cipher, project.id),
          tmpDir: runPaths(config).tmpDir,
        })
        const sha = await resolveRef(mirrorDir, ref)
        return { ref, commitSha: sha, scripts: await listScriptsAtCommit(mirrorDir, sha) }
      } catch (err) {
        throw new HttpError(502, err.message)
      }
    },
  )

  app.get('/api/projects/:id/webhook', { schema: { params: idParams } }, async (request) => {
    const project = requireProject(request.params.id)
    return {
      url: `${config.publicUrl.replace(/\/$/, '')}/api/hooks/github/${project.id}`,
      secret: getWebhookSecret(db, cipher, project.id),
    }
  })

  app.post('/api/projects/:id/webhook/rotate', { schema: { params: idParams } }, async (request) => {
    requireProject(request.params.id)
    return { secret: rotateWebhookSecret(db, cipher, request.params.id) }
  })
}
