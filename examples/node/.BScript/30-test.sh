#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib/log.sh"

section "Testing"
npm test --if-present
