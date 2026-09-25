#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib/log.sh"

section "Building ${BSCRIPT_BRANCH:-$BSCRIPT_REF} @ ${BSCRIPT_COMMIT_SHA:0:7}"
NODE_ENV=production npm run build --if-present
