# Visual system

HerThing renders one continuous visual world rather than switching between
dashboard, music, and voice pages. The DOM is a sparse semantic information
layer over a dependency-free Canvas 2D field.

## Inputs

- `now_playing.art_url` supplies the music palette. The device samples small
  regions locally; only normalized colors influence the procedural field.
- `now_playing.playing` increases field presence without replacing the scene.
- `microphone.activity` distinguishes idle, listening, thinking, and speaking.
- Optional `microphone.user_energy` and `microphone.assistant_energy` are
  normalized `0..1` inputs reserved for the Phase 4 audio pipeline.
- Clock, weather, next event, connection, and privacy state remain ordinary
  low-frequency DOM state.
- `minutesUntilNextEvent` is mapped through a smooth urgency curve. Urgency
  continuously changes event type scale, spacing, contrast, supporting detail,
  background energy, and how much Conditions and music yield.

Album changes interpolate the current palette toward the new palette. User
voice energy enters as a warm left-origin force; assistant energy enters as a
cool right-origin force. Both compose over music.

## Development previews

Append `?demo=` to the device UI URL. Supported useful values include:

- `off`
- `music`
- `user`
- `assistant`
- `music-user`
- `music-assistant`

These modes never connect to the host and do not alter real integrations.

For visual development, append `?debug=1`. The Scene Lab can force dormant,
event-at-180/60/30/10/now, music, track transition, user speech, assistant
speech, combined music/conversation, imminent-event, and mic-off scenes. It
also exposes continuous event-minutes and voice-energy sliders plus three test
palettes. The lab exists only when explicitly requested by the query string.

## Attention model

Conditions are structurally persistent. The next event, active music, and
conversation do not occupy separate pages: they continuously negotiate space
and contrast. An imminent event yields music metadata without removing the
album-derived world. Conversation recedes all informational typography while
voice forces act on that same world. Assistant response text is a single
ephemeral typographic object that dissolves after 6.5 seconds; it is not a chat
history. Microphone status lives outside this hierarchy and never disappears.

## Performance

The scene renders internally at 160x96 and scales to 800x480. Soft color fields
are cached textures; palette textures rebuild only during slow transitions.
Scene evolution runs at 12 Hz because motion is deliberately slow and the
Car Thing's legacy Chromium software compositor remains CPU-heavy regardless of
Canvas paint frequency. Voice-to-visual response remains below one scene frame
(about 80 ms). Application state is never updated per animation frame.
