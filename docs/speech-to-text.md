# Speech-to-text baseline

HerThing's first STT adapter is local `whisper.cpp` with the English `base.en`
model (the historical measurements below used `tiny.en`). It is a benchmarkable
provider implementation, not a dependency of the device protocol or a final
architecture decision.

## Reproduce

```sh
mise install bun@1.4.2 cmake@4.4.3
./scripts/prepare-whisper.sh
```

Source and model checksums are pinned in `upstream.lock.json`. The generated
CLI, localhost server, and model remain under ignored `.artifacts/` storage.
`herthing-stt.service` keeps the model resident and the adapter falls back to
the one-shot CLI if that worker is unavailable.

## Privacy path

The host accumulates one active utterance in memory. At speech end it converts
the device's 32-bit PCM into an amplified 16-bit WAV in memory and posts it to
the persistent recognizer. No microphone audio is written to storage on the
normal path. The one-shot recovery path uses a short-lived `/dev/shm` WAV and
deletes it immediately. Starting the next utterance clears the previous
transcript from shared state.

## Physical benchmark

On the shed host's Intel i5-3210M (two cores/four threads), the first physical
Car Thing utterance produced:

- spoken text: `HerThing, what's the weather looking like this afternoon?`
- recognized text: `Earth thing. What's the weather looking like this afternoon?`
- speech-end to transcript: 4602 ms

The standard `tiny.en` model transcribed whisper.cpp's 11-second JFK sample in
about 6.2 seconds. The official `tiny.en-q5_1` build took about 6.4 seconds and
lost punctuation, so quantization did not help on this CPU. HerThing keeps the
standard model for the functional prototype and adds a domain prompt for its
name and common integrations.

Keeping the same model resident reduced the synthetic adapter benchmark from
roughly 6.2 seconds to 3.35 seconds. This is a useful interim improvement but
is still utterance-batched recognition rather than genuinely streaming STT.

This latency does not meet the conversational product target. Next, benchmark a
genuinely streaming CPU recognizer such as sherpa-onnx Zipformer. Whisper can
remain an accuracy fallback or be replaced by a hosted streaming STT adapter.

## Streaming shadow path

HerThing now includes an opt-in persistent Sherpa-ONNX Zipformer recognizer.
It consumes live S32 LE microphone chunks while capture is still open and emits
partial hypotheses before the VAD endpoint. Batch Whisper remains authoritative
in shadow mode:

```sh
./scripts/prepare-voice-front-end.sh
HERTHING_STREAMING_STT=shadow bun run host/server.js
```

Each turn logs `[stt:shadow]` with time to first partial, streaming final
latency, and both transcripts. Structured `[turn:<id>]` JSON logs put capture,
endpoint, both recognizers, speaker verification, assistant, and TTS timing on
one monotonic timeline. `/health` reports whether the worker is ready.

Run the pinned model's included sample in real time or as fast as the CPU can
decode it:

```sh
bun benchmarks/streaming-stt.js
bun benchmarks/streaming-stt.js --fast
```

Do not promote streaming output until physical Car Thing turns show acceptable
accuracy. Set `HERTHING_STREAMING_STT=1` only after that gate; an empty or
failed streaming result automatically falls back to batch Whisper.
