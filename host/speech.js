const python = process.env.HERTHING_TTS_PYTHON || `${import.meta.dir}/../.artifacts/tts-venv/bin/python`
const model = process.env.HERTHING_TTS_MODEL || `${import.meta.dir}/../.artifacts/tts/en_US-lessac-medium.onnx`
let activeSpeech = null

export function speechConfig() {
  return {
    enabled: process.env.HERTHING_TTS_ENABLED !== '0',
    python,
    model,
    player: process.env.HERTHING_AUDIO_PLAYER || 'pw-play',
    sink: process.env.HERTHING_AUDIO_SINK || null,
    workerUrl: process.env.HERTHING_TTS_WORKER_URL || 'http://127.0.0.1:8791/synthesize'
  }
}

function playerArguments(config) {
  const args = [config.player]
  if (config.sink) args.push('--target', config.sink)
  args.push('--raw', '--rate', '22050', '--channels', '1', '--format', 's16', '-')
  return args
}

export function cancelSpeech() {
  if (!activeSpeech) return false
  activeSpeech.cancelled = true
  activeSpeech.controller.abort()
  activeSpeech.player?.kill()
  activeSpeech.synthesizer?.kill()
  return true
}

async function speakWithWorker(text, config, hooks, started, speech) {
  const response = await fetch(config.workerUrl, {
    method: 'POST', body: text,
    signal: AbortSignal.any([speech.controller.signal, AbortSignal.timeout(45000)])
  })
  if (!response.ok || !response.body) throw new Error(`TTS worker returned ${response.status}`)
  const player = Bun.spawn(playerArguments(config), { stdin: 'pipe', stdout: 'ignore', stderr: 'pipe' })
  speech.player = player
  const reader = response.body.getReader()
  let firstAudioMs = null
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (firstAudioMs === null) {
        firstAudioMs = Math.round(performance.now() - started)
        hooks.onStart?.()
      }
      player.stdin.write(value)
    }
    player.stdin.end()
  } catch (error) {
    if (!speech.cancelled) throw error
  }
  const [exitCode, error] = await Promise.all([player.exited, new Response(player.stderr).text()])
  if (speech.cancelled) {
    return { skipped: false, cancelled: true, first_audio_ms: firstAudioMs, elapsed_ms: Math.round(performance.now() - started) }
  }
  if (exitCode !== 0) throw new Error(error.trim() || `audio player exited ${exitCode}`)
  return { skipped: false, first_audio_ms: firstAudioMs, elapsed_ms: Math.round(performance.now() - started) }
}

export async function speak(text, hooks = {}) {
  const config = speechConfig()
  if (!config.enabled) return { skipped: true, elapsed_ms: 0 }
  const started = performance.now()
  cancelSpeech()
  const speech = { controller: new AbortController(), player: null, synthesizer: null, cancelled: false }
  activeSpeech = speech
  try {
    try {
      return await speakWithWorker(text, config, hooks, started, speech)
    } catch (error) {
      if (speech.cancelled) {
        return { skipped: false, cancelled: true, first_audio_ms: null, elapsed_ms: Math.round(performance.now() - started) }
      }
      console.warn('[tts] persistent worker unavailable; using one-shot Piper:', error.message || error)
    }

    const synthesizer = Bun.spawn([
      config.python, '-m', 'piper', '--model', config.model, '--output-raw'
    ], { stdin: 'pipe', stdout: 'pipe', stderr: 'pipe' })
    const player = Bun.spawn(playerArguments(config), { stdin: synthesizer.stdout, stdout: 'ignore', stderr: 'pipe' })
    speech.synthesizer = synthesizer
    speech.player = player
    synthesizer.stdin.write(`${text}\n`)
    synthesizer.stdin.end()
    hooks.onStart?.()
    const [synthExit, playerExit, synthError, playerError] = await Promise.all([
      synthesizer.exited,
      player.exited,
      new Response(synthesizer.stderr).text(),
      new Response(player.stderr).text()
    ])
    if (speech.cancelled) return { skipped: false, cancelled: true, first_audio_ms: null, elapsed_ms: Math.round(performance.now() - started) }
    if (synthExit !== 0) throw new Error(synthError.trim() || `Piper exited ${synthExit}`)
    if (playerExit !== 0) throw new Error(playerError.trim() || `audio player exited ${playerExit}`)
    return { skipped: false, first_audio_ms: null, elapsed_ms: Math.round(performance.now() - started) }
  } finally {
    if (activeSpeech === speech) activeSpeech = null
  }
}
