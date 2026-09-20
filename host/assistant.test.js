import { describe, expect, test } from 'bun:test'
import { localResponse, museBrowserPrompt, parseMetaResponse, parseMuseJsonl } from './assistant.js'
import { chooseMuseTarget } from './muse-browser.js'

describe('assistant adapters', () => {
  test('answers next-event questions from shared context', () => {
    const start = new Date(Date.now() + 30 * 60000).toISOString()
    expect(localResponse("What's my next meeting?", { next_event: { title: 'Design review', start } }))
      .toContain('Design review starts in 30 minutes')
  })

  test('extracts final text from Muse JSONL', () => {
    const line = JSON.stringify({ payload_type: 'run.terminal.completed', payload: { text: 'Short answer.' } })
    expect(parseMuseJsonl(`diagnostic\n${line}\n`)).toBe('Short answer.')
  })

  test('extracts text from a Meta Responses API result', () => {
    expect(parseMetaResponse({ output: [{ content: [{ type: 'output_text', text: 'Hello from Muse.' }] }] }))
      .toBe('Hello from Muse.')
  })

  test('selects only a Muse page from browser debugging targets', () => {
    const target = chooseMuseTarget([
      { type: 'page', url: 'https://example.com/' },
      { type: 'worker', url: 'https://muse.ai/worker' },
      { type: 'page', url: 'https://muse.ai/chat/ziggy' }
    ])
    expect(target?.url).toBe('https://muse.ai/chat/ziggy')
  })

  test('locks the browser bridge to a configured side chat', () => {
    const targets = [
      { type: 'page', url: 'https://muse.ai/' },
      { type: 'page', url: 'https://muse.ai/thread/herthing' }
    ]
    expect(chooseMuseTarget(targets, 'https://muse.ai/thread/herthing')?.url)
      .toBe('https://muse.ai/thread/herthing')
  })

  test('relays browser turns without replacing the personal agent identity', () => {
    const prompt = museBrowserPrompt('What do you remember?', {})
    expect(prompt).toContain('Respond as Ziggy')
    expect(prompt).toContain('at most two short sentences')
    expect(prompt).not.toContain('You are the assistant behind HerThing')
  })
})
