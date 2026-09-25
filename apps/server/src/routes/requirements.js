import { HttpError, notFound } from '../http-error.js'
import { listBScriptFiles, readBScriptFile, resolveRef, syncMirror } from '../runner/git.js'
import { mirrorDirFor, runPaths } from '../runner/queue.js'
import { collectRequirements } from '../runner/requirements.js'
import { listEnvKeys } from '../store/env-vars.js'
import { listEnvironments } from '../store/environments.js'
import { getPipeline } from '../store/pipelines.js'
import { getProject, getProjectAuth } from '../store/projects.js'
import { idParams } from './schemas.js'

// The editor asks again whenever steps change; fetching the repo that often is pointless.
const SYNC_INTERVAL_MS = 15_000

export default async function requirementRoutes(app) {
  const { db, cipher, config } = app
  const lastSync = new Map()

  async function freshMirror(project) {
    const mirrorDir = mirrorDirFor(config, project.id)
    if (Date.now() - (lastSync.get(project.id) ?? 0) > SYNC_INTERVAL_MS) {
      await syncMirror({
        url: project.repoUrl,
        mirrorDir,
        auth: getProjectAuth(db, cipher, project.id),
        tmpDir: runPaths(config).tmpDir,
      })
      lastSync.set(project.id, Date.now())
    }
    return mirrorDir
  }

  // Which env vars the given steps need, and which keys each level already sets. Takes the
  // steps in the body (not the saved pipeline) so the editor can check unsaved changes.
  app.post(
    '/api/projects/:id/requirements',
    {
      schema: {
        params: idParams,
        body: {
          type: 'object',
          required: ['steps'],
          additionalProperties: false,
          properties: {
            ref: { type: 'string', minLength: 1, maxLength: 255 },
            pipelineId: { type: 'integer', minimum: 1 },
            steps: {
              type: 'array',
              maxItems: 100,
              items: {
                type: 'object',
                required: ['scriptPath'],
                properties: { name: { type: 'string' }, scriptPath: { type: 'string', minLength: 1 } },
              },
            },
          },
        },
      },
    },
    async (request) => {
      const project = getProject(db, request.params.id)
      if (!project) throw notFound('Project')
      const pipeline = request.body.pipelineId ? getPipeline(db, request.body.pipelineId) : null
      if (pipeline && pipeline.projectId !== project.id) throw notFound('Pipeline')

      const ref = request.body.ref || project.defaultBranch
      let mirrorDir, commitSha
      try {
        mirrorDir = await freshMirror(project)
        commitSha = await resolveRef(mirrorDir, ref)
      } catch (err) {
        throw new HttpError(502, err.message)
      }

      const variables = await collectRequirements({
        steps: request.body.steps.map((step) => ({ name: step.name || step.scriptPath, scriptPath: step.scriptPath })),
        files: await listBScriptFiles(mirrorDir, commitSha),
        read: (file) => readBScriptFile(mirrorDir, commitSha, file),
      })

      return {
        ref,
        commitSha,
        variables,
        configured: {
          project: listEnvKeys(db, 'project', project.id),
          pipeline: pipeline ? listEnvKeys(db, 'pipeline', pipeline.id) : [],
          environments: listEnvironments(db, project.id).map((environment) => ({
            id: environment.id,
            name: environment.name,
            keys: listEnvKeys(db, 'environment', environment.id),
          })),
        },
      }
    },
  )
}
