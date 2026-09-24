# Installing the existing HerThing on Omarchy

This guide preserves the current Car Thing / Linux host architecture. The
desktop browser displays the same UI; it does not capture the PC microphone.
Never copy a different machine's audio node name or network interface blindly.

## Checkout and host dependencies

Clone into `~/Code/HerThing`. If migrating, check the old checkout for local
changes before assuming GitHub contains its working version. Keep credential
backups outside the repository with owner-only permissions.

The host requires Bun 1.4.2, Node (for syntax checks), Python 3 with venv/pip,
CMake 4.4.3, a C/C++ toolchain, Git, curl, tar/bzip2, and PipeWire's `pw-play`
and `wpctl`. The desktop UI needs Python and a Chromium-based browser. On
Omarchy, install missing system packages with `omarchy pkg add`, for example
`omarchy pkg add base-devel python python-pip curl bzip2 pipewire-audio`.
Inspect installed packages first; a host migration does not require a firmware
rebuild, Go, Rust, Just, Docker, or a GPU inference stack.

```sh
cd ~/Code/HerThing
mise trust .mise.toml
mise install bun@1.4.2 cmake@4.4.3
cd host
MISE_AUTO_INSTALL=false mise exec -- bun install --frozen-lockfile
MISE_AUTO_INSTALL=false mise exec -- bun run check
cd ..
./scripts/prepare-whisper.sh
./scripts/prepare-voice-front-end.sh
./scripts/prepare-piper.sh
```

The Whisper script pins source and the `base.en` model, and builds a CPU
runtime. Rebuild native binaries and recreate Python environments on a new
host; do not copy an old virtualenv. Downloaded artifacts stay in ignored
`.artifacts/`. Existing model files can be transferred privately from the old
host to avoid downloads, retaining the script's checksum checks.

## Private configuration

Create `~/.config/herthing` with mode 700. For a new install, copy `.env.example`
to `~/.config/herthing/environment` and set its mode to 600. Do not overwrite an
existing file. Restore values, not old machine assumptions:

- Calendar: `HERTHING_CALENDAR_ICS_URL`, the private read-only ICS URL. No
  Google OAuth application is required by this adapter.
- Weather: explicit latitude/longitude and temperature unit; no API key.
- Spotify: `~/.cache/spotify-player/user_client_token.json`, or reauthenticate
  with `spotify_player authenticate` after installing that optional client.
- Meta/Muse: `~/.config/muse/auth.json` or `MODEL_API_KEY` for the Meta adapter.
- Muse browser: select `muse-browser`, set both private browser URL variables
  to the dedicated chat, and sign in in the isolated browser started by
  `scripts/start-muse-browser.sh`. The browser script receives environment
  variables from its systemd unit; it does not read the environment file itself.
  CLI/API credentials do not sign in the browser.
- Speaker attention: `~/.config/herthing/speaker-profile.json`, if enrolled.
- Notes: optional `HERTHING_NOTES_DIR`; copy the vault separately if used.

Keep all credential files mode 600. Inspect old systemd drop-ins as well as the
environment file: the old deployment selected its browser provider there.
Leave `HERTHING_AUDIO_SINK` unset until the actual output has been confirmed
with `wpctl status` and a physical playback check.

## Dedicated Car Thing USB network

Identify the USB Ethernet interface from sysfs/NetworkManager. Do not use the
PC's internet-facing Ethernet or Wi-Fi interface. Replace `USB_INTERFACE` below:

```sh
sudo nmcli connection add type ethernet ifname USB_INTERFACE \
  con-name herthing-usb ipv4.method manual ipv4.addresses 172.16.42.1/24 \
  ipv4.never-default yes ipv6.method disabled connection.autoconnect yes
sudo nmcli connection up herthing-usb
```

Reuse an existing correct profile rather than adding duplicates. The device
uses `172.16.42.2`. Check its existing microphone service without starting capture:

```sh
curl --max-time 5 'http://172.16.42.2:8790/cgi-bin/microphone?action=status'
```

The development firmware's microphone supervisor and preview bind mount may
need restoring after a Car Thing reboot; see `microphone-streaming.md`. SSH
requires the device's root credential. Verify its SSH host key against the old
host and inspect `/var/local/herthing` before changing device state. Do not flash
firmware as part of a host migration. If the host firewall blocks the device,
add only the necessary TCP 8787 rule for this USB interface and device address;
do not expose the unauthenticated host control routes to the LAN or internet.

## Development first

`scripts/start-dev.sh` loads the private environment file without sourcing it
as shell code. Start the CPU Whisper and Piper workers using the commands in
their checked-in units, or install those units below and start them manually.
In separate terminals:

```sh
./scripts/start-dev.sh
python -m http.server 8790 --bind 127.0.0.1 --directory device-ui
```

Open `http://127.0.0.1:8790/`. Its default WebSocket target is
`ws://172.16.42.1:8787/ws`. For a desktop-only diagnostic run, set
`HERTHING_HOST=127.0.0.1` and open
`http://127.0.0.1:8790/?ws=ws://127.0.0.1:8787/ws`; the physical microphone still
requires the dedicated USB service. `?debug=1` runs isolated synthetic UI
scenarios without modifying live integrations.

Check `/health`, live calendar/weather, Spotify availability, the persistent
microphone indicator, and an actual voice turn. The browser health endpoint
only establishes that a matching page exists; it does not prove authentication
or successful reasoning. An AMBIENT label alone does not prove a PCM stream is
arriving. Test physical capture and speaker output separately.

## Startup after validation

The units in `installer/systemd` use `~/Code/HerThing`; adjust that path if the
checkout is elsewhere. Install only the components you need into
`~/.config/systemd/user`, back up existing units, and run
`systemctl --user daemon-reload`. Start units manually before enabling them.

- `herthing-host`: application gateway, private environment file, current default
  PipeWire sink unless explicitly overridden.
- `herthing-stt`: resident CPU Whisper with the same `base.en` model as fallback.
- `herthing-tts`: resident Piper worker.
- `herthing-ui`: loopback-only desktop static files; open the browser separately.
- `herthing-muse-browser`: isolated graphical browser and private environment.
- `herthing-librespot`: optional Spotify receiver, requires Librespot and the
  selected LAN address in `HERTHING_WIFI_ADDRESS` (historical name).

The host unit permits writing the speaker profile directory. If notes are
enabled, add the exact vault path to `ReadWritePaths` in a private service
drop-in. Credentials and personal URLs never belong in checked-in units.

## September 24 PC migration checkpoint

Restored the Mac mini's uncommitted source work on top of `201b9c5e`. Host tests
(68) and Alexa adapter tests (4) pass. Recovered the four private files and
browser service settings without committing them. Rebuilt native wake/speaker
helpers and CPU Whisper; recreated Piper's Python environment.

On the Ryzen 5 3600 / RX 580 PC, the development host and Dell desktop UI
connect, and live calendar/weather and Spotify playback metadata load. CPU
Whisper transcribes its public sample; Piper synthesizes and completes playback
to the explicitly selected analog line-out. Audible output still needs owner
confirmation. The built-in UI scenarios render ambient, event, music, listening,
speaking, transcription/thinking, and mic-off states without browser exceptions;
the microphone indicator remains visible. These are synthetic visual checks,
not proof of live microphone capture. Temporary `herthing-*-dev` user units
run the host, UI server/browser, Whisper, Piper, and dedicated Muse browser;
they are not enabled for login. Stop them before starting permanent units on
the same ports. The source USB drive is mounted read-only; Windows is untouched.

Remaining physical validation: Car Thing microphone supervisor/preview after
reboot, an authenticated Muse response, Spotify transport/receiver playback,
and audible speaker output.
The first full-parity milestone is not complete until these work together.

The voice path remains Car Thing PCM → local energy VAD/Sherpa wake and speaker
attention → CPU Whisper → Muse browser (Meta fallback) → local Piper/PipeWire.
Streaming Zipformer is available but disabled by default. There is no Hermes
adapter. A future Hermes integration belongs at the existing assistant adapter
boundary. Any CPU versus RX 580 Vulkan Whisper benchmark must use a separate
build, the same model/audio/decoding options, warm-up plus repeated timings,
and report wall time divided by audio duration. It has not yet been run and
must not change the production CPU dependency during migration.
