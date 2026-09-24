#!/usr/bin/env python3
"""Compare isolated CPU/Vulkan CLI builds on identical public audio and model."""
import argparse
import hashlib
import json
import platform
import re
import statistics
import subprocess
import time
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / '.artifacts/src/whisper.cpp'
OUTPUT = ROOT / '.artifacts/whisper-benchmark'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--runs', type=int, default=5)
    parser.add_argument('--threads', type=int, default=6)
    parser.add_argument('--audio', type=Path, default=SOURCE / 'samples/jfk.wav')
    parser.add_argument('--model', type=Path, default=SOURCE / 'models/ggml-base.en.bin')
    args = parser.parse_args()
    if args.runs < 1 or args.threads < 1:
        parser.error('runs and threads must be positive')
    with wave.open(str(args.audio)) as audio:
        duration = audio.getnframes() / audio.getframerate()
    if duration <= 0:
        parser.error('audio must not be empty')
    OUTPUT.mkdir(parents=True, exist_ok=True)
    result = {
        'source_commit': subprocess.check_output(
            ['git', '-C', str(SOURCE), 'rev-parse', 'HEAD'], text=True).strip(),
        'platform': platform.platform(),
        'audio': args.audio.name, 'audio_sha256': digest(args.audio),
        'audio_seconds': duration,
        'model': args.model.name, 'model_sha256': digest(args.model),
        'threads': args.threads, 'runs': args.runs,
        'timing': 'fresh process wall time including model load; one discarded warm-up per backend',
        'samples': {'cpu': [], 'vulkan': []},
    }

    def run(backend, label):
        command = [str(OUTPUT / f'build-{backend}/bin/whisper-cli'),
                   '--model', str(args.model), '--file', str(args.audio),
                   '--threads', str(args.threads), '--language', 'en',
                   '--best-of', '1', '--beam-size', '1', '--no-timestamps']
        if backend == 'cpu':
            command.append('--no-gpu')
        started = time.perf_counter()
        process = subprocess.run(command, capture_output=True, text=True, timeout=180)
        elapsed = time.perf_counter() - started
        (OUTPUT / f'{backend}-{label}.stderr.log').write_text(process.stderr)
        if process.returncode:
            raise RuntimeError(f'{backend} exited {process.returncode}; see local stderr log')
        if backend == 'vulkan' and not re.search(r'using Vulkan\d* backend', process.stderr):
            raise RuntimeError('Vulkan execution was not confirmed; inspect the local stderr log')
        sample = {'seconds': elapsed, 'real_time_factor': elapsed / duration,
                  'transcript': process.stdout.strip()}
        print(f'{backend} {label}: {elapsed:.3f} s, RTF {elapsed / duration:.3f}', flush=True)
        return sample

    for backend in result['samples']:
        run(backend, 'warmup')
    # Reverse order every round to reduce systematic thermal/load ordering bias.
    for index in range(args.runs):
        order = ['cpu', 'vulkan'] if index % 2 == 0 else ['vulkan', 'cpu']
        for backend in order:
            result['samples'][backend].append(run(backend, str(index + 1)))
    result['summary'] = {}
    for backend, samples in result['samples'].items():
        median = statistics.median(s['seconds'] for s in samples)
        result['summary'][backend] = {
            'median_seconds': median, 'median_real_time_factor': median / duration,
            'min_seconds': min(s['seconds'] for s in samples),
            'max_seconds': max(s['seconds'] for s in samples),
        }
    (OUTPUT / 'results.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result['summary'], indent=2))


if __name__ == '__main__':
    main()
