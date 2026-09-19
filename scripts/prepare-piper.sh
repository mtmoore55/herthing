#!/usr/bin/env bash
set -euo pipefail

project_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
venv="$project_root/.artifacts/tts-venv"
voice_dir="$project_root/.artifacts/tts"
voice="en_US-lessac-medium"

python3 -m venv "$venv"
"$venv/bin/python" -m pip install --upgrade "piper-tts==1.8.0"
mkdir -p "$voice_dir"
"$venv/bin/python" -m piper.download_voices --data-dir "$voice_dir" "$voice"

printf 'Piper ready: %s\n' "$voice_dir/$voice.onnx"
