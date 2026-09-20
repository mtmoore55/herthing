import { describe, expect, test } from 'bun:test'
import { extractWakeCommand, isSleepIntent } from './conversation-intents.js'

describe('ambient wake phrase', () => {
  test('recognizes Ziggy and extracts an optional request', () => {
    expect(extractWakeCommand('Ziggy')).toEqual({ command: '' })
    expect(extractWakeCommand('Hey, Ziggy!')).toEqual({ command: '' })
    expect(extractWakeCommand("Ziggy, what's my next meeting?")).toEqual({ command: 'whats my next meeting' })
  })
  test('does not wake when Ziggy is merely mentioned later', () => {
    expect(extractWakeCommand('I was talking about Ziggy yesterday')).toBeNull()
    expect(extractWakeCommand('What is my next meeting?')).toBeNull()
  })
})

describe('conversation sleep intent', () => {
  test('recognizes natural closings', () => {
    for (const phrase of ["OK, that's it.", 'Okay, thank you!', 'Thanks Ziggy', "That's all", "We're done", 'Goodnight Ziggy']) expect(isSleepIntent(phrase)).toBe(true)
  })
  test('does not eat a continuing request', () => {
    expect(isSleepIntent('Okay thank you, but what is next?')).toBe(false)
    expect(isSleepIntent('Tell Andy thank you')).toBe(false)
  })
})
