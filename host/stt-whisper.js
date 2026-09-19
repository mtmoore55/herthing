import { resolve } from 'node:path'
import { unlink } from 'node:fs/promises'

const defaultBinary = resolve(import.meta.dir, '../.artifacts/src/whisper.cpp/build/bin/whisper-cli')
const defaultModel = resolve(import.meta.dir, '../.artifacts/src/whisper.cpp/models/ggml-tiny.en.bin')
const defaultServerUrl = 'http://127.0.0.1:8792/inference'
const domainPrompt = 'HerThing is a voice assistant. Requests may mention Spotify, calendars, weather, meetings, reminders, and music.'

export function normalizeTranscript(value) {
  const text = String(value || '').trim().replace(/\s+/g, ' ')
  if (/^\[(blank_audio|no_speech|silence)\]$/i.test(text)) return ''
  return text
}

async function run(command, args) {
  const process = Bun.spawn([command, ...args], { stdout: 'pipe', stderr: 'pipe' })
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited
  ])
  if (exitCode !== 0) throw new Error(stderr.trim() || `${command} exited ${exitCode}`)
  return { stdout, stderr }
}

async function transcribeWithServer(wavPath, options) {
  const form = new FormData()
  form.append('file', Bun.file(wavPath), 'utterance.wav')
  form.append('response_format', 'json')
  form.append('temperature', '0.0')
  form.append('temperature_inc', '0.0')
  form.append('prompt', domainPrompt)
  const response = await fetch(options.serverUrl || process.env.HERTHING_WHISPER_SERVER_URL || defaultServerUrl, {
    method: 'POST', body: form, signal: AbortSignal.timeout(45000)
  })
  if (!response.ok) throw new Error(`whisper server returned ${response.status}`)
  const result = await response.json()
  return normalizeTranscript(result.text)
}

export async function transcribeS32le(pcm, options = {}) {
  const binary = options.binary || process.env.HERTHING_WHISPER_BINARY || defaultBinary
  const model = options.model || process.env.HERTHING_WHISPER_MODEL || defaultModel
  const key = crypto.randomUUID()
  const rawPath = `/dev/shm/herthing-${key}.s32le`
  const wavPath = `/dev/shm/herthing-${key}.wav`
  const startedAt = performance.now()
  try {
    await Bun.write(rawPath, pcm)
    await run('/usr/bin/ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 's32le', '-ar', '16000', '-ac', '1', '-i', rawPath,
      '-af', 'highpass=f=80,lowpass=f=7600,volume=24dB,alimiter=limit=0.9',
      '-c:a', 'pcm_s16le', wavPath
    ])
    let text
    try {
      text = await transcribeWithServer(wavPath, options)
    } catch (error) {
      console.warn('[stt] persistent worker unavailable; using one-shot whisper:', error.message || error)
      const result = await run(binary, [
        '--model', model, '--file', wavPath, '--threads', '4',
        '--language', 'en', '--no-gpu', '--no-timestamps', '--no-prints',
        '--best-of', '1', '--beam-size', '1', '--prompt', domainPrompt
      ])
      text = normalizeTranscript(result.stdout)
    }
    return {
      text,
      elapsed_ms: Math.round(performance.now() - startedAt)
    }
  } finally {
    await Promise.allSettled([unlink(rawPath), unlink(wavPath)])
  }
}
