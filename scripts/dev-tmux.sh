#!/usr/bin/env bash
# Spin up two logged-in test clients (alice + bob) side by side in tmux.
#
#   pnpm dev:tmux
#
# Pre-logs in both profiles (no email/OTP), then opens a tmux session with
# alice on the left and bob on the right. Switch panes with Ctrl-b <arrow>,
# zoom a pane with Ctrl-b z, detach with Ctrl-b d (tmux attach to return).

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SESSION="hychat-dev"
PROFILE_A="${1:-alice}"
PROFILE_B="${2:-bob}"

cd "$ROOT"

echo "Logging in ${PROFILE_A} and ${PROFILE_B}..."
node scripts/dev-login.mjs "$PROFILE_A" "$PROFILE_B"

if ! command -v tmux >/dev/null 2>&1; then
  echo "tmux is not installed. Run the clients manually:"
  echo "  pnpm dev --profile $PROFILE_A"
  echo "  pnpm dev --profile $PROFILE_B"
  exit 0
fi

# Start fresh so a stale session does not get in the way.
tmux kill-session -t "$SESSION" 2>/dev/null || true

tmux new-session -d -s "$SESSION" -c "$ROOT" "pnpm dev --profile $PROFILE_A"
tmux split-window -h -t "$SESSION" -c "$ROOT" "pnpm dev --profile $PROFILE_B"
tmux select-pane -t "$SESSION":0.0
tmux attach -t "$SESSION"
