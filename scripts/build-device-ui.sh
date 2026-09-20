#!/usr/bin/env bash
set -euo pipefail

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
source_dir="$repo_root/device-ui"
output_dir="$repo_root/dist"
output_file="$output_dir/herthing-ui.zip"

mkdir -p "$output_dir"
rm -f "$output_file"
(
  cd "$source_dir"
  zip -q -9 "$output_file" index.html styles.css app.js visuals.js fonts/*.woff2 fonts/*.txt
)

echo "$output_file"
