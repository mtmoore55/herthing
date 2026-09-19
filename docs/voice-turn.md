# Physical voice turn

The first end-to-end Phase 4 path is now:

```text
knob press -> device PCM stream -> automatic endpoint -> whisper.cpp STT
           -> assistant adapter -> Piper TTS -> automatic follow-up listening
```

The host owns generic `transcript`, `assistant_response`, and microphone states.
The Car Thing UI has no knowledge of Muse, Piper, or whisper.cpp. During a turn
it continuously moves through `listening`, `thinking`, and `speaking`, and then
returns to listening while the conversation is open. Every stream closure still
passes through a `finally` block; explicit exit and failures publish OFF.

## Conversation lifecycle

A knob press opens a three-minute conversation session and resets the provider's
conversation chain. Speech endpointing submits each utterance automatically.
After HerThing speaks, capture reopens and the user can continue without another
button press or wake word. Each real utterance extends the session; silent
15-second capture windows are recycled in memory without transcription or
storage until the session expires. Pressing the knob again, pressing preset 4,
or reaching the inactivity deadline closes the session and publishes MIC OFF.

The Meta adapter carries `previous_response_id` across turns, so corrections,
pronouns, and follow-ups share server-managed context without coupling the
device UI to Muse internals.

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
