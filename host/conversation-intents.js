function spokenWords(value) {
  return String(value || '').toLowerCase().replace(/[’']/g, '').replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function extractWakeCommand(value) {
  const match = spokenWords(value).match(/^(?:(?:hey|hi|okay|ok)\s+)?ziggy(?:\s+(.*))?$/)
  return match ? { command: (match[1] || '').trim() } : null
}

export function isSleepIntent(value) {
  const words = spokenWords(value)
  return /^(?:(?:ok|okay)\s+)?(?:thats\s+(?:it|all)|were\s+done|all\s+done)$/.test(words) ||
    /^(?:(?:ok|okay)\s+)?(?:thank\s+you|thanks)(?:\s+ziggy)?$/.test(words) ||
    /^(?:good\s*night|go\s+to\s+sleep)(?:\s+ziggy)?$/.test(words)
}
