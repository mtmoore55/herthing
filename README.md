# Muse Car Thing

Turn a discontinued Spotify Car Thing into a thin, always-available voice
interface and ambient dashboard for Muse, with an Omarchy host doing the heavy
work.

## Status

Phase 1 research is complete as of 2026-09-18. Nothing has been flashed or
changed on the Car Thing. The device was not connected during this phase.

The current recommendation is to build a narrow **Mira-derived device image**,
not a new OS and not a stock DeskThing application:

- Reuse Mira's current Buildroot image, hardware support, Chromium kiosk,
  touchscreen/physical-input plumbing, USB networking, and ALSA microphone
  setup.
- Reuse or extract Mira's wake-word/VAD capture front end, but stream utterance
  audio to the Omarchy host instead of running the command-only ASR/resolver on
  the Car Thing.
- Run the dashboard backend, conversational session controller, STT, Muse
  adapter, tools, and TTS on this host.
- Keep the on-device UI as a purpose-built 800x480 application consuming a
  small, versioned WebSocket/HTTP protocol.

See [docs/research-2026-09-18.md](docs/research-2026-09-18.md) for the evidence,
tradeoffs, capability matrix, proposed protocol, privacy model, and Phase 2
experiment.

## Host snapshot

- Omarchy 4.0.4 / Arch Linux, x86_64
- Intel Core i5-3210M (4 logical CPUs), 15 GiB RAM
- Node 26.7, npm, Python 3, Docker, ffmpeg, PipeWire utilities, git
- No `adb`, `fastboot`, or Car Thing USB device detected during research

This machine is adequate for orchestration, integrations, VAD, TTS, and a
small/quantized local speech model. STT model choice should be benchmarked with
real shed audio before committing to local-only transcription.

## Proposed phases

1. **Research** — complete.
2. **Hardware hello world** — identify current firmware, take a recoverable
   backup where supported, flash a known development image, render a custom
   screen, log every physical input, and stream a short microphone sample.
3. **Dashboard** — clock, weather, next event, and Spotify state/control.
4. **Voice prototype** — knob press, utterance stream, STT, Muse turn, TTS.
5. **Conversation** — follow-ups, session timeout, VAD, and barge-in.
6. **Ambient** — local wake detection and explicit privacy behavior.
7. **Polish** — watchdogs, offline behavior, startup, updates, and visual QA.

## Safety gate

Do not run flashing tools or alter the Car Thing until the owner explicitly
approves Phase 2. Before flashing, record the device's USB identities and
current boot behavior and prepare a tested recovery image/tool path.

## Project log

- **2026-09-18:** Researched the current ecosystem; selected a Mira-derived
  thin-client architecture; defined the smallest hardware experiment. No device
  modification performed.
