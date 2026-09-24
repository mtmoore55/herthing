# HerThing host

For a clean Omarchy host or a machine migration, start with
[the installation guide](../docs/omarchy-installation.md).

The host service owns dashboard state and future assistant/integration adapters.
It binds only to the dedicated Car Thing USB address by default.

```bash
mise exec -- bun run host/server.js
```

For this development checkout, install the user service with:

```bash
mkdir -p ~/.config/systemd/user ~/.config/herthing
cp installer/systemd/herthing-host.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now herthing-host.service
```

The checked-in unit expects the repository at `~/Code/HerThing`. Its optional
environment file is `~/.config/herthing/environment`.

## Weather

Current conditions use Open-Meteo and require no API key. Location is never
guessed. Add coordinates to `~/.config/herthing/environment`:

```ini
HERTHING_LATITUDE=45.0000
HERTHING_LONGITUDE=-122.0000
HERTHING_WEATHER_UNIT=fahrenheit
```

Restart with `systemctl --user restart herthing-host.service`. Weather refreshes
at startup and every ten minutes. Until coordinates are configured, weather is
shown as unavailable.

## Calendar

The read-only calendar adapter accepts a private iCalendar feed from Google,
Apple, Fastmail, Nextcloud, or another RFC 5545 provider. Add its secret URL to
the private environment file:

```ini
HERTHING_CALENDAR_ICS_URL=https://calendar-provider.example/private.ics
```

The feed is fetched at startup and every five minutes. Recurring events are
expanded locally. Feed contents and URLs are never stored by HerThing or sent
to the Car Thing; the device receives only the normalized next event.

## Notes

Voice capture writes Markdown into a local vault — an Obsidian vault works
unmodified, because the files are only ever plain Markdown. Point HerThing at
the directory in the private environment file:

```ini
HERTHING_NOTES_DIR=/home/you/notes
```

Capture is disabled until that variable is set; no directory is created
implicitly. Once set, `todos.md` and `inbox.md` are created on first use.

Phrases such as "remind me to…", "add … to my to-do list", "take a note…",
"note that…", and "write this down…" are matched by conservative literal rules
in `notes.js` and answered locally, without a relay round trip. Everything else
falls through to the assistant unchanged. Captured text is the transcript
itself rather than anything a model extracted, so the only failure mode is a
mishearing, and the result is an editable line in a file.

Each captured line carries an Obsidian block anchor (`^2026-09-21T09-12-33-482`)
so a later agent can refer to one specific item. Writes always append, which is
what keeps a vault synced across devices from producing conflicts.

The open to-do list is included in assistant context only when the request
mentions tasks or reminders, so ordinary turns never send personal notes
outward.

Touchscreen media controls and playback state use the authenticated Spotify Web
API token created by `spotify_player authenticate`. HerThing follows the active
player on the account, so playback on a phone or another Spotify Connect target
is reflected on the display. Album artwork is proxied through the host because
the Car Thing's USB network does not provide general internet access.

## Spotify Connect

The development install uses Librespot as a Spotify Connect receiver named
`HerThing Shed`. It is bound explicitly to the Wi-Fi address so the Car Thing's
USB network cannot produce an unreachable discovery record. Librespot's event
hook still writes diagnostic state under `$XDG_RUNTIME_DIR`. Credentials remain
in Librespot's private cache and never enter HerThing.

Select `HerThing Shed` once from an official Spotify client to pair it. The
dashboard receives track, artist, album, artwork, progress, and play state from
the account-wide Spotify playback API.

Set `HERTHING_WIFI_ADDRESS` in the private environment file and install
`installer/systemd/herthing-librespot.service` as a user unit. The Wi-Fi LAN
must allow UDP 5353 for discovery and TCP 4071 for pairing. The development
host limits both firewall rules to its Wi-Fi interface and local subnet.

The physical knob changes the host's default PipeWire sink through `wpctl`.
Spotify playback state and album artwork require `user-read-playback-state`;
play/pause/previous/next additionally require the narrowly scoped
`user-modify-playback-state` permission.

Health and current state are available at:

```bash
curl http://172.16.42.1:8787/health
curl http://172.16.42.1:8787/api/state
```

Integration adapters update state with `POST /api/state`. For example:

```bash
curl -X POST http://172.16.42.1:8787/api/state \
  -H 'content-type: application/json' \
  -d '{"weather":{"temperature":71,"unit":"F","condition":"Clear","symbol":"sun"}}'
```

In ambient mode, the device streams memory-only S32 LE PCM to
`POST /api/microphone/stream`. The host runs a small local Sherpa-ONNX keyword
spotter continuously and retains only a short 1.8-second in-memory pre-roll
buffer.
Saying `Ziggy` opens a conversation and preserves the beginning of the request;
no ambient audio is written to disk or sent to a cloud service. Completed
utterances are transcribed locally with whisper.cpp, passed to the configured
assistant adapter, and spoken through the host's PipeWire sink with Piper.

Prepare the pinned local wake runtime and English keyword model with:

```bash
./scripts/prepare-voice-front-end.sh
```

`HERTHING_WAKE_THRESHOLD` controls the Ziggy wake threshold (default `0.06`;
higher is
more conservative). Set `HERTHING_KWS_ENABLED=0` to use the older
utterance-transcription fallback. `GET /health` reports whether the streaming
detector is installed, running, and ready. `HERTHING_WAKE_COMMAND_GRACE_MS`
(default `1400`) keeps the wake-word boundary from cutting off a request spoken
immediately after `Ziggy`.

Set `HERTHING_STREAMING_STT=shadow` to run the pinned streaming Zipformer beside
Whisper without changing assistant input. The `[stt:shadow]` and `[turn:<id>]`
logs compare accuracy and end-of-speech latency. After a physical evaluation,
`HERTHING_STREAMING_STT=1` makes streaming output authoritative while retaining
Whisper as an automatic failure fallback. `HERTHING_STREAMING_STT_THREADS`
defaults to `2` so the two-core shed host retains capacity for wake detection,
speaker verification, Chromium, and audio.

During an active conversation, the same local detector closes the session on
phrases including `okay, that's it`, `thank you`, `thanks Ziggy`, `we're done`,
`all done`, `stop listening`, `go to sleep`, and `good night Ziggy`. These are
system-level privacy controls: they are acted on immediately and are not sent
to the assistant provider.

## Local speaker attention

HerThing can locally verify that conversational turns came from the enrolled
speaker. Prepare the pinned English WeSpeaker embedding model and native helper
with `./scripts/prepare-voice-front-end.sh`. Enrollment is deliberately
physical: arm a sample, press the Car Thing knob when ready, speak naturally
for roughly five seconds, and pause. Repeat three times:

```bash
curl -X POST http://172.16.42.1:8787/api/speaker/enroll \
  -H 'content-type: application/json' -d '{"name":"owner"}'
```

The profile is enabled only after three samples. It is stored with user-only
permissions at `~/.config/herthing/speaker-profile.json`; raw enrollment audio
is never written to disk. `HERTHING_SPEAKER_THRESHOLD` controls similarity
(default `0.55`). Unmatched wakes are rejected. During an existing conversation,
an unmatched turn is discarded locally while the conversation remains open for
the enrolled speaker. The host publishes a short `notification` with kind
`voice_ignored` so the device can acknowledge this without speaking.

Speaker verification is an attention filter, not authentication. Sensitive
actions still need approval, and overlapping voices can reduce match quality.

The default `local` assistant answers a small set of context-aware questions so
the entire physical path can be tested without credentials. To use Meta Muse:

```bash
muse login
mkdir -p ~/.config/herthing
printf 'HERTHING_ASSISTANT_PROVIDER=muse\n' >> ~/.config/herthing/environment
systemctl --user restart herthing-host.service
```

Muse is an adapter, not a core dependency. Its invocation has shell, web, and
workspace writes disabled. Prepare the pinned local speech runtime with:

```bash
./scripts/prepare-piper.sh
```

## Personal Muse browser adapter

Meta does not currently expose a public API for the consumer Muse agent's
memory, connectors, or secure runtime. The experimental `muse-browser` adapter
drives a dedicated, visible Muse browser session through Chrome DevTools
Protocol. It does not reuse or inspect the user's everyday browser profile.

Start the isolated browser and sign in to Muse once:

```bash
./scripts/start-muse-browser.sh
```

For an always-on installation, copy and enable the included user service:

```bash
cp installer/systemd/herthing-muse-browser.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now herthing-muse-browser.service
```

The profile is stored with owner-only permissions at
`~/.local/share/herthing/muse-browser` and must never be committed. Once the
dedicated Muse chat is ready, configure the host:

```ini
HERTHING_ASSISTANT_PROVIDER=muse-browser
HERTHING_MUSE_BROWSER_DEBUG_URL=http://127.0.0.1:9333
HERTHING_MUSE_BROWSER_CHAT_URL=https://muse.ai/thread/your-dedicated-side-chat
```

Set the matching `HERTHING_MUSE_BROWSER_URL` on the browser service so it opens
that side chat after login or reboot. Treat the thread URL as private local
configuration; do not commit it to a public repository.

Keep the browser open while using this provider. It is intentionally an
experimental adapter: upstream UI changes can break it. The direct `meta`
provider remains available as the reliable low-latency fallback.

`GET /health` reports whether the dedicated Muse page is reachable. If the
browser is unavailable before a message is submitted, HerThing safely falls
back to the direct Meta Model API. It does not retry after submission, because
that could create duplicate turns.

If Muse changes its markup, inspect only a known test response without dumping
private conversation history:

```bash
bun scripts/inspect-muse-dom.js 'Exact known test response.'
```
