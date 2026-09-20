#!/usr/bin/env bash
set -euo pipefail

profile_dir="${HERTHING_MUSE_BROWSER_PROFILE:-${XDG_DATA_HOME:-$HOME/.local/share}/herthing/muse-browser}"
debug_port="${HERTHING_MUSE_BROWSER_DEBUG_PORT:-9333}"
browser="${HERTHING_MUSE_BROWSER_BINARY:-google-chrome-stable}"
start_url="${HERTHING_MUSE_BROWSER_URL:-https://muse.ai/}"

mkdir -p "$profile_dir"
chmod 700 "$profile_dir"

exec "$browser" \
  --user-data-dir="$profile_dir" \
  --remote-debugging-address=127.0.0.1 \
  --remote-debugging-port="$debug_port" \
  --app="$start_url" \
  --no-first-run \
  --no-default-browser-check
