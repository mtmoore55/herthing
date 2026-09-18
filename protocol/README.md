# HerThing protocol

HerThing's device/host boundary is provider-neutral. The Car Thing never holds
assistant or integration credentials and never depends on Muse-specific types.

The first transport will be a local WebSocket over USB Ethernet:

- JSON text frames for state, events, commands, acknowledgements, and errors.
- Binary frames for utterance audio.
- Protocol identifier `herthing/1` during negotiation.
- Monotonic revisions for host-owned state snapshots.
- Idempotency keys for commands and approvals.
- A full snapshot after every reconnect.

Core microphone states are `off`, `ambient`, and `conversation`. Transient
activity is represented separately as `idle`, `listening`, `thinking`, or
`speaking`; this prevents UI activity from obscuring the privacy state.

Schema files and generated TypeScript/Rust types will be added once the hardware
hello-world establishes the exact event and audio capabilities.
