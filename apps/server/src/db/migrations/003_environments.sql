CREATE TABLE environments (
  id            INTEGER PRIMARY KEY,
  project_id    INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  -- Branches allowed to run with this environment; empty means any branch.
  branch_filter TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, name)
);

ALTER TABLE pipelines ADD COLUMN environment_id INTEGER REFERENCES environments (id) ON DELETE SET NULL;
ALTER TABLE runs ADD COLUMN environment_id INTEGER REFERENCES environments (id) ON DELETE SET NULL;
-- Kept on the run so history still says where it ran after the environment is deleted.
ALTER TABLE runs ADD COLUMN environment_name TEXT;

-- SQLite can't alter a CHECK constraint, so env_vars is rebuilt to allow the new scope.
CREATE TABLE env_vars_new (
  id        INTEGER PRIMARY KEY,
  scope     TEXT NOT NULL CHECK (scope IN ('project', 'pipeline', 'environment')),
  scope_id  INTEGER NOT NULL,
  key       TEXT NOT NULL,
  value_enc TEXT NOT NULL,
  is_secret INTEGER NOT NULL DEFAULT 0,
  UNIQUE (scope, scope_id, key)
);
INSERT INTO env_vars_new (id, scope, scope_id, key, value_enc, is_secret)
  SELECT id, scope, scope_id, key, value_enc, is_secret FROM env_vars;
DROP TABLE env_vars;
ALTER TABLE env_vars_new RENAME TO env_vars;

-- '*' never matched branches with a slash (feature/x). An empty filter now means "all
-- branches", which is what the old default was meant to be.
UPDATE pipelines SET branch_filter = '' WHERE branch_filter = '*';
