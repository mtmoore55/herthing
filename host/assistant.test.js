import { describe, expect, test } from 'bun:test'
import { localResponse, parseMetaResponse, parseMuseJsonl } from './assistant.js'

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
})
