#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib/log.sh"

require node
section "Installing dependencies (node $(node --version))"

# Use whichever package manager the lockfile belongs to.
if [ -f pnpm-lock.yaml ]; then
  corepack pnpm install --frozen-lockfile
elif [ -f yarn.lock ]; then
  corepack yarn install --immutable
elif [ -f package-lock.json ]; then
  npm ci
else
  npm install
fi
