#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
artifact_dir=${HERTHING_ARTIFACT_DIR:-"$project_root/.artifacts/upstream"}

mira_file="$artifact_dir/mira_firmware_v1.2.1.zip"
mira_size=505935185
mira_sha256=5533424790d50deec4f7a7ffa07620835f58152db7845de4e543cdf524f7d705

if [[ ! -f "$mira_file" ]]; then
  printf 'missing: %s\n' "$mira_file" >&2
  exit 1
fi

actual_size=$(stat -c '%s' "$mira_file")
if [[ "$actual_size" != "$mira_size" ]]; then
  printf 'size mismatch: expected %s, got %s\n' "$mira_size" "$actual_size" >&2
  exit 1
fi

printf '%s  %s\n' "$mira_sha256" "$mira_file" | sha256sum --check --strict
unzip -tq "$mira_file"
printf 'verified Mira 1.2.1 archive and ZIP structure\n'
