# Alexa / Sonos gateway feasibility and prototype

Research checked against current official documentation on 2026-09-22.

## Feasibility result

The milestone is feasible: Alexa on a Sonos One can launch a development custom
skill, collect an utterance, call a Lambda adapter, and speak HerThing's text
response on the same device. Alexa—not HerThing—owns wake-word detection, ASR,
voice rendering, and the short open-microphone window.

Verified capabilities:

- A custom skill can remain in development and is available to Alexa devices
  registered to the developer account once testing is enabled. Limited beta
  distribution is also available for up to 90 days. Amazon's separately named
  “private skills” distribution is an Alexa for Business feature, so development
  mode is the right personal prototype mechanism. [Amazon testing](https://developer.amazon.com/en-US/docs/alexa/test/test-your-skill-overview.html), [beta testing](https://developer.amazon.com/en-US/docs/alexa/custom-skills/skills-beta-testing-for-alexa-skills.html)
- Custom skills launch with phrases such as “Alexa, open …”. Amazon generally
  disallows a one-word invocation name unless it is owned brand/IP. The checked-in
  baseline is therefore **ziggy assistant**: “Alexa, open Ziggy Assistant.” Try
  **ziggy** in development if the console accepts it, but do not depend on that
  for certification. [Invocation rules](https://developer.amazon.com/en-US/docs/alexa/custom-skills/choose-the-invocation-name-for-a-custom-skill.html)
- `AMAZON.SearchQuery` is Amazon's open-ended phrase slot. Recognition still
  passes through an interaction model, only one is allowed per intent, and
  carrier phrases are recommended. The model includes a slot-only follow-up and
  carrier phrases; actual recognition quality needs device testing. [Slot reference](https://developer.amazon.com/en-US/docs/alexa/custom-skills/slot-type-reference.html)
- `shouldEndSession: false` with a reprompt reopens the microphone for a few
  seconds. The same Alexa `sessionId` persists across turns. Silence causes a
  reprompt, then Alexa closes the session; a skill cannot hold the microphone
  indefinitely. [Session behavior](https://developer.amazon.com/en-US/docs/alexa/custom-skills/manage-skill-session-and-session-attributes.html)
- A complete response is due in approximately eight seconds, and progressive
  responses do not extend it. The prototype caps HerThing at 6.5 seconds to
  leave Alexa/Lambda/network headroom. [Amazon timing limit](https://developer.amazon.com/en-US/docs/alexa/custom-skills/send-the-user-a-progressive-response.html)
- Alexa can synthesize returned plain text or SSML. Custom audio is possible,
  but must be on public trusted HTTPS and meet format limits. Long-form
  `AudioPlayer` is a poor fit for an open conversational session, so this
  prototype returns text. [Response limits](https://developer.amazon.com/en-US/docs/alexa/custom-skills/request-and-response-json-reference.html), [audio requirements](https://developer.amazon.com/en-US/docs/alexa/custom-skills/use-long-form-audio.html)
- Sonos documents Alexa directly on voice-enabled Sonos and access to Alexa
  skills, subject to regional exceptions. Sonos One should behave as an Alexa
  endpoint, but Sonos does not explicitly guarantee this exact unpublished,
  multi-turn custom-skill flow. [Sonos setup](https://support.sonos.com/en/article/set-up-amazon-alexa-with-a-voice-enabled-sonos-speaker), [Sonos limitations](https://support.sonos.com/en/article/control-sonos-with-amazon-alexa)
- Account linking is optional and unnecessary here. The development skill is
  constrained by Amazon account, Lambda checks the skill ID, and Lambda uses a
  separate bearer secret to authenticate to HerThing.

Assumptions requiring the physical Sonos One:

- The installed firmware/region exposes development custom skills like an Echo
  and sends both response and reprompt through the initiating speaker.
- The slot-only `AMAZON.SearchQuery` reliably captures natural follow-ups.
- A Routine's default “Open Ziggy Assistant” action leaves the session open.
  Amazon documents a default launch task in Routines, but this needs a device
  test. Custom-task Routine integration is a separate public beta and requires
  publication; this prototype does not require it. [Routine skill actions](https://developer.amazon.com/en-US/docs/alexa/custom-skills/integrate-custom-task-with-alexa-routines.html)

## Implemented architecture

```text
Sonos One / Alexa ASR
  -> development custom skill
  -> AWS Lambda (thin Alexa protocol adapter)
  -> HTTPS tunnel + bearer token
  -> POST /api/alexa/conversation
  -> existing HerThing context + Ziggy assistant adapter
  -> text -> Lambda -> Alexa TTS -> initiating Sonos
```

Alexa's stable `sessionId` becomes the HerThing conversation ID. Meta response
IDs are now keyed by conversation so Alexa and Car Thing turns do not overwrite
one another. The opaque Alexa device ID is forwarded for future room mapping;
Alexa does not supply a friendly Sonos room name here. Endpoint logs contain
request IDs, timing, and provider only—not tokens or utterance text.

## Configure and deploy

1. Generate a token (for example, `openssl rand -hex 32`) and put it in the
   private `~/.config/herthing/environment` as
   `HERTHING_ALEXA_GATEWAY_TOKEN=...`. Restart `herthing-host.service`.
2. For a temporary HTTPS test, install `cloudflared` and run:

   ```bash
   cloudflared tunnel --url http://127.0.0.1:8788
   ```

   HerThing starts this loopback-only listener only when the token is configured,
   and it exposes no other project routes. Use the printed URL plus
   `/api/alexa/conversation`; it changes on restart. Use a named tunnel after
   the spike. Quick Tunnels are development-only. [Cloudflare instructions](https://developers.cloudflare.com/tunnel/get-started/)
3. Create an AWS Lambda using Node.js 20 or newer in the appropriate Alexa
   region. In `integrations/alexa-skill`, run `npm run package`, upload the zip,
   set handler `index.handler`, set timeout 8 seconds, and add the variables in
   `.env.example`. Add the Alexa Skills Kit trigger, restricted to the skill ID.
4. In Alexa Developer Console: **Create Skill** > name **Ziggy** > **Custom** >
   provision your own backend. Paste `model/en-US.json` in JSON Editor, save,
   and build. Under Endpoint, paste the Lambda ARN. Copy the skill ID into the
   Lambda `ALEXA_SKILL_ID` variable.
5. On Test, enable **Development**. Try “open ziggy assistant”, then “ask Ziggy
   what's the weather”. In the Alexa app on the same account, go to Skills &
   Games > Your Skills > Dev and enable Ziggy if needed. No account linking.
6. On Sonos say “Alexa, open Ziggy Assistant.” After “Hey Matt. What's up?”,
   ask immediately. End with “thanks Ziggy”, “goodbye”, “stop”, or “cancel”.

## Routine: “connect me to Ziggy”

In Alexa app, open More > Routines > **+**. Name it `Connect to Ziggy`. Choose
**When this happens** > Voice and enter `connect me to Ziggy`. Choose **Add
action** > Skills > Your Skills > Ziggy, then the default **Open Ziggy** action.
Choose the Sonos One under **Hear Alexa from** if offered, save, and test. If the
development skill is absent, use a Custom action `open ziggy assistant` as the
last action. Whether that fallback preserves follow-up listening needs testing.

## Verification and Sonos test plan

Run `bun test host/alexa-conversation.test.js`, then `npm test` from
`integrations/alexa-skill`. Fixtures cover launch, first turn, follow-up, and
stop. A live probe is:

```bash
curl -sS https://YOUR_TUNNEL/api/alexa/conversation \
  -H 'authorization: Bearer YOUR_PRIVATE_TOKEN' \
  -H 'content-type: application/json' \
  -d '{"type":"turn","conversation_id":"manual-test","text":"what time is it"}'
```

On Sonos verify direct launch; same-speaker greeting; a short question; a
pronoun-based follow-up; silence/reprompt; each closing phrase; timeout; Routine
launch; and Alexa app voice history for recognition errors. Record latency.

## Extension points

- Map forwarded opaque `device_id` values to configured rooms.
- Later route Home Assistant/Sonos announcements or generated audio by that map,
  separately from the synchronous Alexa response.
- Calendar, weather, notes, media, personality, and tools stay behind the same
  existing HerThing conversation interface.
- If recognition, Routine continuity, or the eight-second ceiling is too
  limiting, retain this endpoint contract for a local microphone satellite with
  HerThing's existing local wake-word, STT, and TTS components.
