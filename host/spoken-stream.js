// Splits a growing assistant reply into sentences that are safe to speak
// before the reply has finished. A sentence counts as complete only once text
// follows its terminal punctuation, so the sentence still being written is
// never spoken early.
const boundary = /[.!?…]+["')\]]*\s+(?=["'(\[]?[A-Z0-9])/g
// Periods that end abbreviations, not sentences.
const abbreviation = /(?:^|\s)(?:mr|mrs|ms|dr|st|vs|etc|e\.g|i\.e|a\.m|p\.m|no|approx)\.$/i

export function completeSentences(text) {
  const sentences = []
  let start = 0
  for (const match of text.matchAll(boundary)) {
    const end = match.index + match[0].trimEnd().length
    const sentence = text.slice(start, end).trim()
    if (abbreviation.test(sentence)) continue
    if (sentence) sentences.push(sentence)
    start = match.index + match[0].length
  }
  return { sentences, consumed: start }
}

// Tracks what has been handed to speech so far. `update` returns sentences
// newly completed by a partial reply; `finish` returns whatever remains of the
// final reply. If the page rewrites earlier text, streaming stops and the
// remainder after the last spoken sentence is taken from the final reply.
export class SpokenStream {
  constructor() {
    this.spoken = ''
    this.lastSentence = ''
    this.diverged = false
  }

  update(text) {
    if (this.diverged) return []
    if (!text.startsWith(this.spoken)) {
      this.diverged = true
      return []
    }
    const { sentences, consumed } = completeSentences(text.slice(this.spoken.length))
    if (!sentences.length) return []
    this.spoken = text.slice(0, this.spoken.length + consumed)
    this.lastSentence = sentences.at(-1)
    return sentences
  }

  finish(text) {
    let rest
    if (!this.diverged && text.startsWith(this.spoken)) rest = text.slice(this.spoken.length)
    else if (!this.lastSentence) rest = text
    else {
      const index = text.lastIndexOf(this.lastSentence)
      rest = index === -1 ? '' : text.slice(index + this.lastSentence.length)
    }
    this.spoken = text
    rest = rest.trim()
    return rest ? [rest] : []
  }

  get started() {
    return Boolean(this.lastSentence)
  }
}
