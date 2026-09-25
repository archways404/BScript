#!/bin/sh
# Starts BScript as the unprivileged `bscript` user. If a Docker socket is mounted
# (docker-compose.yml does this), bscript is first given the socket's group so pipeline
# scripts can run `docker build` / `docker push`. The group id differs per host (0 on
# Docker Desktop, the `docker` group on Linux), so it is read from the socket itself.
set -eu

run_as_bscript() {
  export HOME=/home/bscript USER=bscript
  exec setpriv --reuid=bscript --regid=bscript --groups="$groups" --inh-caps=-all -- "$@"
}

# Already started with --user: nothing to adjust.
if [ "$(id -u)" != 0 ]; then
  exec "$@"
fi

groups="$(id -g bscript)"
socket="${DOCKER_SOCKET:-/var/run/docker.sock}"
if [ -S "$socket" ]; then
  groups="$groups,$(stat -c %g "$socket")"
fi

# Volumes created by older images, or bind mounts, may not belong to bscript yet.
chown bscript:bscript /data 2>/dev/null || true

run_as_bscript "$@"
