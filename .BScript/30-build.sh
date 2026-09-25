#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib/common.sh"

section "Building the web UI"
pnpm build
info "Built into apps/web/dist"
