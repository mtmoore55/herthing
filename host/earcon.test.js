import { describe, expect, test } from 'bun:test'
import { createDismissalEarcon } from './earcon.js'

describe('dismissal earcon', () => {
  test('creates a short, click-free mono PCM cue', () => {
    const pcm = createDismissalEarcon()
    expect(pcm.byteLength).toBeGreaterThan(8000)
    expect(pcm.byteLength).toBeLessThan(12000)
    expect(pcm.readInt16LE(0)).toBe(0)
    expect(Math.abs(pcm.readInt16LE(pcm.byteLength - 2))).toBeLessThan(100)
  })
})
