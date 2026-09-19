import { describe, expect, test } from 'bun:test'
import { normalizeTranscript } from './stt-whisper.js'

describe('Whisper transcript normalization', () => {
  test('removes non-speech markers', () => {
    expect(normalizeTranscript('[BLANK_AUDIO]')).toBe('')
    expect(normalizeTranscript('[no_speech]')).toBe('')
  })

  test('normalizes spoken whitespace', () => {
    expect(normalizeTranscript('  Hello,   Matt.\n')).toBe('Hello, Matt.')
  })
})
