#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
source_dir="$project_root/.artifacts/src/whisper.cpp"
commit=5670d5c0bbcb148feabef84400a07cfca9aa3b30
model_sha=c78c86eb1a8faa21b369bcd33207cc90d64ae9df

if [[ ! -d "$source_dir/.git" ]]; then
  git clone https://github.com/ggml-org/whisper.cpp.git "$source_dir"
fi
git -C "$source_dir" fetch origin "$commit"
git -C "$source_dir" checkout --detach "$commit"

model="$source_dir/models/ggml-tiny.en.bin"
if [[ ! -f "$model" ]]; then
  "$source_dir/models/download-ggml-model.sh" tiny.en
fi
printf '%s  %s\n' "$model_sha" "$model" | sha1sum --check --strict

mise exec -- cmake -S "$source_dir" -B "$source_dir/build" \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=ON -DGGML_CCACHE=OFF
mise exec -- cmake --build "$source_dir/build" --target whisper-cli whisper-server -j2
