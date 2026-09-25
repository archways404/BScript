#!/usr/bin/env bash
# Needs the docker CLI and a daemon on the runner (see examples/README.md).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib/log.sh"

require docker
require_env IMAGE
tag="$IMAGE:${BSCRIPT_COMMIT_SHA:0:12}"

section "Building $tag"
docker build --pull \
  --label "org.opencontainers.image.revision=$BSCRIPT_COMMIT_SHA" \
  -t "$tag" .
