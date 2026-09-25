#!/usr/bin/env bash
# Env: IMAGE (e.g. ghcr.io/acme/web), REGISTRY (e.g. ghcr.io),
#      REGISTRY_USER and REGISTRY_PASSWORD (mark the password as a secret).
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/_lib/log.sh"

require docker
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
