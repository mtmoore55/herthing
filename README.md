# HerThing

HerThing turns abandoned Spotify Car Things into beautiful, ambient,
voice-first AI companions: an open-source attempt at the physical,
conversational experience depicted in *Her*.

The Car Thing is a thin privacy-aware control surface. A nearby Linux host does
the heavier speech, assistant, integration, and audio work. Assistant providers
are adapters; Muse will be the first personal deployment, not a core dependency.

## Status

Foundation research is complete as of 2026-09-18. Nothing has been flashed or
changed on the Car Thing. Recovery-mode USB enumeration is verified on the
development host as `1b8e:c003 Amlogic, Inc. GX-CHIP` at USB 2.0 high speed.

The current recommendation is to build a narrow **Mira-derived device image**,
not a new OS, a Nocturne rebrand, or a stock DeskThing application:

- Reuse Mira's current Buildroot image, hardware support, Chromium kiosk,
  touchscreen/physical-input plumbing, USB networking, and ALSA microphone
  setup.
- Reuse or adapt Mira's wake-word/capture front end, but stream utterance
  audio to the Omarchy host instead of running the command-only ASR/resolver on
  the Car Thing.
- Run the dashboard backend, conversational session controller, STT, Muse
  adapter, tools, and TTS on this host.
- Keep the on-device UI as a purpose-built 800x480 application consuming a
  small, versioned WebSocket/HTTP protocol.

See [docs/research-2026-09-18.md](docs/research-2026-09-18.md) and
[ADR 0001](docs/adr/0001-firmware-foundation.md) for the evidence,
tradeoffs, capability matrix, proposed protocol, privacy model, and Phase 2
experiment.

First-write preparation is tracked in
[docs/phase-2-preflight.md](docs/phase-2-preflight.md). The pinned Mira archive
audit is in [docs/upstream/mira-1.2.1.md](docs/upstream/mira-1.2.1.md).

## Host snapshot

- Omarchy 4.0.4 / Arch Linux, x86_64
- Intel Core i5-3210M (4 logical CPUs), 15 GiB RAM
- Node 26.7, npm, Python 3, Docker, ffmpeg, PipeWire utilities, git
- No `adb` or `fastboot` currently installed
- Car Thing recovery mode verified as USB ID `1b8e:c003`

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
- **2026-09-18:** Renamed the project HerThing; verified Amlogic burn-mode USB;
  audited current Mira, Nocturne, and DeskThing microphone source and licensing;
  recorded the public-project foundation decision. Still no device write.
- **2026-09-18:** Verified normal boot from the host USB port. The screen reaches
  stock firmware's `Use adapter` power-source warning after a few seconds; as
  expected, stock firmware exposes no normal-mode USB device on this path.
- **2026-09-18:** Downloaded and independently verified the pinned Mira 1.2.1
  recovery archive; audited all flash operations and payload hashes against
  FlashThing 0.6.0. Pinned exact source revisions. No device write performed.
