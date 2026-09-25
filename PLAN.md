# BScript — Build Plan

A self-hosted CI runner for bash. A repo keeps its scripts in `.BScript/`. The BScript UI sets which scripts run, in what order, and with which env vars. BScript clones the repo and runs the scripts.

Ships as **one Docker image**: Fastify API + runner + built React UI + SQLite.

## Decisions (v1)

| Topic | Decision |
|---|---|
| Execution | Scripts run **inside the BScript container**, behind an `Executor` interface so a Docker executor can be added later |
| Code source | **Git clone** from URL + token (HTTPS PAT or SSH deploy key) per project |
| Triggers | **Manual** (UI), **GitHub webhook** (push/PR), **cron**, **API token** |
| Pipeline config | Stored in **SQLite only** (set in the UI); `.BScript/` holds only scripts |
| Auth | **Single admin** (bootstrapped from env), session cookie; API tokens for triggers |
| Concurrency | SQLite-backed queue, `MAX_CONCURRENT_RUNS` (default 2); **one active run per pipeline** |
| Failure | Stop at the first failure by default; each step can be set to **continue on error** and given a **timeout** |
| Tooling | **pnpm workspaces**, **Node 22 LTS**, JavaScript (no TS) |
| Fork PRs | PR runs from forks get **no secrets** |
| Retention | Keep the last **N runs per pipeline** (`RUN_RETENTION`, default 50); older runs and their logs are deleted |
| Script discovery | **Recursive**: any `*.sh` or executable file under `.BScript/`, including subfolders |
| Theme | **Dark by default**: true black background with frosted-glass surfaces; optional **light mode** toggle, remembered per browser |

## Architecture

```
┌──────────────────── bscript image ─────────────────────┐
│ Fastify                                                 │
│  ├─ /            static React build (@fastify/static)   │
│  ├─ /api/*       REST (session or API token auth)       │
│  ├─ /api/runs/:id/stream   live logs (SSE)              │
│  ├─ /api/hooks/github/:projectId   webhook (HMAC)       │
│  ├─ Scheduler    croner → enqueue runs                  │
│  └─ Queue+Runner  git fetch → bash step 1..n            │
│ SQLite (better-sqlite3)          /data/bscript.db       │
│ Git mirrors / workspaces / logs  /data/{repos,work,logs}│
└─────────────────────────────────────────────────────────┘
```

## Repo layout

```
apps/
  server/
    src/
      index.js            Fastify bootstrap
      config.js           env parsing
      db/                 connection + migrations/*.sql
      auth/               session, api tokens
      routes/             projects, pipelines, runs, env, hooks, auth
      runner/
        queue.js          claims queued runs, enforces concurrency
        run.js            orchestrates one run
        git.js            mirror clone/fetch, checkout at sha
        executor/local.js spawn bash, timeouts, process-group kill
        logs.js           write + stream + secret masking
      scheduler.js        cron → enqueue
      crypto.js           AES-256-GCM for secrets
  web/
    src/ (Vite + React JS + Tailwind + shadcn, react-router, TanStack Query)
Dockerfile
docker-compose.yml        dev/prod example with /data volume
pnpm-workspace.yaml
```

## Data model (SQLite)

- **projects** — id, name, repo_url, default_branch, auth_type (`none|token|ssh`), credential_enc, webhook_secret_enc, created_at
- **pipelines** — id, project_id, name, branch_filter (glob), triggers (json: `{manual, push, pull_request, cron}`), cron_expr, enabled
- **pipeline_steps** — id, pipeline_id, position, script_path (relative to `.BScript/`), name, continue_on_error, timeout_sec
- **env_vars** — id, scope (`project|pipeline`), scope_id, key, value_enc, is_secret. Pipeline values override project values.
- **runs** — id, pipeline_id, status (`queued|running|success|failed|cancelled`), trigger (`manual|push|pr|cron|api`), ref, commit_sha, triggered_by, queued_at, started_at, finished_at
- **step_runs** — id, run_id, step_id, position, status, exit_code, started_at, finished_at, log_path
- **api_tokens** — id, name, token_hash, last_used_at
- **settings** — admin user/password hash, misc

Logs are saved as files under `/data/logs/<runId>/<position>.log`. The DB stores only their paths.

## Runner contract (what scripts can rely on)

- Working dir is the **repo root** at the checked-out commit.
- Each step runs as `bash .BScript/<script>` in its own process group. A timeout or cancel sends SIGTERM, then SIGKILL after 10s.
- Env = minimal base (`PATH`, `HOME`) + project vars + pipeline vars + built-ins:
  - `BSCRIPT_RUN_ID`, `BSCRIPT_PIPELINE`, `BSCRIPT_PROJECT`, `BSCRIPT_TRIGGER`
  - `BSCRIPT_REF`, `BSCRIPT_BRANCH`, `BSCRIPT_COMMIT_SHA`, `BSCRIPT_WORKSPACE`
  - `BSCRIPT_STEP_NAME`, `BSCRIPT_STEP_INDEX`
- The server's own env (for example `BSCRIPT_SECRET_KEY`) is **never** passed to scripts.
- Secret values are replaced with `***` in logs.
- Steps share the same workspace, so files written by step 1 are visible to step 2.
- The workspace is deleted after the run. Git mirrors are kept, so later runs only need a fetch.

## API sketch

```
POST   /api/auth/login | /logout      GET /api/auth/me
CRUD   /api/projects
GET    /api/projects/:id/scripts      list .BScript/* at default branch
CRUD   /api/projects/:id/pipelines
PUT    /api/pipelines/:id/steps       replace ordered step list
CRUD   /api/{projects|pipelines}/:id/env
POST   /api/pipelines/:id/runs        manual/API trigger {ref?}
GET    /api/runs?pipeline=&status=    GET /api/runs/:id
POST   /api/runs/:id/cancel | /rerun  GET /api/runs/:id/steps/:pos/log
GET    /api/runs/:id/stream           SSE: snapshot, buffered lines, then live events
GET    /api/events                    SSE: run status changes across all pipelines
GET    /api/projects/:id/webhook      webhook URL + secret (POST .../rotate)
POST   /api/hooks/github/:projectId   X-Hub-Signature-256 verified
CRUD   /api/tokens
```

## UI look

- Dark mode is the default: `#000` background, cards and panels are translucent (`bg-white/5`) with `backdrop-blur` and thin `white/10` borders. Subtle gradient glows behind the glass so the blur has something to show.
- The light mode toggle in the header switches a `.light` class on `<html>` (shadcn CSS variables). The choice is saved in `localStorage`, falling back to dark.

## UI screens

1. Login
2. Projects list → project detail (repo settings, webhook URL + secret, project env vars)
3. Pipeline editor: pick scripts found in `.BScript/`, drag to reorder (dnd-kit), per-step continue-on-error and timeout, triggers, branch filter, cron, pipeline env vars
4. Runs list (filter by status)
5. Run detail: step timeline + live log viewer (ANSI colours) + cancel/re-run
6. Settings: API tokens, password change

## Config (env)

| Var | Purpose |
|---|---|
| `BSCRIPT_ADMIN_USER` / `BSCRIPT_ADMIN_PASSWORD` | bootstrap admin on first boot |
| `BSCRIPT_SECRET_KEY` | 32-byte key for encrypting secrets and sessions (**required**) |
| `BSCRIPT_DATA_DIR` | default `/data` |
| `MAX_CONCURRENT_RUNS` | default `2` |
| `RUN_RETENTION` | runs kept per pipeline, default `50` |
| `PORT` | default `3000` |
| `BSCRIPT_PUBLIC_URL` | used to show the webhook URL in the UI |

## Docker image

Multi-stage build: `node:22-bookworm-slim` + pnpm → build web → prod deps for server → final image with `bash git openssh-client curl jq ca-certificates tini`. Runs as a non-root `bscript` user, with `VOLUME /data`. Users can extend it with `FROM bscript` to add tools their scripts need.

## Milestones

1. ✅ **Scaffold** — pnpm workspaces, Fastify `/api/health`, Vite + Tailwind + shadcn (JS), dev proxy, lint/format.
2. ✅ **DB** — better-sqlite3, migration runner, schema above, crypto helper.
3. ✅ **Runner core** — git mirror/checkout, local executor, logs, masking. Runnable from a CLI script with no API.
4. ✅ **Queue** — enqueue/claim, concurrency limit, one run per pipeline, restart recovery (mark stale `running` as failed), retention pruning.
5. ✅ **API + auth** — routes, session login, API tokens, SSE log stream.
6. ✅ **UI** — screens 1–6.
7. ✅ **Triggers** — GitHub webhook (push/PR, branch filter), croner scheduler.
8. ✅ **Docker** — Dockerfile, compose example, README.
9. ✅ **Environments + env detection** — per-project environments with branch restrictions; `# @env` declarations, inferred requirements, checklist UI, pre-run check.
10. **Later** — Docker executor, per-project cache dir, GitHub commit statuses, artifacts, notifications.

