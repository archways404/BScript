#!/usr/bin/env bash
set -euo pipefail
here="$(dirname "${BASH_SOURCE[0]}")"
source "$here/../_lib/log.sh"
source "$here/_deploy.sh"

deploy_to staging
