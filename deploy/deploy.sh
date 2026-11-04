#!/bin/bash
# Moves the live worktree to a commit (default: HEAD here) and restarts the service. The live app
# runs from its own detached worktree (JEWBER_LIVE, default ../jewber-live), so editing this
# checkout never changes what's running until you deploy.
#   git worktree add --detach ../jewber-live    # once
#   deploy/deploy.sh [commit]
set -euo pipefail
cd "$(dirname "$0")/.."
LIVE=${JEWBER_LIVE:-$(cd .. && pwd)/jewber-live}
REV=$(git rev-parse "${1:-HEAD}")
git -C "$LIVE" checkout -q --detach "$REV"
systemctl --user restart jewber
sleep 1
systemctl --user is-active jewber >/dev/null && echo "live: $(git log --oneline -1 "$REV")"
