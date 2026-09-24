import { describe, expect, test } from 'bun:test'
import { createAlexaConversationHandler, validateConversationRequest } from './alexa-conversation.js'

const url = 'https://herthing.example/api/alexa/conversation'
const auth = { authorization: 'Bearer test-secret', 'content-type': 'application/json' }

function request(body, headers = auth) {
  return new Request(url, { method: 'POST', headers, body: JSON.stringify(body) })
}

describe('Alexa conversation endpoint', () => {
  test('validates normalized turns', () => {
    expect(validateConversationRequest({ type: 'turn', conversation_id: 'session-1', text: 'hello' })).toBeNull()
    expect(validateConversationRequest({ type: 'turn', conversation_id: '', text: 'hello' })).toContain('conversation_id')
    expect(validateConversationRequest({ type: 'turn', conversation_id: 'session-1', text: '' })).toContain('text')
  })

  test('rejects requests without the gateway secret', async () => {
    const handler = createAlexaConversationHandler({ secret: 'test-secret', resolveTurn() {}, endConversation() {}, logger: console })
    const response = await handler(request({ type: 'turn', conversation_id: 'session-1', text: 'hello' }, { 'content-type': 'application/json' }))
    expect(response.status).toBe(401)
  })

  test('returns speech and preserves the conversation id', async () => {
    let observed
    const handler = createAlexaConversationHandler({
      secret: 'test-secret',
      resolveTurn: async (text, conversationId, metadata) => {
        observed = { text, conversationId, metadata }
        return { text: 'Hello from Ziggy.', provider: 'test' }
      },
      endConversation() {},
      logger: { info() {}, warn() {}, error() {} }
    })
    const response = await handler(request({
      type: 'turn', conversation_id: 'session-1', text: 'hello', locale: 'en-US', device_id: 'device-1'
    }))
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ speech: 'Hello from Ziggy.', reprompt: 'What else?', should_end_session: false })
    expect(observed).toEqual({ text: 'hello', conversationId: 'session-1', metadata: { locale: 'en-US', device_id: 'device-1', user_id: undefined } })
  })

  test('ends a provider conversation without forwarding voice content', async () => {
    let ended
    const handler = createAlexaConversationHandler({
      secret: 'test-secret', resolveTurn() {}, endConversation: (id) => { ended = id },
      logger: { info() {}, warn() {}, error() {} }
    })
    const response = await handler(request({ type: 'end', conversation_id: 'session-1' }))
    expect(response.status).toBe(200)
    expect(ended).toBe('session-1')
  })
})
