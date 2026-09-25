import assert from 'node:assert/strict'
import { test } from 'node:test'
import { migrate, openDatabase } from '../src/db/index.js'

test('migrations apply once and create the schema', () => {
  const db = openDatabase(':memory:')
  assert.deepEqual(migrate(db), [])
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
    .pluck()
    .all()
  for (const table of ['projects', 'pipelines', 'pipeline_steps', 'env_vars', 'runs', 'step_runs']) {
    assert.ok(tables.includes(table), `missing ${table}`)
  }
})

test('deleting a project cascades to its pipelines, steps and runs', () => {
  const db = openDatabase(':memory:')
  const project = db.prepare("INSERT INTO projects (name, repo_url) VALUES ('p', 'x')").run()
  const pipeline = db
    .prepare("INSERT INTO pipelines (project_id, name) VALUES (?, 'ci')")
    .run(project.lastInsertRowid)
  db.prepare("INSERT INTO pipeline_steps (pipeline_id, position, name, script_path) VALUES (?, 0, 'b', 'b.sh')")
    .run(pipeline.lastInsertRowid)
  db.prepare("INSERT INTO runs (pipeline_id, trigger, ref) VALUES (?, 'manual', 'main')").run(
    pipeline.lastInsertRowid,
  )
  db.prepare('DELETE FROM projects').run()
  assert.equal(db.prepare('SELECT count(*) FROM pipeline_steps').pluck().get(), 0)
  assert.equal(db.prepare('SELECT count(*) FROM runs').pluck().get(), 0)
})
