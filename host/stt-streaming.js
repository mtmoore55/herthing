import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { normalizeTranscript } from './stt-whisper.js'

const root = resolve(import.meta.dir, '..')
const defaultBinary = resolve(root, '.artifacts/bin/herthing-streaming-asr')
const defaultModel = resolve(root, '.artifacts/models/sherpa-onnx-streaming-zipformer-en-2023-06-21')

export function streamingRecognizerConfig(env = process.env) {
  const model = env.HERTHING_STREAMING_STT_MODEL_DIR || defaultModel
  return {
    enabled: env.HERTHING_STREAMING_STT === '1' || env.HERTHING_STREAMING_STT === 'shadow',
    shadow: env.HERTHING_STREAMING_STT !== '1',
    binary: env.HERTHING_STREAMING_STT_BINARY || defaultBinary,
    encoder: env.HERTHING_STREAMING_STT_ENCODER || resolve(model, 'encoder-epoch-99-avg-1.int8.onnx'),
    decoder: env.HERTHING_STREAMING_STT_DECODER || resolve(model, 'decoder-epoch-99-avg-1.onnx'),
    joiner: env.HERTHING_STREAMING_STT_JOINER || resolve(model, 'joiner-epoch-99-avg-1.int8.onnx'),
    tokens: env.HERTHING_STREAMING_STT_TOKENS || resolve(model, 'tokens.txt'),
    threads: Math.max(1, Number(env.HERTHING_STREAMING_STT_THREADS || 2))
  }
}

function frame(command, payload = new Uint8Array()) {
  const body = payload instanceof Uint8Array ? payload : new Uint8Array(payload)
  const result = new Uint8Array(5 + body.byteLength)
  result[0] = command
  new DataView(result.buffer).setUint32(1, body.byteLength, true)
  result.set(body, 5)
  return result
}

export class StreamingRecognizer {
  constructor(config = streamingRecognizerConfig(), spawn = Bun.spawn) {
    this.config = config
    this.spawn = spawn
    this.child = null
    this.session = null
    this.ready = false
    this.failure = null
  }

  available() {
    return this.config.enabled && [
      this.config.binary, this.config.encoder, this.config.decoder,
      this.config.joiner, this.config.tokens
    ].every(existsSync)
  }

  status() {
    return {
      enabled: this.config.enabled,
      shadow: this.config.shadow,
      available: this.available(),
      ready: this.ready,
      error: this.failure?.message || null
    }
  }

  startWorker() {
    if (!this.available() || this.child) return false
    this.child = this.spawn([
      this.config.binary, this.config.encoder, this.config.decoder,
      this.config.joiner, this.config.tokens, String(this.config.threads)
    ], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
    this.#readOutput()
    this.#readErrors()
    this.child.exited.then((code) => this.#fail(new Error(`streaming ASR exited ${code}`)))
    return true
  }

  begin({ onPartial } = {}) {
    if (!this.ready || !this.child || this.session) return null
    let resolveFinal
    let rejectFinal
    const final = new Promise((resolve, reject) => { resolveFinal = resolve; rejectFinal = reject })
    this.session = { onPartial, resolveFinal, rejectFinal, firstPartialAt: null, startedAt: performance.now() }
    this.child.stdin.write(frame(1))
    return {
      write: (pcm) => {
        if (this.session) this.child.stdin.write(frame(2, pcm))
      },
      finish: () => {
        if (this.session) this.child.stdin.write(frame(3))
        return final
      },
      cancel: () => {
        if (!this.session) return
        this.child.stdin.write(frame(4))
        this.session.resolveFinal({ text: '', elapsed_ms: 0, first_partial_ms: null, cancelled: true })
        this.session = null
      },
      final
    }
  }

  async #readOutput() {
    const reader = this.child.stdout.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        pending += decoder.decode(value, { stream: true })
        const lines = pending.split('\n')
        pending = lines.pop()
        for (const line of lines) {
          if (!line.trim()) continue
          const event = JSON.parse(line)
          if (event.type === 'ready') this.ready = true
          else if (event.type === 'partial' && this.session) {
            const text = normalizeTranscript(event.text)
            if (text) {
              this.session.firstPartialAt ??= performance.now()
              this.session.onPartial?.(text)
            }
          } else if (event.type === 'final' && this.session) {
            const session = this.session
            this.session = null
            session.resolveFinal({
              text: normalizeTranscript(event.text),
              elapsed_ms: Math.round(performance.now() - session.startedAt),
              first_partial_ms: session.firstPartialAt == null ? null : Math.round(session.firstPartialAt - session.startedAt)
            })
          }
        }
      }
    } catch (error) {
      this.#fail(error)
    }
  }

  async #readErrors() {
    const text = await new Response(this.child.stderr).text()
    if (text.trim()) console.error('[stt:streaming:runtime]', text.trim())
  }

  #fail(error) {
    this.failure = error
    this.ready = false
    this.child = null
    if (this.session) this.session.rejectFinal(error)
    this.session = null
  }
}

export const streamingProtocol = { frame }
