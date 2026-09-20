# HerThing host

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

The checked-in unit expects the repository at `~/herthing`. Its optional
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

## Spotify Connect

The development install uses Librespot as a Spotify Connect receiver named
`HerThing Shed`. It is bound explicitly to the Wi-Fi address so the Car Thing's
USB network cannot produce an unreachable discovery record. Librespot's event
hook writes normalized ephemeral state under `$XDG_RUNTIME_DIR`; HerThing maps
that state to `now_playing`. Credentials remain in Librespot's private cache and
never enter HerThing.

Select `HerThing Shed` once from an official Spotify client to pair it. The
dashboard then receives track, artist, album, artwork, progress, and play state.
MPRIS remains a supported adapter fallback. Direct controls for Librespot need
a separate control path and are not yet enabled.

Set `HERTHING_WIFI_ADDRESS` in the private environment file and install
`installer/systemd/herthing-librespot.service` as a user unit. The Wi-Fi LAN
must allow UDP 5353 for discovery and TCP 4071 for pairing. The development
host limits both firewall rules to its Wi-Fi interface and local subnet.

The physical knob changes the host's default PipeWire sink through `wpctl`.
Spotify play/pause/previous/next require the narrowly scoped Spotify Web API
`user-modify-playback-state` permission; this is intentionally separate from
the local metadata path.

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

The service starts with microphone mode `off` and does not open an audio
device. The development microphone bridge accepts memory-only S32 LE PCM at
`POST /api/microphone/stream`. Physical knob events ask the device-local
control service to toggle conversation capture; preset 4 always requests OFF.
A closed, failed, or disconnected stream publishes OFF from a `finally` block.
The completed utterance is transcribed locally with whisper.cpp, passed to the
configured assistant adapter, and spoken through the host's default PipeWire
sink with Piper. Raw audio and intermediate WAV files are not retained.

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
