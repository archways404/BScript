#!/usr/bin/env bash
# Builds the BScript image tagged with the commit, using the host's Docker daemon (the
# BScript image has the CLI; docker-compose.yml mounts the daemon's socket).
#
# @env IMAGE_NAME optional  Image name without tag (default: bscript)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/common.sh"

require_docker
tag="${IMAGE_NAME:-bscript}:${BSCRIPT_COMMIT_SHA:0:12}"

section "Building $tag"
docker build --pull -t "$tag" .
if [ "${BSCRIPT_BRANCH:-}" = "main" ] || [ "${BSCRIPT_BRANCH:-}" = "master" ]; then
  docker tag "$tag" "${IMAGE_NAME:-bscript}:latest"
  info "Also tagged ${IMAGE_NAME:-bscript}:latest"
fi
