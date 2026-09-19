# Physical voice turn

The first end-to-end Phase 4 path is now:

```text
knob press -> device PCM stream -> knob press -> whisper.cpp STT
           -> assistant adapter -> Piper TTS -> PipeWire default sink
```

The host owns generic `transcript`, `assistant_response`, and microphone states.
The Car Thing UI has no knowledge of Muse, Piper, or whisper.cpp. During a turn
it continuously moves through `listening`, `thinking`, and `speaking`, and then
returns to OFF in a `finally` block.

## Assistant providers

`HERTHING_ASSISTANT_PROVIDER=local` is the default credential-free diagnostic
provider. It can answer basic time, weather, next-event, and now-playing
questions from HerThing's shared context.

`HERTHING_ASSISTANT_PROVIDER=muse` invokes Meta Muse's headless JSONL interface.
The adapter extracts only its final assistant response and deliberately disables
shell access, filesystem writes, and web tools for this first integration.
The installed Muse CLI must first be authenticated with `muse login`.

`HERTHING_ASSISTANT_PROVIDER=meta` is the low-latency production path. It calls
Meta's Responses API directly, reuses the credential in Muse's secure auth
store, and carries `previous_response_id` across turns for continuity. This
avoids launching the full coding-agent harness for every spoken sentence.

## Speech

`scripts/prepare-piper.sh` creates a project-local Python environment, pins
Piper 1.8.0, and downloads `en_US-lessac-medium`. The service streams Piper's
raw mono PCM output directly into `pw-play`; no synthesized speech file is
written. Set `HERTHING_TTS_ENABLED=0` to disable spoken output.
Set `HERTHING_AUDIO_SINK` to a PipeWire node name when the machine also has
virtual sinks (for example Sunshine); HerThing will then target the physical
speaker independently of the desktop default.

The host now includes `herthing-tts.service`, a localhost-only worker that keeps
Piper's model resident and streams sentence PCM directly to PipeWire. The
one-shot CLI remains an automatic fallback. Logs distinguish time-to-first-audio
from total playback duration.
