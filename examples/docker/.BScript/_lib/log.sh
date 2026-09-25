# Logging helpers. Anything under a `_` path is not offered as a step.
# Source it from a step with:  source "$(dirname "${BASH_SOURCE[0]}")/_lib/log.sh"

section() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
info() { printf '\033[2m%s\033[0m\n' "$*"; }
die() {
  printf '\033[31merror:\033[0m %s\n' "$*" >&2
  exit 1
}
require() { command -v "$1" >/dev/null 2>&1 || die "$1 is not installed on this runner"; }

# The docker CLI alone isn't enough: it needs a daemon (the host's, via the socket that
# docker-compose.yml mounts, or DOCKER_HOST).
require_docker() {
  require docker
  docker info >/dev/null 2>&1 ||
    die "docker can't reach a Docker daemon. Mount /var/run/docker.sock into the BScript container (see docker-compose.yml) or set DOCKER_HOST."
}
require_env() {
  for name in "$@"; do
    [ -n "${!name:-}" ] || die "$name is not set. Add it under the project or pipeline environment."
  done
}
