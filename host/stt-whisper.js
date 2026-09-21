import { resolve } from 'node:path'
import { unlink } from 'node:fs/promises'

const defaultBinary = resolve(import.meta.dir, '../.artifacts/src/whisper.cpp/build/bin/whisper-cli')
const defaultModel = resolve(import.meta.dir, '../.artifacts/src/whisper.cpp/models/ggml-base.en.bin')
const defaultServerUrl = 'http://127.0.0.1:8792/inference'
// Whisper uses this as decoding context, not as text to prepend. Keep it short
// and concrete so product names common in real HerThing conversations retain
// their spelling instead of being replaced by phonetically similar words.
const domainPrompt = 'HerThing voice assistant. Ziggy, Muse, Spotify, Meta, Apple Notes, Obsidian, Google Keep, Google Tasks, calendar, weather, meetings, reminders, music.'

export function normalizeTranscript(value) {
  const text = String(value || '')
    .replace(/\[[^\]]+\]|\([^\)]+\)/g, ' ')
    .trim()
    .replace(/\s+/g, ' ')
  // Whisper emits ambient sound captions as bracketed or parenthesized text.
  // They are observations, not user utterances, and must never reach an agent.
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

export function pcmS32leToWav(pcm, { gainDb = 24 } = {}) {
  const source = pcm instanceof Uint8Array ? pcm : new Uint8Array(pcm)
  const samples = Math.floor(source.byteLength / 4)
  const wav = new Uint8Array(44 + samples * 2)
  const header = new DataView(wav.buffer)
  const ascii = (offset, value) => [...value].forEach((character, index) => header.setUint8(offset + index, character.charCodeAt(0)))
  ascii(0, 'RIFF')
  header.setUint32(4, 36 + samples * 2, true)
  ascii(8, 'WAVE')
  ascii(12, 'fmt ')
  header.setUint32(16, 16, true)
  header.setUint16(20, 1, true)
  header.setUint16(22, 1, true)
  header.setUint32(24, 16000, true)
  header.setUint32(28, 32000, true)
  header.setUint16(32, 2, true)
  header.setUint16(34, 16, true)
  ascii(36, 'data')
  header.setUint32(40, samples * 2, true)

  const input = new DataView(source.buffer, source.byteOffset, samples * 4)
  const gain = 2 ** (gainDb / 6.0206)
  const highpassAlpha = (1 / (2 * Math.PI * 80)) / ((1 / (2 * Math.PI * 80)) + (1 / 16000))
  let previousInput = 0
  let previousOutput = 0
  for (let index = 0; index < samples; index += 1) {
    const currentInput = input.getInt32(index * 4, true) / 65536
    const filtered = highpassAlpha * (previousOutput + currentInput - previousInput)
    previousInput = currentInput
    previousOutput = filtered
    const amplified = filtered * gain
    const limited = 29490 * Math.tanh(amplified / 29490)
    header.setInt16(44 + index * 2, Math.round(limited), true)
  }
  return wav
}

async function transcribeWithServer(wav, options) {
  const form = new FormData()
  form.append('file', new Blob([wav], { type: 'audio/wav' }), 'utterance.wav')
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
  const startedAt = performance.now()
  const wav = pcmS32leToWav(pcm, options)
  let text
  try {
    text = await transcribeWithServer(wav, options)
  } catch (error) {
    console.warn('[stt] persistent worker unavailable; using one-shot whisper:', error.message || error)
    const wavPath = `/dev/shm/herthing-${crypto.randomUUID()}.wav`
    await Bun.write(wavPath, wav)
    try {
      const result = await run(binary, [
        '--model', model, '--file', wavPath, '--threads', '4',
        '--language', 'en', '--no-gpu', '--no-timestamps', '--no-prints',
        '--best-of', '1', '--beam-size', '1', '--prompt', domainPrompt
      ])
      text = normalizeTranscript(result.stdout)
    } finally {
      await unlink(wavPath).catch(() => {})
    }
  }
  return {
    text,
    elapsed_ms: Math.round(performance.now() - startedAt)
  }
}
