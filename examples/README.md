# Example `.BScript/` folders

Copy one of these `.BScript/` folders into the root of your repository, commit it, then build a pipeline from its scripts in the BScript UI.

| Example | Steps | Needs |
|---|---|---|
| [node](node/.BScript) | install → lint → test → build | Node (in the stock image) |
| [docker](docker/.BScript) | build image → push image | docker CLI + daemon on the runner |
| [deploy-ssh](deploy-ssh/.BScript) | `deploy/staging.sh`, `deploy/production.sh` | ssh + tar (in the stock image) |

BScript's own [`.BScript/`](../.BScript) is a working example too: install → test → build.

## Writing scripts

A step is any `*.sh` file, or any executable file, under `.BScript/`, including subfolders. BScript runs each one as `bash .BScript/<path>`, so the shebang line is only documentation.

**Start every script with `set -euo pipefail`.** Without it, bash keeps going after a failing command, and the step "succeeds" as long as the last line does.

```bash
#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib/log.sh"

section "Testing"
npm test
```

### What a step can rely on

- **Working directory:** the repository root, checked out at the run's exact commit. Every step in a run shares it, so files written by one step are there for the next. The workspace is deleted when the run ends.
- **Exit code:** 0 means success. Anything else, a timeout, or a missing script fails the step. A failed step stops the pipeline unless it is marked **Allow failure**.
- **Background processes** are killed when the step's script exits. Start services inside the step that uses them.
- **Environment:** project variables, then pipeline variables (these win on a name clash), then the built-ins below. The server's own environment is never passed through.

| Variable | Example | Notes |
|---|---|---|
| `CI`, `BSCRIPT` | `true` | |
| `BSCRIPT_RUN_ID` | `42` | |
| `BSCRIPT_PROJECT`, `BSCRIPT_PIPELINE` | `acme-web`, `ci` | |
| `BSCRIPT_TRIGGER` | `manual`, `api`, `push`, `pull_request`, `cron` | |
| `BSCRIPT_REF` | `main` or a commit sha | What was asked for. Webhook runs pin the exact commit. |
| `BSCRIPT_BRANCH` | `main`, `feature/login` | The PR's head branch for pull requests. Empty when a run was started from a bare commit. |
| `BSCRIPT_PR_NUMBER` | `17` | Pull request runs only. |
| `BSCRIPT_COMMIT_SHA` | `9f2c…` | Full 40-character sha. |
| `BSCRIPT_WORKSPACE` | `/data/work/42` | Same as the working directory. |
| `BSCRIPT_STEP_NAME`, `BSCRIPT_STEP_INDEX` | `Test`, `1` | Index starts at 0. |

### Secrets

Mark a variable as **secret** in the UI. Its value can't be read back through the UI or API, and it shows as `***` in logs (values of 4+ characters). Masking is a safety net, not a guarantee: a script that base64-encodes a secret, or prints it one character at a time, will get it into the log. Pass secrets on stdin where tools allow it (`docker login --password-stdin`).

Pull requests from forks don't run by default. With `BSCRIPT_ALLOW_FORK_PRS=true` they run without secrets. They still execute the fork's scripts inside the BScript container, so only enable it for repositories you trust.

### Shared helpers

Put code that steps `source` in a path starting with `_`, such as `.BScript/_lib/log.sh` or `.BScript/deploy/_deploy.sh`. These paths are not offered as steps. Each example has a small `_lib/log.sh` with `section`, `info`, `die`, `require` and `require_env`.

### Tools on the runner

Steps run inside the BScript container. The stock image has `bash`, `git`, `node` (with `corepack` for pnpm/yarn), `python3`, `build-essential` (for native npm modules), `curl`, `jq`, `ssh`, `tar` and `ca-certificates`. For anything else, build your own image on top of it:

```dockerfile
FROM bscript
USER root
RUN apt-get update && apt-get install -y --no-install-recommends rsync \
 && rm -rf /var/lib/apt/lists/*
USER bscript
```

The docker example also needs the docker CLI in the image, plus access to a daemon, for example by mounting `/var/run/docker.sock`. Anything with access to that socket effectively has root on the host.
