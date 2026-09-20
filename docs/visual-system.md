# Visual system

HerThing renders one continuous visual world rather than switching between
dashboard, music, and voice pages. The DOM is a sparse semantic information
layer over a dependency-free Canvas 2D field. That field is a deliberately
low-resolution 20×12 grid of atmospheric rectangular cells. Broad, diffused
light fields preserve the cells while preventing the result from reading as an
equalizer or literal pixel art.

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
- Clock, weather, next event, connection, and privacy state remain ordinary
  low-frequency DOM state.
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

Workbench controls include:

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

The scene renders internally at 160x96 and scales to 800x480. Scene evolution
runs at 12 Hz because motion is deliberately slow and the
Car Thing's legacy Chromium software compositor remains CPU-heavy regardless of
Canvas paint frequency. Voice-to-visual response remains below one scene frame
(about 80 ms). Application state is never updated per animation frame. Design
references live at `docs/design/ambient-grid-v1.png` and
`docs/design/ambient-grid-v2.png`; v2 establishes direction rather than a
pixel-perfect UI specification.
