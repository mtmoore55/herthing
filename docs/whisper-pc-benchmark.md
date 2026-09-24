# CPU versus RX 580 Whisper benchmark

Measured 2026-09-24 on the new Omarchy host. Production remains CPU-only.

| Backend | Median wall time | Real-time factor | Range |
| --- | ---: | ---: | ---: |
| Ryzen 5 3600 CPU | 0.950 s | 0.0864 | 0.927–1.016 s |
| RX 580 Vulkan | 0.554 s | 0.0504 | 0.551–0.561 s |

The same 11.0-second public JFK sample and `base.en` model were used for both.
Vulkan was 1.72 times as fast by median wall time (about 42% less time). All ten
measured transcripts were identical. RTF is wall time divided by audio duration;
less than 1 means faster than real time.

## Method

- Ryzen 5 3600, 6 cores/12 threads, 64 GB RAM; Radeon RX 580 8 GB.
- Omarchy 4.0.1, Linux 7.1.9, Mesa RADV 26.2.1, GCC 16.2.1, CMake 4.4.3.
- Pinned whisper.cpp `5670d5c0bbcb148feabef84400a07cfca9aa3b30`.
- Separate Release CPU and Vulkan builds under `.artifacts/whisper-benchmark`;
  production `.artifacts/src/whisper.cpp/build` was not modified by benchmarking.
- Identical six-thread, English, best-of-1, beam-size-1 decoding settings. CPU
  explicitly used `--no-gpu`; GPU logs confirmed `using Vulkan0 backend` and
  identified the RX 580. Default flash attention was retained on both builds.
- One discarded warm-up per backend, then five fresh-process runs per backend,
  reversing the backend order each round. Timing includes process startup and
  model loading; it is not just the encoder timer or a resident-server result.
- Public sample only; no microphone recording. HerThing and the desktop remained
  running, so these are practical desktop measurements rather than idle-lab ones.

Warm-up wall times were 0.935 s CPU and 0.952 s Vulkan. The first GPU use can be
more expensive than subsequent runs. The driver's shader cache was not cleared.
The production worker still has its previous four-thread configuration; this
isolated six-thread CLI experiment is not a direct end-to-end production timing.

Raw timings, model/audio hashes, and transcripts are in
[`benchmarks/whisper/ryzen3600-rx580-2026-09-24.json`](../benchmarks/whisper/ryzen3600-rx580-2026-09-24.json).
Only this reviewed public-sample result is checked in; future recordings and raw
benchmark outputs stay under ignored `.artifacts/`.

## Reproduce

Prepare the ordinary pinned Whisper source/model first. Install missing Vulkan
build/inspection dependencies with Omarchy's package tooling:

```sh
omarchy pkg add vulkan-tools vulkan-headers spirv-headers shaderc
vulkaninfo --summary
./scripts/prepare-whisper-benchmark.sh
python benchmarks/whisper.py --runs 5 --threads 6
```

`benchmarks/whisper.py` checks that the Vulkan backend was actually selected and
fails rather than silently reporting CPU fallback as GPU inference. Results and
backend logs land in `.artifacts/whisper-benchmark`. It does not change services,
record audio, or promote a production dependency.

## Interpretation

Both backends comfortably exceed real-time speed on this clean sample. GPU use
is promising but this one short English recording cannot establish accuracy on
room noise, reliable concurrent graphics performance, long-session stability,
or short-utterance/resident-server latency. Test those before promotion.

Real migration voice turns already completed on CPU with roughly 1.1–1.2 s batch
transcription and 55–97 ms Piper time to first audio. Other parts of the turn,
including endpointing and the assistant request, can dominate perceived latency.
Keep the current stack working while measuring those separately.
