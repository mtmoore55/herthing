#!/usr/bin/env bash
set -euo pipefail

root="$(cd "$(dirname "$0")/.." && pwd)"
sherpa="$root/.artifacts/sherpa-onnx"
models="$root/.artifacts/models"
output="$root/.artifacts/bin/herthing-kws-stream"
speaker_output="$root/.artifacts/bin/herthing-speaker-embedding"
runtime_url="https://github.com/k2-fsa/sherpa-onnx/releases/download/v1.13.8/sherpa-onnx-v1.13.8-linux-x64-shared-no-tts.tar.bz2"
model_url="https://github.com/k2-fsa/sherpa-onnx/releases/download/kws-models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.tar.bz2"
runtime_sha="d0f96c8b65c6cd0974fada22737e337de81bc8cd2abbec2e39caf358b1eec5fc"
model_sha="f170013b4716e41b62b9bfd809687c207cef798ef9bc6534d524e17af9b6561a"
model_dir="$models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01"
speaker_model="$models/wespeaker_en_voxceleb_resnet34.onnx"
speaker_model_url="https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/wespeaker_en_voxceleb_resnet34.onnx"
speaker_model_sha="5ef208a9da1453335308a6b6f4e6dfbd7e183a38b604de0a57664f45d257fe94"

if [[ ! -f "$sherpa/include/sherpa-onnx/c-api/c-api.h" || ! -f "$model_dir/tokens.txt" ]]; then
  temporary="$(mktemp -d)"
  trap 'rm -rf "$temporary"' EXIT
  curl -fL "$runtime_url" -o "$temporary/runtime.tar.bz2"
  curl -fL "$model_url" -o "$temporary/model.tar.bz2"
  printf '%s  %s\n%s  %s\n' \
    "$runtime_sha" "$temporary/runtime.tar.bz2" \
    "$model_sha" "$temporary/model.tar.bz2" | sha256sum --check --status
  install -d "$sherpa" "$models"
  tar -xjf "$temporary/runtime.tar.bz2" -C "$sherpa" --strip-components=1
  tar -xjf "$temporary/model.tar.bz2" -C "$models"
fi

if [[ ! -f "$speaker_model" ]]; then
  install -d "$models"
  curl -fL "$speaker_model_url" -o "$speaker_model"
fi
printf '%s  %s\n' "$speaker_model_sha" "$speaker_model" | sha256sum --check --status

install -d "$(dirname "$output")"
cc -O3 -Wall -Wextra \
  -I"$sherpa/include" \
  "$root/host/native/kws-stream.c" \
  -L"$sherpa/lib" -lsherpa-onnx-c-api \
  -Wl,-rpath,"$sherpa/lib" \
  -o "$output"

cc -O3 -Wall -Wextra \
  -I"$sherpa/include" \
  "$root/host/native/speaker-embedding.c" \
  -L"$sherpa/lib" -lsherpa-onnx-c-api \
  -lm \
  -Wl,-rpath,"$sherpa/lib" \
  -o "$speaker_output"

echo "$output"
echo "$speaker_output"
