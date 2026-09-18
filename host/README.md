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
