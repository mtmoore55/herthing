import { expect, test } from 'bun:test'
import { MuseBrowserClient } from './muse-browser.js'

function fixture({ accepted = true, ready = true, dispatchFails = false } = {}) {
  let polls = 0
  const session = {
    async connect() {}, close() {},
    async send(method) {
      if (dispatchFails && method === 'Input.dispatchKeyEvent') throw new Error('disconnected')
    },
    async evaluate(expression) {
      if (expression === 'window.__herthingMuse.focusComposer()') return true
      if (expression.startsWith('\n')) return { ready, count: 0, texts: [] }
      polls++
      return { composerEmpty: accepted, count: accepted && polls > 1 ? 1 : 0, texts: accepted && polls > 1 ? ['Answer'] : [] }
    }
  }
  const client = new MuseBrowserClient({ timeoutMs: accepted ? 2000 : 200, settleMs: 0 }, () => session)
  client.targets = async () => [{ type: 'page', url: 'https://muse.ai/', webSocketDebuggerUrl: 'fake' }]
  return { client, polls: () => polls }
}

test('submission callback fires once before the answer appears', async () => {
  const f = fixture()
  const seen = []
  expect(await f.client.ask('Hello', { onSubmitted: () => seen.push(f.polls()) })).toBe('Answer')
  expect(seen).toEqual([1])
})

test('no success cue when the composer never accepts submission', async () => {
  const { client } = fixture({ accepted: false })
  let calls = 0
  const error = await client.ask('Hello', { onSubmitted: () => calls++ }).catch(e => e)
  expect(error.message).toContain('Timed out')
  expect(error.code).toBeUndefined()
  expect(calls).toBe(0)
})

test('unavailable composer allows fallback without chiming', async () => {
  const { client } = fixture({ ready: false })
  let calls = 0
  const error = await client.ask('Hello', { onSubmitted: () => calls++ }).catch(e => e)
  expect(error.code).toBe('MUSE_BROWSER_UNAVAILABLE')
  expect(calls).toBe(0)
})

test('ambiguous Enter failure does not cause duplicate fallback or chime', async () => {
  const { client } = fixture({ dispatchFails: true })
  let calls = 0
  const error = await client.ask('Hello', { onSubmitted: () => calls++ }).catch(e => e)
  expect(error.code).toBeUndefined()
  expect(calls).toBe(0)
})

test('audio playback failure does not lose the assistant response', async () => {
  const { client } = fixture()
  expect(await client.ask('Hello', { onSubmitted: () => { throw new Error('test audio unavailable') } })).toBe('Answer')
})
