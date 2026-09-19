# Microphone streaming proof

HerThing has proven live, memory-only microphone transport from the Car Thing
to the Omarchy host over its dedicated USB Ethernet link.

## Proven path

- Device capture: ALSA `hw:0,0`, mono, 16 kHz, signed 32-bit little-endian PCM
- Transport: streaming HTTP request over `172.16.42.0/24`
- Host endpoint: `POST /api/microphone/stream`
- UI output: `microphone.user_energy`, broadcast at no more than about 13 Hz
- Storage: none; PCM is analyzed as request chunks arrive and then discarded
- Fail-closed behavior: stream completion, failure, or disconnect returns the
  host-owned microphone state to `off` in a `finally` block
- Concurrency: a second capture is rejected while one stream owns the input

The September 19 physical proof moved 655,360 bytes during a ten-second live
capture and drove listening-state and energy updates over the existing display
protocol. A separate temporary recording was intelligible after roughly 24 dB
of digital gain. Native capture
measured approximately -55 dBFS RMS overall with peaks near -31 dBFS; an earlier
quiet-room baseline was approximately -70 dBFS.

## Energy normalization

The capture driver labels samples as S32 LE, but the useful signal occupies an
approximately 16-bit range. The host therefore normalizes samples against
32768. It maps the observed -75 to -45 dBFS range onto `0..1`, preserving a
small amount of ambient motion while putting conversational speech in the
middle of the visual range. This mapping is deliberately isolated from the
renderer so later automatic gain control or a refined device capture stack can
replace it.

## Privacy invariant

The endpoint never writes request audio to disk. `MIC OFF` means no active
request and no open capture process. A future persistent device daemon must
keep the same invariant: stop and reap capture, close ALSA, discard pre-roll,
and publish OFF before presenting the state visually.

## Next implementation

Replace the temporary `tinycap | curl` proof with a small supervised device
service that owns ALSA and the microphone state machine. Knob press should open
a conversation stream; preset 4 should provide a global OFF override. The same
PCM stream can then fan out in host memory to energy analysis, VAD, and STT.
