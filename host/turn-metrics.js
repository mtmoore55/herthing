export class TurnMetrics {
  constructor({ id = crypto.randomUUID(), kind = 'conversation', now = () => performance.now() } = {}) {
    this.id = id
    this.kind = kind
    this.now = now
    this.startedAt = now()
    this.marks = new Map([['capture_started', this.startedAt]])
  }

  mark(name) {
    if (!this.marks.has(name)) this.marks.set(name, this.now())
    return this
  }

  markAfter(name, from, elapsedMs) {
    const start = this.marks.get(from)
    if (!this.marks.has(name) && start != null && Number.isFinite(elapsedMs)) {
      this.marks.set(name, start + elapsedMs)
    }
    return this
  }

  elapsed(from, to) {
    const start = this.marks.get(from)
    const end = this.marks.get(to)
    return start == null || end == null ? null : Math.max(0, Math.round(end - start))
  }

  summary() {
    const offsets = {}
    for (const [name, value] of this.marks) offsets[name] = Math.max(0, Math.round(value - this.startedAt))
    return { id: this.id, kind: this.kind, offsets_ms: offsets }
  }

  log() {
    console.log(`[turn:${this.id}] ${JSON.stringify(this.summary())}`)
  }
}
