# Shared deploy logic, sourced by deploy/staging.sh and deploy/production.sh.
# Not a step itself because its name starts with `_`. Set these per environment
# (staging / production) so the same scripts deploy to different hosts.
#
# @env DEPLOY_HOST              SSH target, user@host
# @env DEPLOY_PATH              Directory on the host, e.g. /srv/app
# @env SSH_PRIVATE_KEY secret   Deploy key with access to DEPLOY_HOST
# @env SSH_KNOWN_HOSTS          Output of `ssh-keyscan <host>`
# @env DEPLOY_RESTART optional  Command run on the host after switching releases

deploy_to() {
  local environment="$1"
  require ssh
  require tar
  require_env DEPLOY_HOST DEPLOY_PATH SSH_PRIVATE_KEY SSH_KNOWN_HOSTS

  # Key and known_hosts live in a temp dir that is removed however the step ends.
  local ssh_dir
  ssh_dir="$(mktemp -d)"
  trap 'rm -rf "$ssh_dir"' EXIT
  printf '%s\n' "$SSH_PRIVATE_KEY" >"$ssh_dir/key"
  printf '%s\n' "$SSH_KNOWN_HOSTS" >"$ssh_dir/known_hosts"
  chmod 600 "$ssh_dir/key"
  local ssh=(ssh -i "$ssh_dir/key" -o IdentitiesOnly=yes -o UserKnownHostsFile="$ssh_dir/known_hosts" -o StrictHostKeyChecking=yes)

  local release="$DEPLOY_PATH/releases/${BSCRIPT_COMMIT_SHA:0:12}"
  section "Deploying ${BSCRIPT_COMMIT_SHA:0:7} to $environment ($DEPLOY_HOST)"

  # Ship the build output, then switch the `current` symlink in one step.
  tar -czf - --exclude=.git --exclude=node_modules . |
    "${ssh[@]}" "$DEPLOY_HOST" "mkdir -p '$release' && tar -xzf - -C '$release'"
  "${ssh[@]}" "$DEPLOY_HOST" "ln -sfn '$release' '$DEPLOY_PATH/current'"

  if [ -n "${DEPLOY_RESTART:-}" ]; then
    info "Restarting: $DEPLOY_RESTART"
    "${ssh[@]}" "$DEPLOY_HOST" "$DEPLOY_RESTART"
  fi
  info "Deployed to $environment"
}
