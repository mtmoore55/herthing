# HerThing Product Principles

> **HerThing isn't a chatbot on a tiny screen. It's an ambient computer you can talk to.**

HerThing turns Spotify's discontinued Car Thing into an open-source,
voice-first AI companion. The goal is to make interacting with AI feel less
like operating software and more like having an intelligent presence in the
room. *Her* is an inspiration for natural conversation, continuity, low
friction, and an assistant that is available without constantly demanding
attention.

These principles guide product, design, and engineering decisions.

## 1. The assistant is a presence, not an app

The device is normally a useful ambient object: clock, weather, calendar, and
music control. When the user speaks, the assistant emerges; when the interaction
ends, it recedes. Avoid app grids, navigation hierarchies, and modes users must
consciously manage. The ideal interaction begins without “opening AI.”

## 2. Conversation is the interface

Users speak naturally. One conversation can contain requests, corrections,
references, follow-ups, and changes of mind. Maintain context, resolve pronouns,
and prefer intent understanding over rigid command grammars. Optimize for
conversation, not command recognition.

## 3. A wake word starts a conversation; it should not dominate one

The normal flow is `AMBIENT → wake → CONVERSATION → natural back-and-forth →
timeout → AMBIENT`. A knob press can enter conversation directly. Maintain and
extend a conversational window; do not require a repeated wake word.

## 4. Listening state must be unmistakable

HerThing has three microphone states:

- **MIC OFF:** no listening or speech processing.
- **AMBIENT:** only the minimum local processing needed for a wake condition.
- **CONVERSATION:** active listening and participation.

State is always persistent and visible, active listening has a substantial
visual treatment, and a physical control remains available everywhere. Ambient
room audio is not retained by default. A true hardware kill switch remains a
future goal. Privacy should be observable, not promised.

## 5. Voice first. Screen second.

Voice carries conversation. The screen carries time, weather, calendar, music,
choices, confirmations, status, and concise visual context. Do not turn long
assistant answers into transcripts or cover the interface in chat bubbles.

## 6. Understand the environment around the conversation

Maintain shared context across the conversation, playback, calendar, recent
actions, device state, time, and relevant environmental information. The user
talks to HerThing—not to Spotify, Calendar, Weather, or Muse.

## 7. The user can interrupt

Support TTS cancellation, preserve context across interruption, and investigate
full-duplex audio and VAD during playback. Barge-in is core conversational
behavior, not polish.

## 8. Latency is a product feature

Measure speech-end to transcript, first assistant token, first audible response,
and interruption to stopped audio. Prefer streaming audio → STT → agent → TTS.
Time-to-first-audio is a primary product metric. Fast enough to converse beats
slow enough to impress.

## 9. Not every action deserves words

Use the smallest useful acknowledgement: action only, animation, tone, short
confirmation, or full response. Speech should add value, not prove that an
action occurred.

## 10. Personality comes from continuity, not decoration

Prioritize memory, references, context, consistency, useful preferences, and
ongoing threads over avatars, fake emotions, faces, or filler. Build continuity
before personality theater.

## 11. The user should always know what HerThing can perceive

At any moment, the user must be able to answer “Can this thing hear me right
now?” The same principle extends to future sensors and connected data sources.
Hardware controls should override software where possible, and new perception
must never appear silently.

## Ambient mode

The default experience stays useful even if the assistant is never invoked.
Information is glanceable from across a desk. Every persistent element must
earn its pixels.

## Physical controls matter

Car Thing's controls are an advantage. The initial mapping is:

| Control | Default behavior |
|---|---|
| Knob turn | Home volume / secondary-screen selection |
| Knob press | Home conversation / secondary-screen confirm |
| Knob hold | Microphone mute / unmute |
| Preset 1 | Home |
| Preset 2 | Music |
| Preset 3 | Today |
| Preset 4 | Experiences / settings |
| Back | Back / return home |

Mappings may evolve; common actions should develop physical muscle memory.

## What HerThing is not

HerThing is not ChatGPT squeezed onto a Car Thing, a widget-packed dashboard,
a replacement Spotify client, a voice-command remote, a tiny smartphone, a
constantly talking assistant, a device that hides when it is listening, or a
Muse-specific product. Muse is the first adapter, not the architecture.

## Decision heuristic

Ask: **Which option makes HerThing feel less like operating a computer and more
like naturally interacting with an intelligent presence?** Then require that
the user remains in control, privacy is obvious, interaction becomes faster or
simpler, and conversational continuity survives.

If an impressive feature makes the device more complicated, distracting,
opaque, or app-like, do not build it.

## North star

Someone working alone in a room should eventually forget they are “using AI.”
They glance when they need information, speak naturally, interrupt, change
their mind, ask follow-ups, request music, delegate small tasks, and return to
their work. The technology recedes. **The conversation remains.**
