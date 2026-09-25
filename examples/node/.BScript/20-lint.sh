#!/usr/bin/env bash
# Tip: mark this step "Allow failure" if lint warnings shouldn't block the pipeline.
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib/log.sh"

section "Linting"
npm run lint --if-present
