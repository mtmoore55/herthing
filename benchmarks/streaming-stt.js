#!/usr/bin/env bun
import { resolve } from 'node:path'
import { StreamingRecognizer, streamingRecognizerConfig } from '../host/stt-streaming.js'

const wavArgument = process.argv.slice(2).find((argument) => !argument.startsWith('--'))
const wavPath = resolve(wavArgument || '.artifacts/models/sherpa-onnx-streaming-zipformer-en-2023-06-21/test_wavs/0.wav')
const realtime = !process.argv.includes('--fast')
const wav = new Uint8Array(await Bun.file(wavPath).arrayBuffer())
const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength)
if (new TextDecoder().decode(wav.slice(0, 4)) !== 'RIFF' || view.getUint16(22, true) !== 1 || view.getUint16(34, true) !== 16) {
  throw new Error('benchmark expects mono 16-bit PCM WAV input')
}
const sampleRate = view.getUint32(24, true)
if (sampleRate !== 16000) throw new Error(`benchmark expects 16 kHz audio, got ${sampleRate}`)
const dataLength = view.getUint32(40, true)
const samples = Math.floor(dataLength / 2)
const pcm = new Uint8Array(samples * 4)
const output = new DataView(pcm.buffer)
for (let index = 0; index < samples; index += 1) {
  output.setInt32(index * 4, view.getInt16(44 + index * 2, true) * 65536, true)
}

const recognizer = new StreamingRecognizer({
  ...streamingRecognizerConfig({ HERTHING_STREAMING_STT: 'shadow' }),
  enabled: true
})
if (!recognizer.startWorker()) throw new Error('streaming recognizer artifacts are unavailable')
const readyDeadline = Date.now() + 30000
while (!recognizer.ready && Date.now() < readyDeadline) await Bun.sleep(20)
if (!recognizer.ready) throw recognizer.failure || new Error('streaming recognizer startup timed out')

const startedAt = performance.now()
const partials = []
const session = recognizer.begin({ onPartial(text) {
  const elapsed = Math.round(performance.now() - startedAt)
  partials.push({ elapsed_ms: elapsed, text })
  console.log(`[partial +${elapsed} ms] ${text}`)
} })
const chunkBytes = 16000 * 4 / 10
for (let offset = 0; offset < pcm.byteLength; offset += chunkBytes) {
  session.write(pcm.slice(offset, offset + chunkBytes))
  if (realtime) await Bun.sleep(100)
}
const final = await session.finish()
const audioMs = Math.round(samples / sampleRate * 1000)
console.log(JSON.stringify({ wav: wavPath, audio_ms: audioMs, realtime, partials: partials.length, ...final }, null, 2))
recognizer.child.kill()
