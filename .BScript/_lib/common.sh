# Helpers shared by BScript's own steps. Anything under a `_` path is not offered as a step.
# Source it from a step with:  source "$(dirname "${BASH_SOURCE[0]}")/_lib/common.sh"

section() { printf '\n\033[1;36m▸ %s\033[0m\n' "$*"; }
info() { printf '\033[2m%s\033[0m\n' "$*"; }
die() {
  printf '\033[31merror:\033[0m %s\n' "$*" >&2
  exit 1
}
require() { command -v "$1" >/dev/null 2>&1 || die "$1 is not installed on this runner"; }

# The runner image ships Node with corepack but not a global pnpm.
if ! command -v pnpm >/dev/null 2>&1; then
  require corepack
  pnpm() { corepack pnpm "$@"; }
fi
