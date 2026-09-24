#!/usr/bin/env bash
set -euo pipefail

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
source_dir="$project_root/.artifacts/src/whisper.cpp"
commit=5670d5c0bbcb148feabef84400a07cfca9aa3b30
model_sha=137c40403d78fd54d454da0f9bd998f78703390c

if [[ ! -d "$source_dir/.git" ]]; then
  git clone https://github.com/ggml-org/whisper.cpp.git "$source_dir"
fi
git -C "$source_dir" fetch origin "$commit"
git -C "$source_dir" checkout --detach "$commit"

model="$source_dir/models/ggml-base.en.bin"
if [[ ! -f "$model" ]]; then
  "$source_dir/models/download-ggml-model.sh" base.en
fi
printf '%s  %s\n' "$model_sha" "$model" | sha1sum --check --strict

MISE_AUTO_INSTALL=false mise exec -- cmake -S "$source_dir" -B "$source_dir/build" \
  -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
  -DGGML_VULKAN=OFF -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=ON -DGGML_CCACHE=OFF
MISE_AUTO_INSTALL=false mise exec -- cmake --build "$source_dir/build" --target whisper-cli whisper-server -j2
