# BScript

Self-hosted CI for bash. Put your scripts in a `.BScript/` folder in your repo. In the BScript UI, choose which scripts run, in what order, and with which env vars. BScript clones the repo and runs them.

See [PLAN.md](PLAN.md) for the design and milestones.

## Status

The runner core works from the CLI. The API, UI screens, triggers and Docker image are next.

## Development

Requires Node 22+ and pnpm.

```sh
pnpm install
pnpm dev          # Fastify on :3000 + Vite on :5173 (proxies /api)
pnpm test
```

## Try the runner

```sh
# list scripts in a repo's .BScript/ folder
pnpm bscript scripts --repo https://github.com/you/repo.git

# run them in order (all discovered scripts, sorted, unless --step is given)
pnpm bscript run --repo ../some-repo --ref main \
  --step build.sh --step test.sh --allow-fail lint.sh \
  --env-file .env.ci --secret API_TOKEN
```

Private repos: `--token <PAT>` or `--ssh-key <file>`.

### What a script gets

- Working directory: the repo root, at the checked-out commit. Steps share it, so files written by one step are visible to the next.
- Env: your vars plus `CI=true`, `BSCRIPT_RUN_ID`, `BSCRIPT_PROJECT`, `BSCRIPT_PIPELINE`, `BSCRIPT_TRIGGER`, `BSCRIPT_REF`, `BSCRIPT_BRANCH`, `BSCRIPT_COMMIT_SHA`, `BSCRIPT_WORKSPACE`, `BSCRIPT_STEP_NAME`, `BSCRIPT_STEP_INDEX`. The server's own env is not passed through.
- Secret values (4+ characters) show as `***` in logs.
- A step fails on a non-zero exit, on timeout, or if its script is missing. Anything the step leaves running in the background is killed when it exits.
