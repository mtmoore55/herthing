#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
config="${HERTHING_ENV_FILE:-$HOME/.config/herthing/environment}"
cd "$root"
args=()
if [[ -f "$config" ]]; then args+=("--env-file=$config"); fi
# Do not auto-install the firmware-only Go/Rust/Just tools for a host run.
exec env MISE_AUTO_INSTALL=false mise exec -- bun "${args[@]}" run host/server.js
