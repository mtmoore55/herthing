import { describe, expect, test } from 'bun:test'
import { normalizeTranscript, pcmS32leToWav } from './stt-whisper.js'

describe('Whisper transcript normalization', () => {
  test('removes non-speech markers', () => {
    expect(normalizeTranscript('[BLANK_AUDIO]')).toBe('')
    expect(normalizeTranscript('[no_speech]')).toBe('')
    expect(normalizeTranscript('[typing]')).toBe('')
    expect(normalizeTranscript('[applause]')).toBe('')
    expect(normalizeTranscript('[laughs]')).toBe('')
    expect(normalizeTranscript('(music)')).toBe('')
  })

  test('normalizes spoken whitespace', () => {
    expect(normalizeTranscript('  Hello,   Matt.\n')).toBe('Hello, Matt.')
  })

  test('removes steady DC while retaining changing speech samples', () => {
    const pcm = new Uint8Array(400 * 4)
    const input = new DataView(pcm.buffer)
    for (let index = 0; index < 400; index += 1) input.setInt32(index * 4, 65536, true)
    const wav = pcmS32leToWav(pcm, { gainDb: 0 })
    const output = new DataView(wav.buffer)
    expect(Math.abs(output.getInt16(44, true))).toBeGreaterThan(0)
    expect(Math.abs(output.getInt16(44 + 399 * 2, true))).toBeLessThan(1)
  })
})

describe('PCM conversion', () => {
  test('creates a valid mono 16 kHz WAV entirely in memory', () => {
    const pcm = new Uint8Array(8)
    const input = new DataView(pcm.buffer)
    input.setInt32(0, 65536, true)
    input.setInt32(4, -65536, true)
    const wav = pcmS32leToWav(pcm, { gainDb: 0 })
    const view = new DataView(wav.buffer)
    expect(new TextDecoder().decode(wav.slice(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(wav.slice(8, 12))).toBe('WAVE')
    expect(view.getUint32(24, true)).toBe(16000)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(4)
    expect(view.getInt16(44, true)).toBeGreaterThan(0)
    expect(view.getInt16(46, true)).toBeLessThan(0)
  })
})
