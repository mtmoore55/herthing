import { existsSync } from 'node:fs'

const root = `${import.meta.dir}/..`
const defaultRuntime = `${root}/.artifacts/bin/herthing-kws-stream`
const defaultModel = `${root}/.artifacts/models/sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01`
const dismissalKeywords = new Set([
  'OKAY THANK YOU', 'OKAY THANKS',
  'OKAY THATS IT', 'OKAY THATS IT THANKS', 'OKAY THAT IS IT',
  'THATS IT', 'THATS IT THANKS', 'ALRIGHT THATS IT',
  'ALRIGHT THATS IT THANKS', 'THANK YOU',
  'THANKS ZIGGY', 'THANK YOU ZIGGY', 'GO TO SLEEP',
  'GOOD NIGHT ZIGGY', 'WERE DONE', 'ALL DONE', 'STOP LISTENING',
  'BYE ZIGGY', 'GOODBYE ZIGGY', 'THANKS BYE ZIGGY',
  'THANK YOU BYE ZIGGY', 'ZIGGY THANKS BYE ZIGGY'
])

export function isDismissalKeyword(value) {
  return dismissalKeywords.has(String(value || '').toUpperCase().replace(/[^A-Z0-9\s]/g, '').replace(/\s+/g, ' ').trim())
}

export function wakeDetectorConfig(env = process.env) {
  const model = env.HERTHING_KWS_MODEL_DIR || defaultModel
  return {
    enabled: env.HERTHING_KWS_ENABLED !== '0',
    runtime: env.HERTHING_KWS_RUNTIME || defaultRuntime,
    encoder: env.HERTHING_KWS_ENCODER || `${model}/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx`,
    decoder: env.HERTHING_KWS_DECODER || `${model}/decoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx`,
    joiner: env.HERTHING_KWS_JOINER || `${model}/joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx`,
    tokens: env.HERTHING_KWS_TOKENS || `${model}/tokens.txt`,
    keywords: env.HERTHING_KWS_KEYWORDS || `${import.meta.dir}/keywords/ziggy.txt`,
    threshold: Number(env.HERTHING_KWS_THRESHOLD || 0.25)
  }
}

export class WakeDetector {
  constructor(config = wakeDetectorConfig(), spawn = Bun.spawn) {
    this.config = config
    this.spawn = spawn
    this.process = null
    this.detections = []
    this.ready = false
  }

  available() {
    const config = this.config
    return config.enabled && [config.runtime, config.encoder, config.decoder, config.joiner, config.tokens, config.keywords].every(existsSync)
  }

  start() {
    if (this.process || !this.available()) return this.available()
    const config = this.config
    this.process = this.spawn([
      config.runtime, config.encoder, config.decoder, config.joiner,
      config.tokens, config.keywords, String(config.threshold)
    ], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
    this.readOutput()
    this.readErrors()
    return true
  }

  async readOutput() {
    const reader = this.process.stdout.getReader()
    const decoder = new TextDecoder()
    let pending = ''
    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        pending += decoder.decode(value, { stream: true })
        const lines = pending.split('\n')
        pending = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const event = JSON.parse(line)
            if (event.type === 'ready') this.ready = true
            else if (event.keyword) this.detections.push({ ...event, detected_at: Date.now() })
          } catch (_) {
            console.warn('[wake] invalid detector output:', line)
          }
        }
      }
    } catch (error) {
      console.error('[wake] detector output failed:', error.message || error)
    } finally {
      this.ready = false
      this.process = null
    }
  }

  async readErrors() {
    const text = await new Response(this.process.stderr).text()
    if (text.trim()) console.error('[wake:runtime]', text.trim())
  }

  feed(pcm) {
    if (!this.process && !this.start()) return false
    this.process.stdin.write(pcm)
    return true
  }

  takeDetection() { return this.detections.shift() || null }

  status() {
    return { available: this.available(), running: Boolean(this.process), ready: this.ready, queued: this.detections.length }
  }

  close() {
    this.process?.stdin.end()
    this.process?.kill()
    this.process = null
    this.ready = false
    this.detections.length = 0
  }
}
