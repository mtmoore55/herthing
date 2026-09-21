import { describe, expect, test } from 'bun:test'
import { isDismissalKeyword, wakeDetectorConfig } from './wake-detector.js'

describe('wake detector configuration', () => {
  test('supports an install-specific model and threshold', () => {
    const config = wakeDetectorConfig({
      HERTHING_KWS_MODEL_DIR: '/models/ziggy',
      HERTHING_KWS_RUNTIME: '/bin/kws',
      HERTHING_KWS_KEYWORDS: '/config/keywords.txt',
      HERTHING_KWS_THRESHOLD: '0.42'
    })
    expect(config.encoder).toBe('/models/ziggy/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx')
    expect(config.runtime).toBe('/bin/kws')
    expect(config.keywords).toBe('/config/keywords.txt')
    expect(config.threshold).toBe(0.42)
  })
})

describe('streaming dismissal keywords', () => {
  test('distinguishes wake and dismissal events', () => {
    expect(isDismissalKeyword('THANK YOU ZIGGY')).toBe(true)
    expect(isDismissalKeyword("Okay, that's it.")).toBe(true)
    expect(isDismissalKeyword('Okay, thanks.')).toBe(true)
    expect(isDismissalKeyword("Alright, that's it. Thanks.")).toBe(true)
    expect(isDismissalKeyword('ZIGGY')).toBe(false)
  })
})
