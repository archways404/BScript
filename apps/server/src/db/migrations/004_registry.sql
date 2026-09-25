-- Metadata for tags in the bundled registry, fed by its push/pull/delete notifications. The
-- registry itself stays the source of truth for which tags exist.
CREATE TABLE registry_tags (
  repository     TEXT NOT NULL,
  tag            TEXT NOT NULL,
  digest         TEXT NOT NULL,
  media_type     TEXT,
  -- Compressed image size: config + layers, summed over platforms for multi-arch images.
  size           INTEGER,
  pushed_at      TEXT NOT NULL,
  last_pulled_at TEXT,
  PRIMARY KEY (repository, tag)
);
CREATE INDEX registry_tags_digest_idx ON registry_tags (repository, digest);

-- Credentials for external registries, handed to runs as a Docker config.json.
CREATE TABLE registries (
  id           INTEGER PRIMARY KEY,
  name         TEXT NOT NULL UNIQUE,
  url          TEXT NOT NULL,
  username     TEXT,
  password_enc TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE registry_cleanups (
  id           INTEGER PRIMARY KEY,
  trigger      TEXT NOT NULL CHECK (trigger IN ('manual', 'schedule')),
  status       TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'failed')),
  deleted_tags INTEGER NOT NULL DEFAULT 0,
  freed_bytes  INTEGER,
  error        TEXT,
  log          TEXT,
  started_at   TEXT NOT NULL,
  finished_at  TEXT
);
