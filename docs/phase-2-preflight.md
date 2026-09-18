# Phase 2 preflight

This document is the safety gate for HerThing's first device write. Completing
this checklist does not itself authorize flashing.

## Verified hardware state

- [x] Data-capable USB cable and host port
- [x] Recovery enumeration: `1b8e:c003 Amlogic, Inc. GX-CHIP`
- [x] Recovery link speed: USB 2.0 high speed (480 Mbit/s)
- [x] Normal boot reaches stock `Use adapter` screen
- [x] Stock normal mode exposes no USB function, ADB, or network interface

## Pinned upstream inputs

### Mira baseline

- Release: `v1.2.1`
- Filename: `mira_firmware_v1.2.1.zip`
- Published size: `505935185` bytes
- Published SHA-256:
  `5533424790d50deec4f7a7ffa07620835f58152db7845de4e543cdf524f7d705`
- Release commit: `ba48be0`
- Firmware source: `6582fa6e4183b56f386d0ee0bf5d3c6ddf95bebf`
- Voice source: `d1423d6a1a041e0e356f2bc708f65abd6a9fb805`

### Flash tool

- FlashThing release: `v0.6.0`
- Release commit: `8014613`
- License: MIT
- Supports Amlogic vendor burn mode and mainline-U-Boot fastboot

## Required before first flash

- [x] Download completes with the exact published size
- [x] Independent SHA-256 verification passes
- [x] ZIP integrity check passes
- [x] Inspect and document every `meta.json` operation
- [x] Inventory every archive payload and its digest
- [x] Confirm the archive matches FlashThing's supported metadata subset
- [x] Identify the known-good reflash path if first boot fails: re-enter burn
  mode and reflash the pinned Mira 1.2.1 archive. This is not a stock restore.
- [x] Build a voice-free baseline image from pinned source
- [x] Verify the baseline archive independently
- [ ] Replace the Mira UI with the minimal HerThing diagnostic UI
- [ ] Verify the final HerThing diagnostic archive independently
- [ ] Review the final command/tool screen before authorizing the write

## Host build readiness

The pinned source checkouts are present under the gitignored `.artifacts/src/`
directory. The build toolchain is pinned in `.mise.toml`:

- Bun 1.4.2
- Go 1.27.1
- just 1.58.0
- Rust 1.98.1

Docker 29.7.2 is installed. The user must be a member of its narrowly scoped
`docker` group to access `/var/run/docker.sock`. Node 26/npm, zip/unzip, Git,
and sufficient disk space are already available.

### Baseline build result

The pinned source successfully produced a voice-free baseline archive on this
host:

- Filename: `mira_firmware_v1.2.1-herthing-baseline.zip`
- Size: `391977238` bytes
- SHA-256:
  `8d5164a3ce954da81f1b4b45bca18be57d640d6a39d88b77e197d7cc848aebd6`
- ZIP integrity: verified with `unzip -t`
- Voice bundle: disabled with `BUNDLE_VOICE=0`
- Flash metadata: version 2; same full-device operation sequence documented in
  `docs/upstream/mira-1.2.1.md`

This archive is a build-system proof, not the first-flash candidate. It still
contains Mira's UI and Spotify-oriented service.

Two host/build compatibility details were required:

1. The privileged build container needs loop device nodes for mounting the
   stock system image. These were created only inside the disposable container.
2. Void's rolling repository now supplies `rsync` requiring `ACL_1.3`, while
   the pinned builder base contains an older ACL runtime. Apply
   `patches/mira-firmware/0001-refresh-builder-acl.patch` before building.

Do not work around Docker access by running the entire source preparation as
root. Install the user-space toolchains deliberately and grant narrowly scoped
Docker access, or use a rootless container builder.

## First-flash stop conditions

Do not flash if any of these is true:

- USB recovery identity is not exactly `1b8e:c003`.
- Archive size, digest, or ZIP validation differs from the pinned record.
- The selected archive name is not visible immediately before starting.
- Power or USB is unstable.
- The recovery archive or recovery procedure is unavailable.
- Any metadata operation is not understood.

## Initial bring-up success criteria

The first HerThing image should do only enough to prove the foundation:

1. Boot reliably and expose USB ECM/RNDIS networking.
2. Display an unmistakable HerThing diagnostic screen.
3. Report touch, knob turn/press, preset, and back events.
4. Expose explicit microphone OFF with no ALSA capture owner.
5. On user action only, stream a short microphone diagnostic to the host.

Spotify, Muse, cloud credentials, ambient wake, and dashboard integrations are
out of scope for the first image.
