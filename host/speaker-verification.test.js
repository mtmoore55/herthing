import { describe, expect, test } from 'bun:test'
import { averageEmbeddings, cosineSimilarity } from './speaker-verification.js'

describe('speaker verification math', () => {
  test('compares normalized direction rather than volume', () => {
    expect(cosineSimilarity([1, 0], [4, 0])).toBeCloseTo(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBeCloseTo(0)
  })
  test('averages enrollment samples', () => {
    expect(averageEmbeddings([[1, 2], [3, 4]])).toEqual([2, 3])
  })
})
