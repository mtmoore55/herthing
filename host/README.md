# HerThing host

The host service owns dashboard state and future assistant/integration adapters.
It binds only to the dedicated Car Thing USB address by default.

```bash
mise exec -- bun run host/server.js
```

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
