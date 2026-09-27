import { expect, test } from 'bun:test'
import { MuseBrowserClient } from './muse-browser.js'

function fixture({ accepted = true, ready = true, dispatchFails = false, frames = null, stallMs = 1000 } = {}) {
  let polls = 0
  const session = {
    async connect() {}, close() {},
    async send(method) {
      if (dispatchFails && method === 'Input.dispatchKeyEvent') throw new Error('disconnected')
    },
    async evaluate(expression) {
      if (expression === 'window.__herthingMuse.focusComposer()') return true
      if (expression.startsWith('\n')) return { ready }
      polls++
      if (frames) return frames[Math.min(polls - 1, frames.length - 1)]
      return { composerEmpty: accepted, anchored: accepted && polls > 1, reply: accepted && polls > 1 ? 'Answer' : '', streaming: false }
    }
  }
  const client = new MuseBrowserClient({ timeoutMs: accepted ? 2000 : 200, settleMs: 0, stallMs }, () => session)
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

test('an earlier reply is never returned before this message is anchored', async () => {
  const { client } = fixture({ frames: [
    { composerEmpty: true, anchored: false, reply: "It's twelve-oh-one.", streaming: false },
    { composerEmpty: true, anchored: false, reply: "It's twelve-oh-one.", streaming: false },
    { composerEmpty: true, anchored: true, reply: '', streaming: false },
    { composerEmpty: true, anchored: true, reply: 'Deep violet.', streaming: false }
  ] })
  expect(await client.ask('What is your favorite color?')).toBe('Deep violet.')
})

test('waits for streaming to finish and reports partial text', async () => {
  const partials = []
  const { client } = fixture({ frames: [
    { composerEmpty: true, anchored: true, reply: 'First.', streaming: true },
    { composerEmpty: true, anchored: true, reply: 'First.', streaming: true },
    { composerEmpty: true, anchored: true, reply: 'First. Second.', streaming: true },
    { composerEmpty: true, anchored: true, reply: 'First. Second.', streaming: false }
  ] })
  expect(await client.ask('Hello', { onPartial: (text, { streaming }) => partials.push([text, streaming]) })).toBe('First. Second.')
  expect(partials).toEqual([['First.', true], ['First. Second.', true]])
})

test('a reply left flagged as streaming is returned once its text stops changing', async () => {
  const { client } = fixture({ stallMs: 300, frames: [
    { composerEmpty: true, anchored: true, reply: 'Pad krapow is a stir-fry. Spicy and fast.', streaming: true }
  ] })
  expect(await client.ask('What is pad krapow?')).toBe('Pad krapow is a stir-fry. Spicy and fast.')
})
