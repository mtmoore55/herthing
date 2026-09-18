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

The canonical Phase 3 envelope and dashboard schema is
[`herthing-v1.schema.json`](herthing-v1.schema.json). Additive optional fields
may be introduced within `herthing/1`; removing fields, changing their meaning,
or changing privacy-state semantics requires a new protocol version.

The host owns dashboard revisions and sends a complete `dashboard_state` after
every connection. The device owns physical input events. Commands that can
change external state carry an `idempotency_key`; later approval messages will
refer to the command `id` rather than exposing provider-specific concepts.
