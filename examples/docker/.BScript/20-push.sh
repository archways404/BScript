#!/usr/bin/env bash
# @env IMAGE                     Image name without tag, e.g. ghcr.io/acme/web
# @env REGISTRY                  Registry host, e.g. ghcr.io
# @env REGISTRY_USER             Registry user name
# @env REGISTRY_PASSWORD secret  Registry password or token
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib/log.sh"

require_docker
require_env IMAGE REGISTRY REGISTRY_USER REGISTRY_PASSWORD

if [ -n "${BSCRIPT_PR_NUMBER:-}" ]; then
  info "Pull request build: not pushing."
  exit 0
fi

tag="$IMAGE:${BSCRIPT_COMMIT_SHA:0:12}"
section "Pushing $tag"
# --password-stdin keeps the secret out of the process list.
printf '%s' "$REGISTRY_PASSWORD" | docker login "$REGISTRY" -u "$REGISTRY_USER" --password-stdin
docker push "$tag"

if [ "${BSCRIPT_BRANCH:-}" = "main" ]; then
  docker tag "$tag" "$IMAGE:latest"
  docker push "$IMAGE:latest"
fi
docker logout "$REGISTRY" >/dev/null
