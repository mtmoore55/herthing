#!/usr/bin/env bash
set -euo pipefail
root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"
source_dir="$root/.artifacts/src/whisper.cpp"
expected=5670d5c0bbcb148feabef84400a07cfca9aa3b30
if [[ "$(git -C "$source_dir" rev-parse HEAD)" != "$expected" ]]; then
  echo 'Prepare the pinned Whisper source with scripts/prepare-whisper.sh first.' >&2
  exit 1
fi
for backend in cpu vulkan; do
  vulkan=OFF
  if [[ "$backend" == vulkan ]]; then vulkan=ON; fi
  build="$root/.artifacts/whisper-benchmark/build-$backend"
  MISE_AUTO_INSTALL=false mise exec -- cmake -S "$source_dir" -B "$build" \
    -DCMAKE_BUILD_TYPE=Release -DBUILD_SHARED_LIBS=OFF \
    -DWHISPER_BUILD_TESTS=OFF -DWHISPER_BUILD_SERVER=OFF \
    -DGGML_CCACHE=OFF -DGGML_VULKAN="$vulkan"
  MISE_AUTO_INSTALL=false mise exec -- cmake --build "$build" \
    --target whisper-cli -j "${HERTHING_BUILD_JOBS:-6}"
done
