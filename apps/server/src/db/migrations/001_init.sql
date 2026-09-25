CREATE TABLE projects (
  id                 INTEGER PRIMARY KEY,
  name               TEXT NOT NULL UNIQUE,
  repo_url           TEXT NOT NULL,
  default_branch     TEXT NOT NULL DEFAULT 'main',
  auth_type          TEXT NOT NULL DEFAULT 'none' CHECK (auth_type IN ('none', 'token', 'ssh')),
  credential_enc     TEXT,
  webhook_secret_enc TEXT,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at         TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE pipelines (
  id            INTEGER PRIMARY KEY,
  project_id    INTEGER NOT NULL REFERENCES projects (id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  branch_filter TEXT NOT NULL DEFAULT '*',
  triggers      TEXT NOT NULL DEFAULT '{"manual":true,"push":false,"pull_request":false,"cron":false}',
  cron_expr     TEXT,
  enabled       INTEGER NOT NULL DEFAULT 1,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at    TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (project_id, name)
);

CREATE TABLE pipeline_steps (
  id                INTEGER PRIMARY KEY,
  pipeline_id       INTEGER NOT NULL REFERENCES pipelines (id) ON DELETE CASCADE,
  position          INTEGER NOT NULL,
  name              TEXT NOT NULL,
  script_path       TEXT NOT NULL,
  continue_on_error INTEGER NOT NULL DEFAULT 0,
  timeout_sec       INTEGER NOT NULL DEFAULT 3600,
  UNIQUE (pipeline_id, position)
);

CREATE TABLE env_vars (
  id        INTEGER PRIMARY KEY,
  scope     TEXT NOT NULL CHECK (scope IN ('project', 'pipeline')),
  scope_id  INTEGER NOT NULL,
  key       TEXT NOT NULL,
  value_enc TEXT NOT NULL,
  is_secret INTEGER NOT NULL DEFAULT 0,
  UNIQUE (scope, scope_id, key)
);

CREATE TABLE runs (
  id           INTEGER PRIMARY KEY,
  pipeline_id  INTEGER NOT NULL REFERENCES pipelines (id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'queued'
                 CHECK (status IN ('queued', 'running', 'success', 'failed', 'cancelled')),
  trigger      TEXT NOT NULL CHECK (trigger IN ('manual', 'push', 'pull_request', 'cron', 'api')),
  ref          TEXT NOT NULL,
  commit_sha   TEXT,
  from_fork    INTEGER NOT NULL DEFAULT 0,
  triggered_by TEXT,
  error        TEXT,
  queued_at    TEXT NOT NULL DEFAULT (datetime('now')),
  started_at   TEXT,
  finished_at  TEXT
);
CREATE INDEX runs_pipeline_idx ON runs (pipeline_id, id DESC);
CREATE INDEX runs_status_idx ON runs (status, id);

CREATE TABLE step_runs (
  id          INTEGER PRIMARY KEY,
  run_id      INTEGER NOT NULL REFERENCES runs (id) ON DELETE CASCADE,
  step_id     INTEGER REFERENCES pipeline_steps (id) ON DELETE SET NULL,
  position    INTEGER NOT NULL,
  name        TEXT NOT NULL,
  script_path TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'running', 'success', 'failed', 'skipped', 'cancelled')),
  exit_code   INTEGER,
  log_path    TEXT,
  started_at  TEXT,
  finished_at TEXT,
  UNIQUE (run_id, position)
);

CREATE TABLE api_tokens (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  last_used_at TEXT
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
