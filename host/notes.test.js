import { describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  appendNote, formatNoteLine, matchNoteIntent, mentionsTasks,
  noteConfirmation, notesConfig, readOpenTodos
} from './notes.js'

const fixedNow = new Date(2026, 8, 21, 9, 12, 33, 482)

async function vault() {
  return { dir: await mkdtemp(join(tmpdir(), 'herthing-notes-')) }
}

describe('notes configuration', () => {
  test('stays disabled until a vault directory is set', () => {
    expect(notesConfig({})).toBeNull()
    expect(notesConfig({ HERTHING_NOTES_DIR: '  ' })).toBeNull()
    expect(notesConfig({ HERTHING_NOTES_DIR: '/home/mttmr/notes' })).toEqual({ dir: '/home/mttmr/notes' })
  })
})

describe('to-do capture', () => {
  test('recognizes natural task phrasing', () => {
    expect(matchNoteIntent('Remind me to call the landlord about the heater')).toEqual({ target: 'todos', body: 'call the landlord about the heater' })
    expect(matchNoteIntent('remember to move the car')).toEqual({ target: 'todos', body: 'move the car' })
    expect(matchNoteIntent('Add a todo: renew the passport')).toEqual({ target: 'todos', body: 'renew the passport' })
    expect(matchNoteIntent('add milk to my todo list')).toEqual({ target: 'todos', body: 'milk' })
    expect(matchNoteIntent('put the dentist on my to-do list')).toEqual({ target: 'todos', body: 'the dentist' })
  })
  test('tolerates the wake word and polite prefaces', () => {
    expect(matchNoteIntent('Ziggy, remind me to buy coffee')).toEqual({ target: 'todos', body: 'buy coffee' })
    expect(matchNoteIntent('Hey Ziggy, can you remind me to buy coffee?')).toEqual({ target: 'todos', body: 'buy coffee' })
    expect(matchNoteIntent('please remind me to buy coffee')).toEqual({ target: 'todos', body: 'buy coffee' })
  })
})

describe('note capture', () => {
  test('recognizes natural note phrasing', () => {
    expect(matchNoteIntent('Take a note: the shed key is under the pot')).toEqual({ target: 'inbox', body: 'the shed key is under the pot' })
    expect(matchNoteIntent('make a note about the roof leak')).toEqual({ target: 'inbox', body: 'the roof leak' })
    expect(matchNoteIntent('note that the heater is loud again')).toEqual({ target: 'inbox', body: 'the heater is loud again' })
    expect(matchNoteIntent('write down the address, 14 Alder Street')).toEqual({ target: 'inbox', body: 'the address, 14 Alder Street' })
    expect(matchNoteIntent('jot this down: pick a new router')).toEqual({ target: 'inbox', body: 'pick a new router' })
  })
})

describe('capture safety', () => {
  test('falls through to the assistant for questions and conversation', () => {
    for (const phrase of [
      "What's on my to-do list?", 'remind me what time the meeting is', 'do I have any tasks today',
      "what's the weather", 'play something quiet', 'Ziggy', 'how many todos do I have'
    ]) expect(matchNoteIntent(phrase)).toBeNull()
  })
  test('refuses to capture an empty body', () => {
    expect(matchNoteIntent('remind me to')).toBeNull()
    expect(matchNoteIntent('take a note')).toBeNull()
    expect(matchNoteIntent('add a todo')).toBeNull()
  })
  test('keeps the transcript verbatim rather than reinterpreting it', () => {
    expect(matchNoteIntent('Remind me to email Dana about the 3pm slot.')).toEqual({ target: 'todos', body: 'email Dana about the 3pm slot' })
  })
})

describe('task context gating', () => {
  test('only offers the list when the request concerns it', () => {
    expect(mentionsTasks("what's on my to-do list")).toBe(true)
    expect(mentionsTasks('any reminders for today')).toBe(true)
    expect(mentionsTasks('what is the weather')).toBe(false)
    expect(mentionsTasks('play the next track')).toBe(false)
  })
})

describe('vault writes', () => {
  test('formats to-dos as open checkboxes and notes as list items', () => {
    expect(formatNoteLine({ target: 'todos', body: 'buy coffee' }, fixedNow)).toBe('- [ ] buy coffee ^2026-09-21T09-12-33-482')
    expect(formatNoteLine({ target: 'inbox', body: 'the roof leak' }, fixedNow)).toBe('- the roof leak ^2026-09-21T09-12-33-482')
  })
  test('appends without disturbing existing content', async () => {
    const config = await vault()
    await writeFile(join(config.dir, 'todos.md'), '# To-dos\n\n- [ ] existing item\n', 'utf8')
    const written = await appendNote(config, { target: 'todos', body: 'buy coffee' }, fixedNow)
    expect(written.path).toBe(join(config.dir, 'todos.md'))
    expect(await readFile(written.path, 'utf8')).toBe('# To-dos\n\n- [ ] existing item\n- [ ] buy coffee ^2026-09-21T09-12-33-482\n')
  })
  test('creates the vault and file on first capture', async () => {
    const config = { dir: join(await mkdtemp(join(tmpdir(), 'herthing-notes-')), 'nested') }
    const written = await appendNote(config, { target: 'inbox', body: 'first thought' }, fixedNow)
    expect(await readFile(written.path, 'utf8')).toBe('- first thought ^2026-09-21T09-12-33-482\n')
  })
  test('confirms briefly enough to speak', () => {
    expect(noteConfirmation({ target: 'todos' })).toBe('Added to your to-dos.')
    expect(noteConfirmation({ target: 'inbox' })).toBe('Noted.')
  })
})

describe('reading open to-dos', () => {
  test('returns nothing when the vault has no list yet', async () => {
    expect(await readOpenTodos(await vault())).toEqual([])
  })
  test('lists only unchecked items, without anchors', async () => {
    const config = await vault()
    await writeFile(join(config.dir, 'todos.md'), [
      '# To-dos', '', '- [x] already done ^2026-09-20T08-00-00-000',
      '- [ ] call the landlord ^2026-09-21T09-12-33-482', '* [ ] renew the passport', 'not a task at all', ''
    ].join('\n'), 'utf8')
    expect(await readOpenTodos(config)).toEqual(['call the landlord', 'renew the passport'])
  })
  test('keeps only the most recent items when the list is long', async () => {
    const config = await vault()
    const lines = Array.from({ length: 12 }, (_, index) => `- [ ] task ${index + 1}`)
    await writeFile(join(config.dir, 'todos.md'), `${lines.join('\n')}\n`, 'utf8')
    expect(await readOpenTodos(config, 3)).toEqual(['task 10', 'task 11', 'task 12'])
  })
})
