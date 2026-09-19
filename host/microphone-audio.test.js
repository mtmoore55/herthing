import { describe, expect, test } from 'bun:test'
import { createPcmEnergyAnalyzer } from './microphone-audio.js'

function pcm32(values) {
  const bytes = new Uint8Array(values.length * 4)
  const view = new DataView(bytes.buffer)
  values.forEach((value, index) => view.setInt32(index * 4, value, true))
  return bytes
}

describe('PCM microphone energy', () => {
  test('maps silence to zero energy', () => {
    const result = createPcmEnergyAnalyzer().analyze(pcm32([0, 0, 0, 0]))
    expect(result.energy).toBe(0)
    expect(result.db).toBe(-120)
  })

  test('maps native Car Thing speech levels into the visual range', () => {
    const speechSample = Math.round(2147483648 * Math.pow(10, -55 / 20))
    const result = createPcmEnergyAnalyzer().analyze(pcm32([speechSample, -speechSample, speechSample, -speechSample]))
    expect(result.db).toBeGreaterThan(-56)
    expect(result.energy).toBeGreaterThan(0.6)
    expect(result.energy).toBeLessThan(0.8)
  })

  test('preserves incomplete samples across network chunks', () => {
    const analyzer = createPcmEnergyAnalyzer()
    expect(analyzer.analyze(new Uint8Array([1, 0])).samples).toBe(0)
    expect(analyzer.analyze(new Uint8Array([0, 0])).samples).toBe(1)
  })
})
