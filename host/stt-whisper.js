import { resolve } from 'node:path'
import { unlink } from 'node:fs/promises'

const defaultBinary = resolve(import.meta.dir, '../.artifacts/src/whisper.cpp/build/bin/whisper-cli')
const defaultModel = resolve(import.meta.dir, '../.artifacts/src/whisper.cpp/models/ggml-tiny.en.bin')

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
    const result = await run(binary, [
      '--model', model, '--file', wavPath, '--threads', '4',
      '--language', 'en', '--no-gpu', '--no-timestamps', '--no-prints',
      '--best-of', '1', '--beam-size', '1',
      '--prompt', 'HerThing is a voice assistant. Requests may mention Spotify, calendars, weather, meetings, reminders, and music.'
    ])
    return {
      text: result.stdout.trim().replace(/\s+/g, ' '),
      elapsed_ms: Math.round(performance.now() - startedAt)
    }
  } finally {
    await Promise.allSettled([unlink(rawPath), unlink(wavPath)])
  }
}
