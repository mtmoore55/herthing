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

The September 19 transport proof moved 655,360 bytes during a ten-second
memory-only capture. That first `curl --data-binary @-` probe buffered input
until EOF, proving transport and analysis but not live delivery. The supervised
device service therefore uses `curl --upload-file -`, which sends a chunked
request as PCM arrives. A separate temporary recording was intelligible after
roughly 24 dB of digital gain. Native capture
measured approximately -55 dBFS RMS overall with peaks near -31 dBFS; an earlier
quiet-room baseline was approximately -70 dBFS.

## Energy normalization

The capture driver supplies signed 32-bit little-endian samples, normalized
against `2³¹`. The host maps the observed -75 to -45 dBFS range onto `0..1`,
preserving a small amount of ambient motion while putting conversational speech
in the middle of the visual range. This mapping is deliberately isolated from
the renderer so later automatic gain control or a refined device capture stack
can replace it.

## Privacy invariant

The endpoint never writes request audio to disk. `MIC OFF` means no active
request and no open capture process. A future persistent device daemon must
keep the same invariant: stop and reap capture, close ALSA, discard pre-roll,
and publish OFF before presenting the state visually.

## Development device service

`device/microphone/` now contains the small supervised service that owns ALSA
and the microphone state machine. Its local CGI control surface is reachable
only over the dedicated device link. Knob press toggles a conversation stream;
preset 4 provides a global OFF override. The host applies a conservative energy endpoint detector:
after at least 220 ms of detected speech, 1.2 seconds below the silence
threshold ends the utterance automatically. A second knob press remains an
immediate manual endpoint, and silence alone never starts transcription.
Capture uses a chunked upload, and the same PCM stream fans out in host memory
to energy analysis, endpointing, and STT.

On the current development image, the service files and capture helper live on
the writable `/var/local/herthing` partition. A standalone `runsv` process
supervises them because this image's active runit directory is read-only. The
service therefore survives UI/host restarts but must be registered again after
a full Car Thing reboot. The next firmware build will install the service and
its tinyalsa dependency into the image so normal boot owns this lifecycle.

Steady quiet-room input measured approximately -69 dBFS and maps to about 0.19
visual energy. The ALSA stream can produce a short startup transient; renderer
smoothing prevents that single frame from becoming a privacy-state transition.
