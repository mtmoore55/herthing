# ADR 0001: Use Mira's hardware image as HerThing's initial foundation

- Status: accepted for the first prototype
- Date: 2026-09-18
- Scope: firmware and on-device runtime foundation

## Context

HerThing is intended to be a reproducible public open-source project, not a
personal Spotify modification. It needs reliable Car Thing drivers, display and
input support, raw microphone capture, USB networking, a kiosk runtime, clear
licensing, and an installer/recovery story. It must not make Muse, Spotify, a
paid companion, or a hosted project API a core dependency.

We inspected current source snapshots rather than selecting a project from its
feature list:

| Project | Inspected revision | Latest commit date |
|---|---:|---:|
| mira-firmware | `6582fa6` | 2026-08-31 |
| mira-daemon | `368b9e3` | 2026-09-17 |
| mira-ui | `6bf0981` | 2026-09-17 |
| mira-voice | `d1423d6` | 2026-08-30 |
| Nocturne | `86ae306` | 2026-09-10 |
| deskthing-mic | `64fb815` | 2025-10-23 |

## Decision

Start HerThing as a fork/derivative of `mira-firmware`, replacing the product
UI and application daemon with HerThing-owned components. Reuse the smallest
appropriate Apache-2.0 Mira voice pieces and retain required attribution and
third-party license notices.

Do not fork Mira's Spotify daemon as HerThing's core. Spotify belongs behind a
host integration. Do not fork Nocturne wholesale. Do not base the appliance on
DeskThing's desktop/app platform.

The initial device runtime will contain:

- The Mira-derived kernel/root filesystem and USB ECM/RNDIS gadget setup.
- A local Chromium kiosk serving HerThing's 800x480 UI.
- A small HerThing device daemon for inputs, microphone state, local wake/VAD,
  bounded RAM pre-roll, health, and a host WebSocket.
- No assistant SDK, assistant credentials, calendar credentials, or general
  integration logic.

## Why Mira

- It is current and split into understandable firmware, UI, daemon, and voice
  repositories.
- The firmware builder, UI, and voice stack are Apache-2.0. Its GPL Spotify
  daemon can be omitted from HerThing's provider-neutral core.
- Its image already exposes simultaneous ECM and RNDIS USB networking, making
  Linux/macOS/Windows installation realistic.
- Its microphone implementation is small: tinyalsa opens `hw:0,0` as mono
  S32_LE, performs local wake/endpoint detection, and can be separated from the
  Spotify resolver.
- It has no required paid companion or hosted API.
- The build can explicitly omit its bundled voice models, which supports a
  smaller bring-up image and reproducible staged development.

## Why not Nocturne as the base

Nocturne has the technically strongest microphone implementation found:

- Routes `TODDR_A` and `TODDR_B` to PDM `IN 4`.
- Captures the real four-channel array at 48 kHz S32_LE.
- Performs wind-aware channel mixing, filtering/decimation, noise suppression,
  VAD, bounded pre-roll, and endpointing.
- Emits mono 16 kHz audio in 60 ms Opus frames at 24 kbit/s.
- Treats XRUNs, EOF, stream-generation changes, lag, and stalls as explicit
  failures instead of silently emitting damaged utterances.

It also has a mature Yocto image, developer image, A/B OTA, component updates,
and extensive tests. Those are excellent engineering references.

However, its image license contains supplemental mandatory on-screen wording
and states that use/modification/distribution also requires compliance with a
separate Nocturne API License. HerThing needs independent branding and no hosted
API dependency. We will not copy Nocturne code unless its exact licensing is
later reviewed and deliberately accepted. Publicly observable ALSA hardware
facts can be independently validated on our device; HerThing's four-channel DSP
must be implemented from first principles or from clearly compatible upstream
libraries.

## Why not DeskThing as the base

DeskThing is ideal for a configurable desktop application platform, but
HerThing is a single-purpose appliance. Its additional Electron/server/app-store
surface is unnecessary. The separate ISC-declared microphone package is useful
reference material: it opens `hw:0,0` with `arecord` and streams configurable
WAV-framed chunks over WebSocket. It is much less robust than the current
Nocturne pipeline and its repository lacks a top-level license text despite the
package metadata declaring ISC, so copied code would require clarification.

## Microphone findings and implementation policy

Useful access is confirmed in three independent implementations:

1. Mira: tinyalsa, `hw:0,0`, mono S32_LE, local wake and utterance endpointing.
2. Nocturne: four-channel 48 kHz S32_LE from PDM `IN 4`, then DSP to mono 16 kHz.
3. DeskThing: `arecord` from `hw:0,0`, configurable chunking over WebSocket.

For the first hardware proof, capture the native four-channel source if the
device exposes the topology seen in Nocturne. Save only a user-triggered,
short-lived diagnostic in `/tmp`/RAM and delete it after playback. The initial
transport may use mono PCM for observability. Production transport should use
20–60 ms frames; Opus is optional over USB but valuable for Bluetooth.

HerThing's OFF transition must terminate and reap the capture process, close the
ALSA device, clear pre-roll, and be externally testable. AMBIENT retains only a
short bounded RAM ring and local inference features. Raw audio persistence and
trace output remain explicit diagnostic opt-ins.

## Public project boundaries

The repository should be organized around stable interfaces:

- `device/` — Car Thing image overlay, hardware daemon, kiosk UI
- `host/` — gateway, state machine, audio pipeline, provider adapters
- `protocol/` — versioned schemas and generated client types
- `integrations/` — Spotify, calendar, weather, reminders
- `providers/` — Muse and future assistant adapters
- `installer/` — detection, image verification, flashing/recovery UX
- `docs/` — hardware setup, privacy model, architecture, ADRs, troubleshooting

Core acceptance tests must run without Spotify or Muse. A mock provider and
simulated device should support UI/protocol development without Car Thing
hardware.

## Consequences

- We inherit Mira's proven hardware enablement while retaining independent
  product architecture and branding.
- HerThing owns the reliability work between a minimal mono prototype and a
  polished four-microphone pipeline.
- A future move to Yocto remains possible because the host protocol and UI are
  decoupled from the image.
- We must publish corresponding license notices and source for every distributed
  component, including the kernel obligations documented by Mira.

## Gate before the first flash

Normal-mode inventory is complete: the unit boots within a few seconds to the
stock `Use adapter` power-source warning, while `lsusb` and `lsusb -t` show no
Car Thing function, ADB interface, or USB network gadget. Recovery mode remains
reliably visible as `1b8e:c003` at USB 2.0 high speed. This is consistent with
stock firmware checking for its expected power adapter rather than exposing a
normal host-data interface.

The next step is entirely offline: prepare and validate:

1. A pinned upstream Mira recovery image and SHA-256.
2. A pinned HerThing bring-up image built without Spotify credentials and,
   initially, without bundled voice models.
3. FlashThing/Terbium compatibility and exact recovery instructions.
4. The archive's partition metadata and hashes.

Only after those artifacts and recovery steps are recorded should a separate,
explicit approval authorize the first flash.
