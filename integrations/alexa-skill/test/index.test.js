import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { handler } from '../index.js'
import launch from '../fixtures/launch.json' with { type: 'json' }
import turn from '../fixtures/turn.json' with { type: 'json' }
import followup from '../fixtures/followup.json' with { type: 'json' }
import stop from '../fixtures/stop.json' with { type: 'json' }

const originalFetch = global.fetch
process.env.HERTHING_ENDPOINT = 'https://herthing.example/api/alexa/conversation'
process.env.HERTHING_ALEXA_GATEWAY_TOKEN = 'test-secret'
afterEach(() => { global.fetch = originalFetch })

test('launch greets Matt and keeps the microphone session open', async () => {
  const result = await handler(launch)
  assert.equal(result.response.outputSpeech.text, "Hey Matt. What's up?")
  assert.equal(result.response.shouldEndSession, false)
  assert.equal(result.sessionAttributes.conversationId, launch.session.sessionId)
})

test('turn forwards normalized text and Alexa session identity', async () => {
  let body
  global.fetch = async (_url, options) => {
    body = JSON.parse(options.body)
    return new Response(JSON.stringify({ speech: 'It is sunny.', reprompt: 'Anything else?', should_end_session: false }))
  }
  const result = await handler(turn)
  assert.equal(body.text, "what's the weather")
  assert.equal(body.conversation_id, turn.session.sessionId)
  assert.equal(body.device_id, 'test-device')
  assert.equal(result.response.outputSpeech.text, 'It is sunny.')
  assert.equal(result.response.shouldEndSession, false)
})

test('follow-up keeps the same conversation id', async () => {
  let body
  global.fetch = async (_url, options) => {
    body = JSON.parse(options.body)
    return new Response(JSON.stringify({ speech: 'At 3 PM.', should_end_session: false }))
  }
  await handler(followup)
  assert.equal(body.conversation_id, turn.session.sessionId)
})

test('stop closes both Alexa and HerThing sessions', async () => {
  let body
  global.fetch = async (_url, options) => {
    body = JSON.parse(options.body)
    return new Response(JSON.stringify({ ok: true }))
  }
  const result = await handler(stop)
  assert.deepEqual(body, { type: 'end', conversation_id: stop.session.sessionId })
  assert.equal(result.response.shouldEndSession, true)
})
