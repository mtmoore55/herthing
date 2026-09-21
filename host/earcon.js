const sampleRate = 22050

function tone(samples, offset, durationMs, frequency, amplitude) {
  const count = Math.round(sampleRate * durationMs / 1000)
  const fade = Math.max(1, Math.round(sampleRate * 0.012))
  for (let index = 0; index < count; index += 1) {
    const envelope = Math.min(1, index / fade, (count - index - 1) / fade)
    samples[offset + index] = Math.round(Math.sin(2 * Math.PI * frequency * index / sampleRate) * amplitude * envelope * 32767)
  }
  return count
}

export function createDismissalEarcon() {
  const firstMs = 92
  const gapMs = 18
  const secondMs = 118
  const total = Math.round(sampleRate * (firstMs + gapMs + secondMs) / 1000)
  const samples = new Int16Array(total)
  let offset = tone(samples, 0, firstMs, 659.25, 0.18)
  offset += Math.round(sampleRate * gapMs / 1000)
  tone(samples, offset, secondMs, 440, 0.16)
  return Buffer.from(samples.buffer)
}

export async function playDismissalEarcon() {
  const args = [process.env.HERTHING_AUDIO_PLAYER || 'pw-play']
  const sink = process.env.HERTHING_AUDIO_SINK
  if (sink) args.push('--target', sink)
  args.push('--raw', '--rate', String(sampleRate), '--channels', '1', '--format', 's16', '-')
  const player = Bun.spawn(args, { stdin: 'pipe', stdout: 'ignore', stderr: 'pipe' })
  player.stdin.write(createDismissalEarcon())
  player.stdin.end()
  const [exitCode, error] = await Promise.all([player.exited, new Response(player.stderr).text()])
  if (exitCode !== 0) throw new Error(error.trim() || `earcon player exited ${exitCode}`)
}
