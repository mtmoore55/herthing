import { describe, expect, test } from 'bun:test'
import { createPcmEnergyAnalyzer, createPcmRingBuffer, createSpeechEndpointDetector } from './microphone-audio.js'

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

describe('PCM pre-roll buffer', () => {
  test('retains newest audio on a sample boundary across fragmented chunks', () => {
    const ring = createPcmRingBuffer(8)
    ring.push(Buffer.from([1, 2, 3]))
    ring.push(Buffer.from([4, 5, 6, 7, 8, 9]))
    ring.push(Buffer.from([10, 11, 12]))
    expect([...ring.snapshot()]).toEqual([5, 6, 7, 8, 9, 10, 11, 12])
    expect(ring.byteLength).toBe(8)
  })
})

describe('speech endpoint detector', () => {
  test('ends after sustained speech followed by silence', () => {
    const detector = createSpeechEndpointDetector({ sampleRate: 1000, startupDelayMs: 0, minimumSpeechMs: 200, trailingSilenceMs: 1000 })
    expect(detector.update({ db: -55, samples: 200 }).speech_detected).toBe(true)
    expect(detector.update({ db: -70, samples: 900 }).endpoint).toBe(false)
    expect(detector.update({ db: -70, samples: 100 }).endpoint).toBe(true)
  })

  test('does not endpoint ambient silence before speech', () => {
    const detector = createSpeechEndpointDetector({ sampleRate: 1000 })
    expect(detector.update({ db: -70, samples: 5000 }).endpoint).toBe(false)
  })

  test('ignores button and capture startup transients', () => {
    const detector = createSpeechEndpointDetector({ sampleRate: 1000, startupDelayMs: 450, minimumSpeechMs: 200 })
    expect(detector.update({ db: -45, samples: 200 }).speech_detected).toBe(false)
    expect(detector.update({ db: -70, samples: 250 }).speech_detected).toBe(false)
  })

  test('calibrates conversation speech above steady appliance noise', () => {
    const detector = createSpeechEndpointDetector({
      sampleRate: 1000,
      startupDelayMs: 500,
      minimumSpeechMs: 300,
      trailingSilenceMs: 500,
      speechDb: -60,
      silenceDb: -63,
      adaptiveNoiseMarginDb: 4,
      adaptiveSilenceMarginDb: 2
    })
    detector.update({ db: -56, samples: 499 })
    expect(detector.update({ db: -56, samples: 500 }).speech_detected).toBe(false)
    expect(detector.update({ db: -49, samples: 300 }).speech_detected).toBe(true)
    expect(detector.update({ db: -56, samples: 500 }).endpoint).toBe(true)
  })
})
