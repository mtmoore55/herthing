import { describe, expect, test } from 'bun:test'
import { streamingProtocol, streamingRecognizerConfig } from './stt-streaming.js'

describe('streaming recognizer configuration', () => {
  test('is disabled unless explicitly requested', () => {
    expect(streamingRecognizerConfig({}).enabled).toBe(false)
    expect(streamingRecognizerConfig({ HERTHING_STREAMING_STT: 'shadow' }).shadow).toBe(true)
    expect(streamingRecognizerConfig({ HERTHING_STREAMING_STT: '1' }).shadow).toBe(false)
  })

  test('encodes binary sidecar frames', () => {
    const encoded = streamingProtocol.frame(2, new Uint8Array([7, 8]))
    expect([...encoded]).toEqual([2, 2, 0, 0, 0, 7, 8])
  })
})
