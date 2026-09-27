import { expect, test } from 'bun:test'
import { completeSentences, SpokenStream } from './spoken-stream.js'

test('only sentences followed by more text are complete', () => {
  expect(completeSentences('Busy one. Halloween at 9').sentences).toEqual(['Busy one.'])
  expect(completeSentences('Busy one.').sentences).toEqual([])
  expect(completeSentences('Really? Yes! Done. Next').sentences).toEqual(['Really?', 'Yes!', 'Done.'])
})

test('abbreviations and decimals do not split sentences', () => {
  expect(completeSentences('Meet Dr. Smith at 4.30 today. Then').sentences).toEqual(['Meet Dr. Smith at 4.30 today.'])
})

test('streams sentences once, then speaks the remainder at the end', () => {
  const stream = new SpokenStream()
  expect(stream.update('Done —')).toEqual([])
  expect(stream.update('Done — grocery run is at 4. I')).toEqual(['Done — grocery run is at 4.'])
  expect(stream.update('Done — grocery run is at 4. I also')).toEqual([])
  expect(stream.finish('Done — grocery run is at 4. I also set a reminder.')).toEqual(['I also set a reminder.'])
})

test('a rewritten reply falls back to text after the last spoken sentence', () => {
  const stream = new SpokenStream()
  stream.update('First point. Second')
  expect(stream.update('Rewritten first point. Second')).toEqual([])
  expect(stream.finish('Rewritten. First point. Second point.')).toEqual(['Second point.'])
})

test('an unstreamed reply is spoken whole', () => {
  expect(new SpokenStream().finish('Only this.')).toEqual(['Only this.'])
})
