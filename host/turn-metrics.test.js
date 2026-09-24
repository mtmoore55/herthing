import { describe, expect, test } from 'bun:test'
import { TurnMetrics } from './turn-metrics.js'

describe('voice turn metrics', () => {
  test('records stable offsets and phase durations', () => {
    const values = [100, 125, 180]
    const metrics = new TurnMetrics({ id: 'turn-1', kind: 'ambient', now: () => values.shift() })
    metrics.mark('speech_started').mark('speech_ended').mark('speech_ended')
    metrics.markAfter('first_audio', 'speech_started', 12)
    expect(metrics.elapsed('speech_started', 'speech_ended')).toBe(55)
    expect(metrics.elapsed('missing', 'speech_ended')).toBeNull()
    expect(metrics.summary()).toEqual({
      id: 'turn-1', kind: 'ambient', offsets_ms: {
        capture_started: 0,
        speech_started: 25,
        first_audio: 37,
        speech_ended: 80
      }
    })
  })
})
