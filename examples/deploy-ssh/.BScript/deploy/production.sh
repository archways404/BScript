#!/usr/bin/env bash
set -euo pipefail
here="$(dirname "${BASH_SOURCE[0]}")"
source "$here/../_lib/log.sh"
source "$here/_deploy.sh"

# Guard against deploying anything but main to production, whatever triggered the run.
if [ "${BSCRIPT_BRANCH:-}" != "main" ]; then
  die "Production deploys only run from main (this run is on '${BSCRIPT_BRANCH:-a detached commit}')."
fi
deploy_to production
