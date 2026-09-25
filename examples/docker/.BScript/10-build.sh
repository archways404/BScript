#!/usr/bin/env bash
# Uses the Docker daemon the BScript container is connected to (see examples/README.md).
#
# @env IMAGE  Image name without tag, e.g. ghcr.io/acme/web
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib/log.sh"

require_docker
require_env IMAGE
tag="$IMAGE:${BSCRIPT_COMMIT_SHA:0:12}"

section "Building $tag"
docker build --pull \
  --label "org.opencontainers.image.revision=$BSCRIPT_COMMIT_SHA" \
  -t "$tag" .
