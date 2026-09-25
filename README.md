# BScript

Self-hosted CI for bash. Put your scripts in a `.BScript/` folder in your repo. In the BScript UI, choose which scripts run, in what order, and with which env vars. BScript clones the repo and runs them: on a button press, on a GitHub push or pull request, on a schedule, or from an API call.

It ships as one Docker image: web UI, API, runner, SQLite and a container registry.

## Run it

```sh
cp .env.example .env
# set BSCRIPT_SECRET_KEY (openssl rand -hex 32) and BSCRIPT_ADMIN_PASSWORD in .env
docker compose up -d
```

Open http://localhost:3000 and sign in as `admin`. The compose file also mounts the host's Docker socket so pipelines can build images; remove that line if you don't need it (anything using the socket is effectively root on the host). Data lives in the `bscript-data` volume. Back it up: it holds the database, and without `BSCRIPT_SECRET_KEY` the stored secrets can't be decrypted.

| Variable | Default | |
|---|---|---|
| `BSCRIPT_SECRET_KEY` | required in production | 32 bytes, hex or base64. Encrypts secrets and signs sessions. |
| `BSCRIPT_ADMIN_USER` / `BSCRIPT_ADMIN_PASSWORD` | `admin` / generated | Used on first start only. |
| `BSCRIPT_PUBLIC_URL` | `http://localhost:3000` | Used to show the webhook URL. |
| `MAX_CONCURRENT_RUNS` | `2` | Runs of one pipeline never overlap, whatever this is set to. |
| `RUN_RETENTION` | `50` | Finished runs kept per pipeline; older runs and their logs are deleted. |
| `BSCRIPT_ALLOW_FORK_PRS` | `false` | See [Pull requests from forks](#pull-requests-from-forks). |
| `TZ` | `UTC` | Time zone for cron schedules. |
| `BSCRIPT_REGISTRY_ADDRESS` | public URL's host | Registry address given to clients and runs. |

### Container registry

BScript includes a Docker/OCI registry (the CNCF Distribution `registry`), served at `/v2/` on the same address. Kubernetes can pull from it too.

```sh
docker login localhost:3000                  # admin password, or any user + an API token
docker push localhost:3000/team/app:1.0
```

- **Registry** page: repositories and tags with size, push time and last pull; delete tags or whole repositories.
- **Cleanup**: keep the newest N tags, delete tags older than D days, and never delete protected tags (e.g. `latest, v*`), with per-repository rules. Preview what a cleanup removes, run it on demand or on a schedule. Each cleanup ends with garbage collection, which frees the disk space and pauses the registry for a moment.
- **Pipelines** get short-lived registry credentials and a `DOCKER_CONFIG`; see [examples/README.md](examples/README.md#images-and-registries).
- **External registries** (Docker Hub, GHCR, …) are added under Settings, with a connection test, and are given to runs the same way.
- Docker only uses plain HTTP for `localhost`. Anywhere else, put BScript behind a TLS reverse proxy, or add it to the daemon's `insecure-registries`. `BSCRIPT_REGISTRY_ADDRESS` overrides the address shown to clients and given to runs.

### Admin password

On first start the server creates the admin from `BSCRIPT_ADMIN_USER` / `BSCRIPT_ADMIN_PASSWORD`. If no password is set, it generates one and prints it to the log once. After that, changing the env var does nothing. To set a new password:

```sh
pnpm bscript reset-password                                    # local checkout; prompts
docker compose exec bscript node apps/server/src/cli.js reset-password --password '<new>'
```

It works while the server is running and signs out every session.

## Set up a project

1. **Add scripts.** Create `.BScript/` in your repo and commit some scripts. [examples/](examples) has ready-made folders for Node, Docker and SSH deploys, plus a guide to writing scripts: what they can rely on, env vars, secrets and helpers.
2. **Create the project.** In the UI, use **New project** with the repo URL. Private repos need an access token (HTTPS) or a deploy key (SSH).
3. **Create a pipeline.** Pick scripts from `.BScript/` and drag them into order. For each step you can set **Allow failure** and a timeout. The **Variables these steps use** card lists what the scripts need (see [declaring variables](examples/README.md#declaring-the-variables-a-script-needs)) and where each is set.
4. **Add variables and environments.** Set variables on the project, the pipeline, or an **environment**. Environments are named targets such as `staging` and `production`, each with its own values. A run uses the pipeline's default environment or the one picked at Run, and environment values win. An environment can be limited to certain branches (e.g. `production` → `main`), so other branches can never run with its secrets. Mark tokens as **secret**.
5. **Choose triggers** in the pipeline's settings:
   - **Manual & API:** the Run button, or `POST /api/pipelines/:id/runs` with an API token from Settings (`Authorization: Bearer bst_…`).
   - **Push / Pull request:** add the webhook shown under the project's **Settings** to GitHub (content type `application/json`, push and pull request events). The branch filter takes globs, such as `main, release/*, !release/old`. For pull requests it matches the target branch. `[skip ci]` in a commit message skips the run.
   - **Schedule:** a cron expression, such as `0 3 * * *`.

### Pull requests from forks

Steps run inside the BScript container, as the same user as the server. A pull request from a fork can change `.BScript/`, so running it means running a stranger's code next to your database and secret key. Fork PRs are therefore ignored unless `BSCRIPT_ALLOW_FORK_PRS=true`, and even then they get no secret env vars. Pull requests from branches in the same repository run normally.

## Development

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm dev          # Fastify on :3000 + Vite on :5173 (proxies /api); open http://localhost:5173
pnpm test
```

Local data goes to `apps/server/.data`. BScript's own [`.BScript/`](.BScript) installs, tests and builds this repo, so a BScript instance can build BScript.

### Runner CLI

Runs a repo's scripts without the server:

```sh
pnpm bscript scripts --repo https://github.com/you/repo.git   # list steps in .BScript/
pnpm bscript run --repo ../some-repo --ref main \
  --step build.sh --step test.sh --allow-fail lint.sh \
  --env-file .env.ci --secret API_TOKEN
```

With no `--step`, every script runs in sorted order. Private repos: `--token <PAT>` or `--ssh-key <file>`.

See [PLAN.md](PLAN.md) for the design and what's next.
