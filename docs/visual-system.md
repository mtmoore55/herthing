# Visual system

HerThing renders one continuous visual world rather than switching between
dashboard, music, and voice pages. The DOM is a sparse semantic information
layer over a dependency-free Canvas 2D field. That field is an adaptive,
architectural grid (40×24 by default) of atmospheric rectangular cells. Broad, diffused
light fields preserve the cells while preventing the result from reading as an
equalizer or literal pixel art.

The composition has three depths:

1. **Background — time and ambient world.** The grid itself forms the time. A
   cached mask makes cells inside and around custom grid-derived numerals behave
   differently, so the clock reads as calm negative space rather than text.
2. **Midground — calendar and music.** Restrained typography and album artwork
   float over the environment and continuously yield as event urgency rises.
3. **Foreground — voice.** Listening, transcription, thinking, and HerThing's
   response can supersede the information layer while the clock world remains
   alive underneath.

Clock masks are rebuilt only when the displayed minute or grid geometry
changes. A 2.2-second mask interpolation lets the field reorganize between
minutes. The renderer runs on `requestAnimationFrame`; high-frequency animation
never passes through application DOM state.

HerThing bundles Cal Sans v2 rather than depending on host fonts. Cal Sans is
used at display optical sizes for the clock, events, track titles, weather, and
ephemeral assistant language. Cal Sans Text UI handles compact metadata and
system labels. Static WOFF2 instances keep rendering deterministic on the Car
Thing's older Chromium; the upstream SIL Open Font License is distributed next
to the font assets.

## Inputs

- `now_playing.art_url` supplies the music palette. The device samples small
  regions locally; only normalized colors influence the procedural field.
- `now_playing.playing` increases field presence without replacing the scene.
- `microphone.activity` distinguishes idle, listening, thinking, and speaking.
- Optional `microphone.user_energy` and `microphone.assistant_energy` are
  normalized `0..1` inputs reserved for the Phase 4 audio pipeline.
- Weather, next event, connection, and privacy remain ordinary low-frequency
  DOM state. Time is a low-frequency renderer input instead: its cached mask
  changes only at minute boundaries.
- `minutesUntilNextEvent` is mapped through a smooth urgency curve. Urgency
  continuously changes event type scale, spacing, contrast, supporting detail,
  background energy, and how much Conditions and music yield.

Album changes interpolate the current palette and the grid continuously toward
the new visual world. The base palette interpolates continuously from muted
rose, peach, amber, and violet during the day to midnight blue, indigo, violet,
and restrained cyan at night. Slow incommensurate fields move across it on the
scale of many seconds.

Voice is modeled as independent impulses in a small row-based simulation. User
energy enters at the bottom in warm pink and travels upward; HerThing energy
enters at the top in cyan and blue-violet and travels downward. Amplitude
controls each wave's brightness and depth. The impulses can coexist and blend,
so rapid turn-taking emerges from the model rather than invoking a canned
conversation animation. There are no waveform or orb elements.

The renderer is split conceptually into low-frequency inputs, animation
simulation, and cell rendering. `HerThingVisuals.setTuning()` exposes grid
dimensions, softness, glow, idle speed/intensity, both wave speeds/decays and
sensitivities, music response, album influence, day/night interpolation, and
overall brightness. The development workbench exposes the highest-value visual
controls directly.

## Development previews

Append `?demo=` to the device UI URL. Supported useful values include:

- `off`
- `music`
- `user`
- `assistant`
- `music-user`
- `music-assistant`

These modes never connect to the host and do not alter real integrations.

For visual development, append `?debug=1`. The Visual Workbench can force dormant,
event-at-180/60/30/10/now, music, track transition, user speech, assistant
speech, combined music/conversation, imminent-event, and mic-off scenes. It
also exposes continuous event-minutes and voice-energy sliders plus three test
palettes.

From the repository, run:

```sh
cd device-ui
python -m http.server 8790 --bind 127.0.0.1
```

Then open `http://127.0.0.1:8790/?debug=1` in an 800×480 browser viewport.
The production display never loads the workbench unless this query parameter is
present.

## Touch controls

- Tap the previous, play/pause, and next buttons beside the active track. The
  controls remain available while music is paused.
- Tap the calendar summary (or press preset 3) to open today's remaining
  agenda, then swipe vertically to scroll. Tap the close button, press Back, or
  press preset 1 to return home.
- The physical knob continues to control volume, and its press remains reserved
  for conversation.

Weather artwork is inline SVG rather than font glyphs so clear, partly cloudy,
cloudy, rain, snow, fog, and storm states render on the device's older Chromium
without depending on missing system-font symbols.

Workbench controls include:

- arbitrary time and a forced minute transition;
- hybrid, void, force-field, and calm-field clock treatments;
- grid density and energy, clock void strength, boundary influence, and scale;
- no-calendar, live-transcription, and thinking scenarios;
- a compact scenario gallery and full scenario picker;
- continuous event-minutes, user-energy, and assistant-energy controls;
- pause, study speed, motion, cell softness, glow, voice-wave, and brightness
  controls;
- live renderer FPS and palette-transition triggers;
- two browser-local A/B slots and portable JSON preset export;
- `CLEAN VIEW`, with the `D` key restoring or hiding the controls.

Use the A/B slots for comparisons during one browser session. Export JSON for
design decisions worth sharing or preserving in the repository. A preset
contains scene inputs and the exact target palette, but never personal live
calendar or Spotify data.

## Attention model

Conditions are structurally persistent. The next event, active music, and
conversation do not occupy separate pages: they continuously negotiate space
and contrast. An imminent event yields music metadata without removing the
album-derived world. Conversation recedes all informational typography while
voice forces act on that same world. Assistant response text is a single
ephemeral typographic object that dissolves after 6.5 seconds; it is not a chat
history. Microphone status lives outside this hierarchy and never disappears.

## Performance

The behavioral field remains a small 40×24 logical grid. Each frame uploads its
3.75 KiB RGBA field as a texture; a minimal WebGL shader lets Car Thing's
Mali-G31 scale and present it at 800×480. Canvas 2D remains an automatic fallback.
This avoids the legacy Chromium software compositor path, which measured roughly
5 FPS with CSS filtering and redundant Canvas scaling. The physical device now
holds 60 FPS, with voice-to-visual response below one display frame under normal
load. Application state is never updated per animation frame. Design references
live at `docs/design/ambient-grid-v1.png` and
`docs/design/ambient-grid-v2.png`; v2 establishes direction rather than a
pixel-perfect UI specification.
