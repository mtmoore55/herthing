# HerThing

HerThing turns abandoned Spotify Car Things into beautiful, ambient,
voice-first AI companions: an open-source attempt at the physical,
conversational experience depicted in *Her*.

The Car Thing is a thin privacy-aware control surface. A nearby Linux host does
the heavier speech, assistant, integration, and audio work. Assistant providers
are adapters; Muse will be the first personal deployment, not a core dependency.

## Status

Foundation research and the first hardware bring-up are complete as of
2026-09-18. HerThing `0.1.0-alpha.1` has been flashed to the physical Car Thing
and boots into the custom diagnostic UI. Recovery-mode USB enumeration is
verified on the development host as `1b8e:c003 Amlogic, Inc. GX-CHIP` at USB
2.0 high speed.

The physical device now runs the Mira-derived HerThing image. Its display,
touchscreen, knob, knob press, presets, Back button, USB network, and ALSA
microphone capture path have been exercised. A Phase 3 ambient-dashboard preview
is connected to the provider-neutral host protocol over USB Ethernet.

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

Product and interaction decisions are governed by the
[HerThing Product Principles](docs/product-principles.md): presence over apps,
conversation over commands, observable privacy, voice-first interaction,
interruptibility, and latency as a product feature.

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
- **2026-09-18:** Installed a pinned host toolchain, reproduced a voice-free
  Mira-derived baseline image, fixed and documented a current Void/rsync ACL
  build incompatibility, and verified the resulting archive and manifest. No
  device write performed.
- **2026-09-18:** Added the 800x480 HerThing hardware diagnostic UI, verified
  its desktop rendering and interaction harness, embedded it in a voice-free
  firmware candidate, and independently validated the resulting ZIP. Published
  the project at <https://github.com/mtmoore55/herthing>. No device write
  performed.
- **2026-09-18:** Rebranded and independently verified the final diagnostic
  firmware candidate. The owner explicitly authorized the first device write;
  live recovery-mode identity remains the final stop condition.
- **2026-09-18:** Verified recovery identity `1b8e:c003`, flashed the checked
  HerThing `0.1.0-alpha.1` archive with pinned FlashThing `v0.6.0`, and reached
  the custom `HERTHING — Hardware hello` screen on physical hardware. The
  inherited Mira boot splash remains a known cosmetic limitation.
- **2026-09-18:** Verified touch, knob rotation/press, presets, and Back on the
  physical device. Established the USB link at `172.16.42.1/24` (host) and
  `172.16.42.2` (device), confirmed no idle capture owner, and completed an
  explicitly authorized 5.12-second microphone capture from ALSA `hw:0,0`.
  The raw sample and temporary probes were deleted after validation.
- **2026-09-18:** Started Phase 3 with the `herthing/1` JSON schema, a
  provider-neutral Bun host service, and the first ambient dashboard. Deployed
  it as a reversible bind-mounted preview, added a USB-interface-only firewall
  rule, and verified the physical Chromium client connected over WebSocket.
- **2026-09-18:** Corrected rotary direction from physical testing, added an
  API-key-free Open-Meteo adapter, and packaged the host gateway as a restartable
  systemd user service. Enabled it on the development host and verified that the
  physical Car Thing reconnects automatically. Live weather remains opt-in
  through explicit location coordinates.
- **2026-09-18:** Activated live weather for the development device and added a
  provider-neutral, read-only iCalendar adapter with recurring-event support.
  Calendar feed credentials remain private host configuration.
- **2026-09-18:** Connected the development Google Calendar through its private
  read-only feed, created a `HerThing Shed` Spotify Connect receiver, and added
  a generic MPRIS now-playing/control adapter for the dashboard.
- **2026-09-18:** Replaced the receiver with Wi-Fi-bound Librespot after physical
  discovery testing exposed an ambiguous multi-interface mDNS record. Verified
  live audio and dashboard metadata, added real knob-to-PipeWire volume, and
  packaged the receiver as a reproducible user service.
- **2026-09-18:** Moved wall-clock timezone ownership to the host so the Car
  Thing's UTC-configured runtime renders the clock and calendar consistently in
  the host's local timezone, including daylight-saving offsets.
- **2026-09-18:** Replaced the Phase 3 card dashboard with a dependency-free
  continuous Canvas visual field: calm ambient typography, album-derived
  generative color, morphing track transitions, composable user/assistant voice
  energy inputs, and an always-visible three-state privacy indicator.
- **2026-09-18:** Added an opt-in 800×480 visual workbench with fixed scene
  scenarios, slow-motion and pause controls, live performance feedback,
  palette transitions, A/B slots, and portable design presets. See
  [`docs/visual-system.md`](docs/visual-system.md).
- **2026-09-19:** Proved memory-only microphone transport from Car Thing ALSA
  to the host, then replaced the buffering probe with a supervised, chunked
  device stream. Real PCM energy drives the shared visual world without writing
  audio to disk, concurrent capture is rejected, and every stream exit forces
  the published privacy state back to `MIC OFF`. See
  [`docs/microphone-streaming.md`](docs/microphone-streaming.md).
- **2026-09-19:** Completed the first physical knob-to-transcript loop with a
  pinned local whisper.cpp adapter and RAM-only utterance files. Accuracy was
  usable but speech-end latency measured 4.6 seconds on the shed host, so this
  is a functional baseline rather than the final conversational STT path. See
  [`docs/speech-to-text.md`](docs/speech-to-text.md).
