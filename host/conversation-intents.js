function spokenWords(value) {
  return String(value || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function extractWakeCommand(value) {
  const match = spokenWords(value).match(/^(?:(?:hey|hi|okay|ok)\s+)?ziggy(?:\s+(.*))?$/)
  if (!match) return null
  const command = (match[1] || '').replace(/^(?:ziggy\s*)+/, '').trim()
  return { command }
}

export function isSleepIntent(value) {
  let words = spokenWords(value)
  // People commonly soften a dismissal with conversational filler. Strip
  // only a small, known set of harmless prefaces so requests such as
  // "thank you, but what is next?" still reach the assistant.
  const preface = /^(?:ziggy|sounds good|im good|i am good|ok|okay|alright|all right|well|nah|no|yeah|yep)\s+/
  while (preface.test(words)) words = words.replace(preface, '')
  const closing = '(?:thats\\s+(?:it|all|enough)|were\\s+done|all\\s+done|im\\s+done|end\\s+(?:the\\s+)?conversation|stop\\s+(?:listening|the\\s+conversation)|you\\s+can\\s+(?:stop|go\\s+to\\s+sleep)|never\\s*mind|cancel)'
  const thanks = '(?:(?:thank\\s+you|thanks)(?:\\s+ziggy)?)'
  const farewell = '(?:(?:good\\s*night|goodbye|bye|see\\s+you|talk\\s+to\\s+you\\s+later)(?:\\s+ziggy)?)'
  return new RegExp(`^${closing}(?:\\s+${thanks})?$`).test(words) ||
    new RegExp(`^${thanks}$`).test(words) ||
    new RegExp(`^(?:${farewell}|${thanks})(?:\\s+(?:${farewell}|${thanks}))*$`).test(words) ||
    /^(?:go\s+to\s+sleep)(?:\s+ziggy)?$/.test(words)
}
