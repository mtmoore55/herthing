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

The initial local adapter uses Spotifyd as a Spotify Connect receiver named
`HerThing Shed`. Spotifyd exposes provider state through MPRIS; HerThing reads
that generic interface with Playerctl and maps it to `now_playing`. Device
credentials remain in Spotifyd's private cache and never enter HerThing.

Select `HerThing Shed` once from an official Spotify client to pair it. The
dashboard then receives track, artist, album, artwork, progress, and play state.
The device's previous, play/pause, and next controls are translated to MPRIS.

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
device. It deliberately rejects voice and integration commands until their
adapters are implemented.
