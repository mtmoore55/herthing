import { describe, expect, test } from 'bun:test'
import { normalizeVolume } from './system-volume.js'

describe('system volume adapter', () => {
  test('normalizes device percentages', () => {
    expect(normalizeVolume(54)).toBe(54)
    expect(normalizeVolume(-4)).toBe(0)
    expect(normalizeVolume(130)).toBe(100)
  })

  test('rejects missing values', () => {
    expect(normalizeVolume(undefined)).toBeNull()
    expect(normalizeVolume('not-a-number')).toBeNull()
  })
})
