# Laya CPU router evaluation

Date: 2026-09-21. Recommendation: **skip integration on this host** and keep
the current conversational path. Continue only with a substantially smaller,
HerThing-specific classifier or conservative rules.

## Scope and pinned setup

- Host: Intel Core i5-3210M (Ivy Bridge), 2 physical cores / 4 threads,
  2.50–3.10 GHz, AVX but no AVX2, 15 GiB RAM, x86_64 Omarchy Linux.
- Upstream source: `NandhaKishorM/laya` commit
  `42626c348753fbb17572a813127df2278a1ec527` (Apache-2.0).
- English checkpoint: `convaiinnovations/laya` revision
  `1c5edc17a7acd8701df6fc341c0d179f1c62c982`.
- Weight size: 842,609,210 bytes; verified SHA-256
  `891102d372688fc2a094dac56a384bc537b87c63f21f9f3dac0be2b7cbc8d86c`.
- Isolated runtime: Python 3.14 venv, Laya 0.3.4, CPU-only PyTorch 2.14.0,
  Transformers 4.57.6, Safetensors 0.7.0, huggingface-hub 0.36.2,
  NumPy 2.4.4. Two PyTorch inference threads and one interop thread.
- MLX was not installed or evaluated because it requires Apple Silicon/macOS.

The model loaded and inferred correctly on Ivy Bridge. CPU execution expands
the FP16 checkpoint to FP32. Peak process RSS was 2,889 MiB. The configured
input limit is 512 tokens; a synthetic over-limit input was silently truncated
to exactly 512 input tokens.

## Pipeline placement considered

HerThing currently performs local whisper.cpp transcription in
`host/stt-whisper.js`, then `host/server.js` sends the transcript to
`askAssistantInOrder`, which invokes the configured assistant adapter. Existing
media actions already pass through `executeMediaCommand`; volume passes through
`setSystemVolume`; weather and the next event are already in host state.

The safe insertion point would therefore be after successful transcription and
speaker verification, immediately before `askAssistantInOrder`. A router could
only return this bounded allowlist: pause, resume, next track, relative volume
up/down, read current weather, or read the next event. Everything else must
fall through. No model output may supply locations, dates, percentages, track
names, or other arguments.

## Held-out evaluation

`benchmarks/laya/tuning-cases.json` was used only to design the question and
safety rules. The 32 examples in `evaluation-cases.json` are separate. They
cover natural phrasing, negation, quoted commands, multiple requests,
context-dependent phrases, unsupported/parameterized requests, general
conversation, and clarification cases. Handlers were dry-run labels only.

| Router | Accuracy | Incorrect direct actions | Fallback rate |
|---|---:|---:|---:|
| Raw Laya | 40.6% (13/32) | 15 | 0% |
| Laya + deterministic safety gate | 68.8% (22/32) | 0 | 75.0% |
| Conservative rules | 87.5% (28/32) | 0 | 56.3% |

Raw confidence was not a safety signal. Examples include “do not pause the
music” classified as pause at 0.966 confidence, a quoted “pause the music” at
0.992, and a quoted next-track request at 0.997. `act_probability` was 1.0 for
every evaluated example. This agrees with upstream's warning that shipped
confidence can remain high while wrong and that base checkpoints are weak
zero-shot typed-decision models.

## Performance

| Measurement | Result |
|---|---:|
| Cold model load | 72.4–80.7 s |
| First small six-option request | 2.26 s |
| Full nine-option warm p50 | 6.01 s |
| Full nine-option warm p95 | 11.62 s |
| Repeated identical full request | 5.31–5.54 s |
| Peak process RSS | 2,889 MiB |
| Existing Muse browser p50 (61 local log samples) | 3.41 s |
| Existing Muse browser p95 (61 local log samples) | 7.44 s |

These numbers exclude STT and action execution. Current local whisper.cpp STT
logs are commonly about 3.8–8.0 seconds and are also excluded from the Muse
comparison. Laya would therefore add roughly 5–12 seconds before either an
action or the existing fallback path—often slower than the assistant call it
was meant to avoid.

During eight back-to-back full classifications, the live host remained
reachable and the Car Thing client stayed connected. 120 health requests were
roughly 1–4 ms and recent user-service logs showed no PipeWire underrun/xrun or
Chromium hang. The model did consume both physical cores, but Linux scheduling
kept the host responsive in this short test. This does not make the synchronous
routing latency acceptable.

## Artifacts and reproduction

- `benchmark.py`: model load, warm latency, memory, input-limit and accuracy run.
- `questions.json`: the fixed nine-way decision question.
- `tuning-cases.json`: prompt/safety development cases.
- `evaluation-cases.json`: held-out cases.
- `results.json`: raw per-case results and aggregate metrics.
- `worker.py`: resident JSON-lines prototype; loads the checkpoint once.
- `stress.py` and `load-probe.py`: sustained-inference and responsiveness tools.
- `test_benchmark.py`: deterministic safety/fallback tests.

Run from the repository root:

```bash
.artifacts/laya-venv/bin/python benchmarks/laya/benchmark.py \
  --model .artifacts/models/laya-english-1c5edc17 \
  --output benchmarks/laya/results.json

.artifacts/laya-venv/bin/python -m unittest benchmarks/laya/test_benchmark.py
```

## Decision

Do not add Laya to the HerThing service or enable it in production on this Mac
mini. It is compatible but not practically useful here: it is slower than the
existing assistant median, materially less accurate than simple conservative
rules, unsafe without rules, and consumes nearly 3 GiB resident memory.

If this direction continues, benchmark a compact classifier trained on
HerThing's exact allowlist (for example a small quantized encoder or fastText)
against the same untouched evaluation set. Conservative direct-command rules
are already the stronger baseline; ambiguous and parameterized requests should
continue to the conversational path.
