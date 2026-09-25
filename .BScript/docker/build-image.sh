#!/usr/bin/env bash
# Builds the BScript image tagged with the commit. Needs the docker CLI and a daemon, which
# the stock BScript image does not include: run this on a runner image that adds them.
#
# @env IMAGE_NAME optional  Image name without tag (default: bscript)
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/../_lib/common.sh"

require docker
tag="${IMAGE_NAME:-bscript}:${BSCRIPT_COMMIT_SHA:0:12}"

section "Building $tag"
docker build --pull -t "$tag" .
if [ "${BSCRIPT_BRANCH:-}" = "main" ] || [ "${BSCRIPT_BRANCH:-}" = "master" ]; then
  docker tag "$tag" "${IMAGE_NAME:-bscript}:latest"
  info "Also tagged ${IMAGE_NAME:-bscript}:latest"
fi
