import { describe, expect, test } from 'bun:test'
import { parseMetadata } from './media-player.js'

describe('media player adapter', () => {
  test('normalizes MPRIS metadata', () => {
    const raw = ['Playing', 'Everything in Its Right Place', 'Radiohead', 'Kid A', 'https://example.test/art.jpg', '250000000'].join('\u001f')
    expect(parseMetadata(raw, '137.25')).toEqual({
      track: 'Everything in Its Right Place',
      artist: 'Radiohead',
      album: 'Kid A',
      art_url: 'https://example.test/art.jpg',
      duration_ms: 250000,
      position_ms: 137250,
      playing: true
    })
  })

  test('returns null without a track', () => {
    expect(parseMetadata('')).toBeNull()
  })
})
