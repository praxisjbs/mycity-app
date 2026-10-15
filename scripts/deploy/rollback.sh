#!/usr/bin/env bash
# Roll production back to a release still on the server (SYSTEM_ARCHITECTURE §9.7,
# docs/runbooks/rollback.md).
#
#   scripts/deploy/rollback.sh <sha>
#
# Run by .github/workflows/rollback.yml after a production approver approved it; that job is the
# only place the production key exists. It asks deploy-gate, through the key's forced command,
# to switch production's `current` to <sha> and restart. The database is not rolled back: if the
# release being left migrated, the approver restores its pre-deploy dump (runbooks/rollback.md).
#
# Needs: DEPLOY_HOST, and the production key loaded (ssh-agent or SSH_KEY_FILE) with the server
# in ~/.ssh/known_hosts.

set -euo pipefail

sha="${1:-}"
[[ "$sha" =~ ^[0-9a-f]{40}$ ]] || {
  echo "usage: rollback.sh <the full 40-character sha of a release on the server>" >&2
  exit 2
}
: "${DEPLOY_HOST:?DEPLOY_HOST is not set}"

ssh_args=(-o BatchMode=yes -o StrictHostKeyChecking=yes)
if [[ -n "${SSH_KEY_FILE:-}" ]]; then
  ssh_args+=(-i "${SSH_KEY_FILE/#\~/$HOME}" -o IdentitiesOnly=yes)
fi

echo "Production releases on the server:"
ssh "${ssh_args[@]}" "mycity-deploy@$DEPLOY_HOST" status
# The sha is checked above, so nothing in it can expand on either side.
# shellcheck disable=SC2029
ssh "${ssh_args[@]}" "mycity-deploy@$DEPLOY_HOST" "rollback production $sha"
