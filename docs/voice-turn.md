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
storage until the session expires. Pressing the knob again, speaking a natural
closing phrase, or reaching the inactivity deadline closes the session and
returns to AMBIENT. Preset 4 remains the explicit privacy control and publishes
MIC OFF.
VAD triggers alone do not extend the deadline; the normalized transcript must
contain an actual utterance.

Endpointing uses 650 ms of trailing silence, and automatic follow-up capture
starts 300 ms after a completed turn. The Muse browser bridge uses a 450 ms
stable-text window; set `HERTHING_MUSE_BROWSER_SETTLE_MS` higher if a future
Muse UI streams unusually long pauses between response fragments.

Pressing the knob while HerThing is speaking is a safe manual barge-in: playback
is cancelled immediately and capture reopens without closing the conversation.
Voice-triggered full-duplex barge-in remains disabled until the audio path has
echo cancellation; otherwise the shed speakers could interrupt themselves.

## Ambient wake and conversational sleep

In AMBIENT, PCM travels only across the private USB link to the Omarchy host.
VAD and Whisper run locally, raw audio remains memory-only, and transcripts are
discarded unless they begin with `Ziggy` (optionally `Hey Ziggy`). A wake phrase
may include its request in the same utterance. Nothing is sent to Muse merely
because room speech was detected.

A wake-only “Ziggy” receives a short “Yes?” acknowledgement before follow-up
capture opens. The user should continue speaking without pressing the knob;
pressing the knob during an open conversation intentionally closes it.

During conversation, short complete phrases such as “Okay, that's it,” “Okay,
thank you,” “Thanks Ziggy,” and “Goodnight Ziggy” close the session locally.
They are intentionally anchored as complete utterances so “thank you, but…” is
still treated as a conversational continuation.

Whisper ambient captions such as `[typing]`, `[applause]`, and `[laughs]` are
discarded before the assistant boundary. They remain neither conversation turns
nor stored raw audio.

## Speaker-aware attention

After three knob-triggered enrollment samples, each candidate wake and active
conversation turn receives a local 256-value speaker embedding. The host
compares it with the averaged local profile before crossing the assistant
boundary. An unmatched wake closes locally; an unmatched background turn is
ignored without closing the current session. Raw enrollment and turn audio stay
memory-only. The profile contains embeddings, not recordings, and lives in the
private HerThing configuration directory.

The host emits a temporary provider-neutral `notification` object with
`kind: "voice_ignored"` when it filters a turn. This supports a quiet visual cue
without a spoken correction that would interrupt the enrolled speaker.

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
