#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib/common.sh"

section "Installing dependencies"
require node
info "node $(node --version), pnpm $(pnpm --version)"
pnpm install --frozen-lockfile
