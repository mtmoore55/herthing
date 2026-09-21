import { appendFile, mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'

const noteFiles = { todos: 'todos.md', inbox: 'inbox.md' }

export function notesConfig(env = process.env) {
  const dir = env.HERTHING_NOTES_DIR?.trim()
  return dir ? { dir } : null
}

// Capture rules stay deliberately literal. The saved body is the transcript
// itself rather than anything a model extracted, so the only way to be wrong
// is to have misheard, and the worst outcome is an editable line in a file.
const captureRules = [
  { target: 'todos', pattern: /^remind\s+me\s+to\s+(?<body>.+)$/i },
  { target: 'todos', pattern: /^remember\s+to\s+(?<body>.+)$/i },
  { target: 'todos', pattern: /^add\s+(?:a\s+)?(?:new\s+)?(?:to-?\s?do|todo|task)\s*(?:[:,-]|that|to)?\s*(?<body>.+)$/i },
  { target: 'todos', pattern: /^(?:add|put)\s+(?<body>.+?)\s+(?:to|on)\s+(?:my\s+)?(?:to-?\s?do|todo|task)s?(?:\s+list)?$/i },
  { target: 'inbox', pattern: /^(?:take|make|add|write|jot)\s+(?:a\s+)?(?:quick\s+)?note\s*(?:[:,-]|that|about|saying)?\s*(?<body>.+)$/i },
  { target: 'inbox', pattern: /^(?:note|remember)\s+that\s+(?<body>.+)$/i },
  { target: 'inbox', pattern: /^(?:write|jot)\s+(?:this\s+)?down\s*(?:[:,-])?\s*(?<body>.+)$/i }
]

function withoutPreface(value) {
  return String(value || '')
    .replace(/^\s*(?:hey|hi|ok|okay)?[,\s]*ziggy\b[\s,.:!?-]*/i, '')
    .replace(/^\s*(?:(?:can|could|would|will)\s+you\s+)?(?:please\s+)?/i, '')
    .trim()
}

function cleanBody(value) {
  return value.replace(/\s+/g, ' ').replace(/[\s.,!?;:-]+$/, '').trim()
}

export function matchNoteIntent(value) {
  const request = withoutPreface(value)
  for (const rule of captureRules) {
    const body = cleanBody(request.match(rule.pattern)?.groups?.body || '')
    if (body) return { target: rule.target, body }
  }
  return null
}

// Only send the to-do list to the assistant when the request plausibly
// concerns it. Notes should not ride along on every unrelated turn.
export function mentionsTasks(value) {
  return /\b(?:to-?\s?dos?|todos?|task|tasks|remind|reminders?|my list)\b/i.test(String(value || ''))
}

export function noteAnchor(now = new Date()) {
  const pad = (number, width = 2) => String(number).padStart(width, '0')
  return [
    now.getFullYear(), '-', pad(now.getMonth() + 1), '-', pad(now.getDate()),
    'T', pad(now.getHours()), '-', pad(now.getMinutes()), '-', pad(now.getSeconds()),
    '-', pad(now.getMilliseconds(), 3)
  ].join('')
}

export function formatNoteLine(note, now = new Date()) {
  const marker = note.target === 'todos' ? '- [ ] ' : '- '
  return `${marker}${note.body} ^${noteAnchor(now)}`
}

export async function appendNote(config, note, now = new Date()) {
  const path = join(config.dir, noteFiles[note.target])
  const line = formatNoteLine(note, now)
  await mkdir(config.dir, { recursive: true })
  // Append rather than rewrite. A vault synced across devices resolves
  // concurrent appends cleanly; whole-file writes are what create conflicts.
  await appendFile(path, `${line}\n`, 'utf8')
  return { path, line }
}

export function noteConfirmation(note) {
  return note.target === 'todos' ? "Added to your to-dos." : 'Noted.'
}

export async function readOpenTodos(config, limit = 10) {
  let contents
  try {
    contents = await readFile(join(config.dir, noteFiles.todos), 'utf8')
  } catch (error) {
    if (error.code === 'ENOENT') return []
    throw error
  }
  return contents
    .split('\n')
    .filter((line) => /^\s*[-*]\s*\[ \]\s*\S/.test(line))
    .map((line) => line.replace(/^\s*[-*]\s*\[ \]\s*/, '').replace(/\s*\^\S+\s*$/, '').trim())
    .slice(-limit)
}
