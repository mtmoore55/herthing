import { fetchWeather, weatherConfig } from './weather.js'
import { calendarConfig, fetchCalendarState } from './calendar.js'
import { executeMediaCommand, readLocalPlayback, readLocalSpotifyReceiver, readNowPlaying, readSpotifyDevices } from './media-player.js'
import { setSystemVolume } from './system-volume.js'
import { createPcmEnergyAnalyzer, createPcmRingBuffer, createSpeechEndpointDetector } from './microphone-audio.js'
import { isDismissalKeyword, wakeDetectorConfig, WakeDetector } from './wake-detector.js'
import { transcribeS32le } from './stt-whisper.js'
import { StreamingRecognizer, streamingRecognizerConfig } from './stt-streaming.js'
import { TurnMetrics } from './turn-metrics.js'
import { askAssistant, assistantConfig, resetAssistantConversation } from './assistant.js'
import { museBrowserHealth } from './muse-browser.js'
import { cancelSpeech, speak, speechConfig } from './speech.js'
import { extractWakeCommand, isSleepIntent } from './conversation-intents.js'
import { playDismissalEarcon, playSubmissionEarcon } from './earcon.js'
import { addEnrollmentSample, extractSpeakerEmbedding, verifySpeaker } from './speaker-verification.js'
import { appendNote, matchNoteIntent, mentionsTasks, noteConfirmation, notesConfig, readOpenTodos } from './notes.js'
import { createAlexaConversationHandler } from './alexa-conversation.js'

const protocol = 'herthing/1'
const bindHost = process.env.HERTHING_HOST || '172.16.42.1'
const port = Number(process.env.HERTHING_PORT || 8787)
const alexaGatewayPort = Number(process.env.HERTHING_ALEXA_GATEWAY_PORT || 8788)
const deviceControlUrl = process.env.HERTHING_DEVICE_CONTROL_URL || 'http://172.16.42.2:8790/cgi-bin/microphone'
const clients = new Set()
let activeMicrophoneStream = null
const conversationTimeoutMs = Number(process.env.HERTHING_CONVERSATION_TIMEOUT_MS || 3 * 60 * 1000)
const followupDelayMs = Number(process.env.HERTHING_FOLLOWUP_DELAY_MS || 300)
const noSpeechCycleMs = Number(process.env.HERTHING_NO_SPEECH_CYCLE_MS || 15000)
const wakeCommandGraceMs = Number(process.env.HERTHING_WAKE_COMMAND_GRACE_MS || 1400)
const wakePreRollMs = Number(process.env.HERTHING_WAKE_PRE_ROLL_MS || 1800)
const wakeCaptureMaxMs = Number(process.env.HERTHING_WAKE_CAPTURE_MAX_MS || 6000)
const conversationCaptureMaxMs = Number(process.env.HERTHING_CONVERSATION_CAPTURE_MAX_MS || 20000)
// Car Thing's microphone noise floor can keep the energy VAD open until the
// rolling ambient buffer reaches its 15 s cap. Permit that complete buffer;
// concurrency and cooldown below prevent it from becoming an STT backlog.
const ambientFallbackMaxMs = Number(process.env.HERTHING_AMBIENT_FALLBACK_MAX_MS || 15000)
const ambientFallbackCooldownMs = Number(process.env.HERTHING_AMBIENT_FALLBACK_COOLDOWN_MS || 8000)
let conversationActive = false
let conversationExpiresAt = 0
let conversationGeneration = 0
let followupTimer = null
let ambientTimer = null
let microphoneEnabled = true
let spotifyPausedForConversation = false
let audioFocusGeneration = 0
let dismissalEarconPending = false
let speakerEnrollmentRequested = null
let notificationTimer = null
let activeCaptureHasSpeech = false
let voiceOutputActive = false
let assistantTurnTail = Promise.resolve()
let voiceTurnTail = Promise.resolve()
let pendingVoiceTurns = 0
let lastAmbientFallbackAt = 0
const wakeDetector = new WakeDetector({
  ...wakeDetectorConfig(),
  // "Ziggy" is short and arrives through distant Car Thing microphones.
  // Favor recall here; the resulting utterance still passes through STT
  // before any assistant action is taken.
  threshold: Number(process.env.HERTHING_WAKE_THRESHOLD || 0.06)
})
const dismissalDetector = new WakeDetector({
  ...wakeDetectorConfig(),
  keywords: `${import.meta.dir}/keywords/dismissals.txt`
})
const streamingRecognizer = new StreamingRecognizer(streamingRecognizerConfig())

let revision = 1
let state = {
  weather: null,
  next_event: null,
  today_events: [],
  now_playing: null,
  spotify_devices: [],
  microphone: { mode: 'ambient', activity: 'idle' },
  conversation: { active: false, expires_at: null },
  transcript: null,
  assistant_response: null,
  notification: null
}

function clockState() {
  return {
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    utc_offset_minutes: -new Date().getTimezoneOffset(),
    epoch_ms: Date.now()
  }
}

function id() {
  return crypto.randomUUID()
}

function envelope(type, fields = {}) {
  return { protocol, type, id: id(), sent_at: new Date().toISOString(), ...fields }
}

function snapshot() {
  return envelope('dashboard_state', { revision, clock: clockState(), ...state })
}

function send(ws, message) {
  ws.send(JSON.stringify(message))
}

function broadcast() {
  const message = JSON.stringify(snapshot())
  for (const ws of clients) ws.send(message)
}

function validMicrophone(value) {
  const modes = ['off', 'ambient', 'conversation']
  const activities = ['idle', 'listening', 'thinking', 'speaking']
  return value && modes.includes(value.mode) && activities.includes(value.activity)
}

function mergeState(patch) {
  if (patch.microphone && !validMicrophone(patch.microphone)) {
    throw new Error('invalid microphone state')
  }

  const allowed = [
    'weather',
    'next_event',
    'today_events',
    'now_playing',
    'spotify_devices',
    'microphone',
    'conversation',
    'transcript',
    'assistant_response',
    'notification'
  ]
  for (const key of allowed) {
    if (Object.hasOwn(patch, key)) state[key] = patch[key]
  }
  revision += 1
  broadcast()
}

function publishConversation() {
  mergeState({
    conversation: {
      active: conversationActive,
      expires_at: conversationActive ? new Date(conversationExpiresAt).toISOString() : null
    }
  })
}

function extendConversation() {
  conversationExpiresAt = Date.now() + conversationTimeoutMs
  publishConversation()
}

function beginConversation() {
  clearTimeout(followupTimer)
  clearTimeout(ambientTimer)
  conversationGeneration += 1
  conversationActive = true
  microphoneEnabled = true
  resetAssistantConversation()
  extendConversation()
  acquireConversationAudioFocus()
}

async function activateConversation(source = 'manual') {
  if (conversationActive) {
    extendConversation()
    return false
  }
  beginConversation()
  mergeState({
    microphone: { mode: 'conversation', activity: 'listening', user_energy: 0 },
    transcript: null,
    assistant_response: null
  })
  try {
    // Ambient capture may already own the device. Stop it first so the
    // replacement stream is classified as conversational.
    await controlMicrophone('off')
    await controlMicrophone('start')
    console.log(`[conversation] activated by ${source}`)
    return true
  } catch (error) {
    console.error(`[conversation] ${source} activation failed:`, error.message || error)
    endConversation()
    throw error
  }
}

function publishNotification(kind, text, durationMs = 1800) {
  clearTimeout(notificationTimer)
  const notification = { id: id(), kind, text, expires_at: new Date(Date.now() + durationMs).toISOString() }
  mergeState({ notification })
  notificationTimer = setTimeout(() => {
    if (state.notification?.id === notification.id) mergeState({ notification: null })
  }, durationMs)
}

function endConversation({ returnToAmbient = true, earcon = false } = {}) {
  clearTimeout(followupTimer)
  clearTimeout(ambientTimer)
  cancelSpeech()
  conversationGeneration += 1
  conversationActive = false
  conversationExpiresAt = 0
  microphoneEnabled = returnToAmbient
  publishConversation()
  mergeState({ microphone: { mode: returnToAmbient ? 'ambient' : 'off', activity: 'idle', user_energy: 0, assistant_energy: 0 } })
  if (earcon) {
    dismissalEarconPending = true
    playDismissalEarcon()
      .catch((error) => console.error('[earcon] dismissal cue failed:', error.message || error))
      .finally(() => {
        dismissalEarconPending = false
        releaseConversationAudioFocus()
        if (returnToAmbient) scheduleAmbient(120)
      })
  } else {
    releaseConversationAudioFocus()
    if (returnToAmbient) scheduleAmbient()
  }
}

async function acquireConversationAudioFocus() {
  const generation = ++audioFocusGeneration
  if (!state.now_playing?.playing || spotifyPausedForConversation) return
  try {
    await executeMediaCommand('spotify.pause')
    if (generation !== audioFocusGeneration || !conversationActive) {
      await executeMediaCommand('spotify.play')
      return
    }
    spotifyPausedForConversation = true
    console.log('[audio-focus] paused Spotify for conversation')
    refreshNowPlaying()
  } catch (error) {
    console.error('[audio-focus] could not pause Spotify:', error.message || error)
  }
}

async function releaseConversationAudioFocus() {
  audioFocusGeneration += 1
  if (!spotifyPausedForConversation) return
  spotifyPausedForConversation = false
  try {
    await executeMediaCommand('spotify.play')
    console.log('[audio-focus] resumed Spotify after conversation')
    refreshNowPlaying()
  } catch (error) {
    console.error('[audio-focus] could not resume Spotify:', error.message || error)
  }
}

function scheduleAmbient(delayMs = 300) {
  clearTimeout(ambientTimer)
  if (!microphoneEnabled || conversationActive || activeMicrophoneStream || dismissalEarconPending || speakerEnrollmentRequested) return
  ambientTimer = setTimeout(async () => {
    if (!microphoneEnabled || conversationActive || activeMicrophoneStream || dismissalEarconPending || speakerEnrollmentRequested) return
    try {
      mergeState({ microphone: { mode: 'ambient', activity: 'idle', user_energy: 0, assistant_energy: 0 } })
      await controlMicrophone('start')
    } catch (error) {
      console.error('[ambient] capture failed:', error.message || error)
      scheduleAmbient(2000)
    }
  }, delayMs)
}

async function initializeAmbientCapture() {
  // A host restart can leave the device-side curl/tinycap process alive with
  // a stale HTTP connection. Reset it before opening the new ambient stream.
  try {
    await controlMicrophone('off')
  } catch (error) {
    console.error('[ambient] startup reset failed:', error.message || error)
  }
  scheduleAmbient(150)
}

function scheduleFollowup() {
  clearTimeout(followupTimer)
  if (!conversationActive || voiceOutputActive || activeMicrophoneStream) return
  const generation = conversationGeneration
  followupTimer = setTimeout(async () => {
    if (!conversationActive || generation !== conversationGeneration) return
    if (Date.now() >= conversationExpiresAt) {
      endConversation()
      return
    }
    try {
      mergeState({ microphone: { mode: 'conversation', activity: 'listening', user_energy: 0 } })
      await controlMicrophone('start')
    } catch (error) {
      console.error('[conversation] follow-up capture failed:', error.message || error)
      endConversation()
    }
  }, followupDelayMs)
}

async function askAssistantInOrder(text, context) {
  const generation = conversationGeneration
  const previous = assistantTurnTail
  let release
  assistantTurnTail = new Promise((resolve) => { release = resolve })
  await previous
  try {
    return await askAssistant(text, context, {
      onSubmitted: async () => {
        if (!conversationActive || generation !== conversationGeneration) return
        await playSubmissionEarcon()
        console.log('[earcon] Muse message submitted')
      }
    })
  } finally {
    release()
  }
}

// Capture is answered from the vault, not the assistant. Routing it through
// the relay would add a round trip to the one kind of turn whose whole value
// is being immediate, and would fail whenever the relay or the network does.
async function resolveVoiceResponse(spokenRequest, rawTranscript, conversationId) {
  if (configuredNotes) {
    // Prefer the untouched transcript. Ambient wake extraction lowercases and
    // strips punctuation, and a saved note should read the way it was spoken.
    const note = matchNoteIntent(rawTranscript) || matchNoteIntent(spokenRequest)
    if (note) {
      const startedAt = Date.now()
      try {
        const written = await appendNote(configuredNotes, note)
        console.log(`[notes] ${note.target}: ${written.line}`)
        return { provider: 'notes', text: noteConfirmation(note), elapsed_ms: Date.now() - startedAt }
      } catch (error) {
        console.error('[notes] capture failed:', error.message || error)
        return { provider: 'notes', text: "I couldn't save that to your notes.", elapsed_ms: Date.now() - startedAt }
      }
    }
  }
  // The list is offered only when the request concerns it, so unrelated turns
  // do not send personal notes to the assistant.
  const context = configuredNotes && mentionsTasks(spokenRequest)
    ? { ...state, todos: await readOpenTodos(configuredNotes).catch(() => []) }
    : state
  if (conversationId) return askAssistant(spokenRequest, context, { conversationId })
  return askAssistantInOrder(spokenRequest, context)
}

const alexaConversationHandler = createAlexaConversationHandler({
  secret: process.env.HERTHING_ALEXA_GATEWAY_TOKEN,
  resolveTurn: (text, conversationId) => resolveVoiceResponse(text, text, `alexa:${conversationId}`),
  endConversation: (conversationId) => resetAssistantConversation(`alexa:${conversationId}`),
  timeoutMs: Number(process.env.HERTHING_ALEXA_TIMEOUT_MS || 6500)
})

function enqueueVoiceTurn(task) {
  pendingVoiceTurns += 1
  const trackedTask = async () => {
    try {
      return await task()
    } finally {
      pendingVoiceTurns -= 1
    }
  }
  const run = voiceTurnTail.then(trackedTask, trackedTask)
  voiceTurnTail = run.catch(() => {})
  return run
}

async function processVoiceTurn({ pcm, ambientStream, wakeEvent, streamingFinal, metrics }) {
  try {
    metrics?.mark('stt_batch_started')
    const batchPromise = streamingRecognizer.config.shadow || !streamingFinal
      ? transcribeS32le(pcm)
      : null
    let streamingTranscription = null
    if (streamingFinal) {
      try {
        streamingTranscription = await streamingFinal
        metrics?.mark('stt_streaming_final')
      } catch (error) {
        console.warn('[stt:streaming] final unavailable; using batch fallback:', error.message || error)
      }
    }
    let batchTranscription = batchPromise ? await batchPromise : null
    if (!streamingRecognizer.config.shadow && !streamingTranscription?.text && !batchTranscription) {
      batchTranscription = await transcribeS32le(pcm)
    }
    if (batchTranscription) metrics?.mark('stt_batch_final')
    const transcription = !streamingRecognizer.config.shadow && streamingTranscription?.text
      ? streamingTranscription
      : batchTranscription || streamingTranscription || { text: '', elapsed_ms: 0 }
    if (streamingTranscription && batchTranscription) {
      console.log(`[stt:shadow] partial=${streamingTranscription.first_partial_ms ?? 'none'} ms; final=${streamingTranscription.elapsed_ms} ms; streaming=${JSON.stringify(streamingTranscription.text)}; batch=${JSON.stringify(batchTranscription.text)}`)
    }
    const wake = ambientStream ? extractWakeCommand(transcription.text) : null
    const kwsCommand = wakeEvent && !wake ? transcription.text.trim().replace(/^\S+[\s,.:;!?-]*/, '') : null
    const spokenRequest = ambientStream ? (wake?.command ?? kwsCommand) : transcription.text
    if (!ambientStream || wake || wakeEvent) console.log(`[stt:${ambientStream ? 'ambient' : 'conversation'}] ${transcription.elapsed_ms} ms: ${transcription.text}`)
    else console.log(`[wake:fallback] rejected locally in ${transcription.elapsed_ms} ms`)

    let speakerAccepted = true
    if (spokenRequest && (!ambientStream || wake || wakeEvent)) {
      metrics?.mark('speaker_started')
      const verification = await verifySpeaker(pcm)
      metrics?.mark('speaker_finished')
      if (verification.enabled) {
        console.log(`[speaker] ${verification.match ? 'accepted' : 'ignored'} ${verification.name}; score=${verification.score?.toFixed(3)} threshold=${verification.threshold}`)
        speakerAccepted = verification.match
        if (!speakerAccepted) {
          publishNotification('voice_ignored', 'OTHER VOICE IGNORED')
          if (ambientStream && conversationActive) endConversation()
        }
      }
    }
    if (speakerAccepted && ambientStream && (wake || wakeEvent)) {
      console.log(`[wake] Ziggy${spokenRequest ? `: ${spokenRequest}` : ''}`)
      if (!wakeEvent) beginConversation()
      mergeState({ transcript: spokenRequest || 'Ziggy', microphone: { mode: 'conversation', activity: spokenRequest ? 'thinking' : 'idle', user_energy: 0 } })
      if (!spokenRequest) {
        if (activeMicrophoneStream && activeCaptureHasSpeech) {
          console.log('[wake] immediate follow-up detected; acknowledgement suppressed')
        } else {
          voiceOutputActive = true
          if (activeMicrophoneStream) {
            await controlMicrophone('stop').catch((error) => console.error('[wake] acknowledgement capture stop failed:', error.message || error))
            await Bun.sleep(80)
          }
          mergeState({ assistant_response: 'Yes?', microphone: { mode: 'conversation', activity: 'speaking', user_energy: 0, assistant_energy: 0.32 } })
          try {
            const acknowledgement = await speak('Yes?')
            console.log(`[wake] acknowledgement first audio ${acknowledgement.first_audio_ms ?? 'unknown'} ms`)
          } finally {
            voiceOutputActive = false
          }
        }
      }
    } else if (speakerAccepted && !ambientStream) {
      mergeState({ transcript: transcription.text || null })
    }
    if (!speakerAccepted) console.log('[speaker] turn discarded locally')
    else if (!ambientStream && transcription.text && isSleepIntent(transcription.text)) {
      console.log(`[conversation] sleep intent: ${transcription.text}`)
      endConversation({ earcon: true })
    } else if (spokenRequest) {
      extendConversation()
      metrics?.mark('assistant_started')
      const assistant = await resolveVoiceResponse(spokenRequest, transcription.text)
      metrics?.mark('assistant_finished')
      if (conversationActive) {
        console.log(`[assistant:${assistant.provider}] ${assistant.elapsed_ms} ms: ${assistant.text}`)
        if (activeMicrophoneStream && activeCaptureHasSpeech) {
          console.log('[barge-in] continuation detected while thinking; suppressing stale spoken response')
          mergeState({ assistant_response: null, microphone: { mode: 'conversation', activity: 'listening', user_energy: 0, assistant_energy: 0 } })
        } else {
          voiceOutputActive = true
          if (activeMicrophoneStream) {
            await controlMicrophone('stop').catch((error) => console.error('[barge-in] pre-speech capture stop failed:', error.message || error))
            await Bun.sleep(80)
          }
          mergeState({ assistant_response: assistant.text, microphone: { mode: 'conversation', activity: 'speaking', user_energy: 0, assistant_energy: 0.45 } })
          try {
            metrics?.mark('tts_started')
            const speech = await speak(assistant.text)
            metrics?.markAfter('tts_first_audio', 'tts_started', speech.first_audio_ms).mark('tts_finished')
            console.log(`[tts] first audio ${speech.first_audio_ms ?? 'unknown'} ms; complete ${speech.elapsed_ms} ms${speech.skipped ? ' (disabled)' : speech.cancelled ? ' (cancelled)' : ''}`)
          } finally {
            voiceOutputActive = false
          }
        }
      } else console.log('[conversation] response discarded after session ended')
    }
  } catch (error) {
    console.error('[voice] turn failed:', error.message || error)
  } finally {
    metrics?.mark('turn_finished').log()
    if (conversationActive && !activeMicrophoneStream && !voiceOutputActive) scheduleFollowup()
    else if (microphoneEnabled && !conversationActive && !activeMicrophoneStream) scheduleAmbient()
  }
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

let refreshingNowPlaying = false
let lastSpotifyDevicesRefresh = 0
function artworkVersion(source) {
  let hash = 2166136261
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(36)
}
async function refreshNowPlaying() {
  if (refreshingNowPlaying) return
  refreshingNowPlaying = true
  try {
    const localReceiver = await readLocalSpotifyReceiver()
    let nowPlaying = state.now_playing || readLocalPlayback(localReceiver)
    try {
      nowPlaying = await readNowPlaying() || readLocalPlayback(localReceiver)
    } catch (error) {
      nowPlaying = readLocalPlayback(localReceiver) || nowPlaying
      console.error('[spotify] playback refresh failed:', error.message || error)
    }
    let spotifyDevices = state.spotify_devices
    if (Date.now() - lastSpotifyDevicesRefresh >= 5 * 60 * 1000) {
      lastSpotifyDevicesRefresh = Date.now()
      try {
        spotifyDevices = await readSpotifyDevices()
      } catch (error) {
        console.error('[spotify] device refresh failed:', error.message || error)
      }
      if (localReceiver && !spotifyDevices.some((device) => device.id === localReceiver.id)) {
        spotifyDevices = [...spotifyDevices, localReceiver]
      }
    }
    if (nowPlaying?.device_id) {
      spotifyDevices = spotifyDevices.map((device) => ({
        ...device,
        active: device.id === nowPlaying.device_id
      }))
    }
    if (nowPlaying?.artwork_source_url) {
      nowPlaying.art_url = `http://${bindHost}:${port}/api/artwork?v=${artworkVersion(nowPlaying.artwork_source_url)}`
    }
    if (!sameValue(nowPlaying, state.now_playing) || !sameValue(spotifyDevices, state.spotify_devices)) {
      mergeState({ now_playing: nowPlaying, spotify_devices: spotifyDevices })
    }
  } catch (error) {
    console.error('[spotify] refresh failed:', error.message || error)
  } finally {
    refreshingNowPlaying = false
  }
}

async function controlMicrophone(action) {
  const response = await fetch(`${deviceControlUrl}?action=${encodeURIComponent(action)}`, {
    signal: AbortSignal.timeout(2500)
  })
  if (!response.ok) throw new Error(`device microphone control returned ${response.status}`)
  const result = await response.json()
  if (!result.ok) throw new Error(result.error || 'device microphone control failed')
  return result
}

const configuredWeather = weatherConfig()
const configuredCalendar = calendarConfig()
const configuredNotes = notesConfig()
async function refreshWeather() {
  if (!configuredWeather) return
  try {
    mergeState({ weather: await fetchWeather(configuredWeather) })
    console.log('[weather] current conditions refreshed')
  } catch (error) {
    console.error('[weather] refresh failed:', error.message || error)
  }
}

async function refreshCalendar() {
  if (!configuredCalendar) return
  try {
    mergeState(await fetchCalendarState(configuredCalendar))
    console.log('[calendar] today agenda refreshed')
  } catch (error) {
    console.error('[calendar] refresh failed:', error.message || error)
  }
}

const server = Bun.serve({
  hostname: bindHost,
  port,
  async fetch(request, server) {
    const url = new URL(request.url)

    if (url.pathname === '/ws' && server.upgrade(request)) return

    if (url.pathname === '/health') {
      const assistant = assistantConfig().provider === 'muse-browser'
        ? { provider: 'muse-browser', ...(await museBrowserHealth()) }
        : { provider: assistantConfig().provider, ok: true }
      return Response.json({
        ok: true, protocol, revision, clients: clients.size, assistant,
        wake_word: wakeDetector.status(), dismissal: dismissalDetector.status(),
        streaming_stt: streamingRecognizer.status()
      })
    }

    if (url.pathname === '/api/artwork' && request.method === 'GET') {
      const source = state.now_playing?.artwork_source_url
      if (!source) return new Response('No artwork', { status: 404 })
      try {
        const upstream = await fetch(source, { signal: AbortSignal.timeout(5000) })
        if (!upstream.ok) return new Response('Artwork unavailable', { status: upstream.status })
        return new Response(upstream.body, { headers: {
          'content-type': upstream.headers.get('content-type') || 'image/jpeg',
          'cache-control': 'private, max-age=86400, immutable',
          'access-control-allow-origin': '*'
        } })
      } catch (error) {
        return new Response(`Artwork unavailable: ${error.message || error}`, { status: 502 })
      }
    }

    if (url.pathname === '/api/state' && request.method === 'GET') {
      return Response.json(snapshot())
    }

    if (url.pathname === '/api/state' && request.method === 'POST') {
      try {
        mergeState(await request.json())
        return Response.json(snapshot())
      } catch (error) {
        return Response.json({ error: String(error.message || error) }, { status: 400 })
      }
    }

    if (url.pathname === '/api/alexa/conversation' && request.method === 'POST') {
      return alexaConversationHandler(request)
    }

    if (url.pathname === '/api/conversation/toggle' && request.method === 'POST') {
      try {
        if (conversationActive) {
          endConversation()
          await controlMicrophone('off')
          console.log('[conversation] ended by keyboard')
          return Response.json({ ok: true, action: 'sleep', conversation: snapshot().conversation })
        }
        await activateConversation('keyboard')
        return Response.json({ ok: true, action: 'wake', conversation: snapshot().conversation })
      } catch (error) {
        return Response.json({ error: error.message || String(error) }, { status: 502 })
      }
    }

    if (url.pathname === '/api/speaker/enroll' && request.method === 'POST') {
      if (speakerEnrollmentRequested) return Response.json({ error: 'speaker enrollment already armed' }, { status: 409 })
      const body = await request.json().catch(() => ({}))
      const enrollment = { name: String(body.name || 'owner').slice(0, 40) }
      speakerEnrollmentRequested = enrollment
      try {
        if (conversationActive) endConversation()
        await controlMicrophone('off')
        mergeState({
          microphone: { mode: 'conversation', activity: 'idle', user_energy: 0, assistant_energy: 0 },
          transcript: null,
          assistant_response: 'VOICE ENROLLMENT · PRESS KNOB TO START'
        })
        return Response.json({ ok: true, armed: true, name: enrollment.name })
      } catch (error) {
        speakerEnrollmentRequested = null
        scheduleAmbient()
        return Response.json({ error: error.message || String(error) }, { status: 502 })
      }
    }

    if (url.pathname === '/api/microphone/stream' && request.method === 'POST') {
      if (!request.body) return Response.json({ error: 'PCM request body required' }, { status: 400 })
      if (activeMicrophoneStream) return Response.json({ error: 'microphone stream already active' }, { status: 409 })
      const streamId = crypto.randomUUID()
      activeMicrophoneStream = streamId
      activeCaptureHasSpeech = false
      const enrollment = speakerEnrollmentRequested
      speakerEnrollmentRequested = null
      const enrollmentStream = Boolean(enrollment)
      const ambientStream = !conversationActive && !enrollmentStream
      const streamingWake = ambientStream && wakeDetector.available()
      const turnMetrics = new TurnMetrics({ kind: enrollmentStream ? 'enrollment' : ambientStream ? 'ambient' : 'conversation' })
      let streamingSession = !ambientStream && !enrollmentStream
        ? streamingRecognizer.begin({
            onPartial: (text) => {
              turnMetrics.mark('stt_first_partial')
              if (!streamingRecognizer.config.shadow) mergeState({ transcript: text })
            }
          })
        : null
      console.log(`[microphone] ${enrollmentStream ? 'speaker enrollment' : ambientStream ? 'ambient' : 'conversation'} stream connected${streamingWake ? ' (streaming wake enabled)' : ''}`)
      const analyzer = createPcmEnergyAnalyzer()
      // The device capture path has a short repeatable startup transient. In
      // ambient mode, ignore more of that edge and require a clearer signal;
      // active conversation keeps the more sensitive endpointing profile.
      let endpointDetector = createSpeechEndpointDetector(enrollmentStream ? {
        startupDelayMs: 500,
        minimumSpeechMs: 250,
        speechDb: -65,
        silenceDb: -58,
        trailingSilenceMs: 1000
      } : ambientStream ? {
        startupDelayMs: 950,
        minimumSpeechMs: 300,
        speechDb: -63,
        silenceDb: -58,
        trailingSilenceMs: 750
      } : {
        startupDelayMs: 850,
        minimumSpeechMs: 350,
        speechDb: -60,
        silenceDb: -63,
        trailingSilenceMs: 850,
        adaptiveNoiseMarginDb: 4,
        adaptiveSilenceMarginDb: 2
      })
      const reader = request.body.getReader()
      let bytes = 0
      let lastBroadcast = 0
      let loudestDb = -120
      let peakEnergy = 0
      let autoStopRequested = false
      let speechDetected = false
      let noSpeechTimeout = false
      let wakeEvent = null
      let dismissalEvent = null
      let capturedBytes = 0
      let followupDeferredToVoiceTurn = false
      const audioChunks = []
      const preRoll = createPcmRingBuffer(16000 * 4 * wakePreRollMs / 1000)
      const ambientUtterance = createPcmRingBuffer(16000 * 4 * 15)
      mergeState({
        microphone: { mode: ambientStream ? 'ambient' : 'conversation', activity: ambientStream ? 'idle' : 'listening', user_energy: 0 },
        transcript: null,
        assistant_response: enrollmentStream ? 'VOICE ENROLLMENT · SPEAK FOR 5–8 SECONDS' : null
      })
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.byteLength
          const measurement = analyzer.analyze(value)
          if (!ambientStream && !enrollmentStream && dismissalDetector.available()) {
            dismissalDetector.feed(value)
            const keywordEvent = dismissalDetector.takeDetection()
            if (keywordEvent && isDismissalKeyword(keywordEvent.keyword)) {
              dismissalEvent = keywordEvent
              autoStopRequested = true
              noSpeechTimeout = true
              console.log(`[dismissal:kws] ${keywordEvent.keyword}`)
              endConversation({ earcon: true })
              controlMicrophone('stop').catch((error) => console.error('[dismissal] capture stop failed:', error.message || error))
            }
          }
          let streamingStartedThisChunk = false
          if (streamingWake && !wakeEvent) {
            preRoll.push(value)
            ambientUtterance.push(value)
            wakeDetector.feed(value)
            const keywordEvent = wakeDetector.takeDetection()
            wakeEvent = ['ZIGGY', 'ZIGY'].includes(keywordEvent?.keyword) ? keywordEvent : null
            if (wakeEvent) {
              const buffered = preRoll.snapshot()
              audioChunks.push(buffered)
              capturedBytes += buffered.byteLength
              streamingSession = streamingRecognizer.begin({
                onPartial: (text) => {
                  turnMetrics.mark('stt_first_partial')
                  if (!streamingRecognizer.config.shadow) mergeState({ transcript: text })
                }
              })
              streamingSession?.write(buffered)
              streamingStartedThisChunk = Boolean(streamingSession)
              speechDetected = true
              endpointDetector = createSpeechEndpointDetector({
                // A keyword spotter commonly finalizes during the natural
                // boundary after "Ziggy". Do not mistake that boundary for
                // the end of "Ziggy, what's the weather?".
                startupDelayMs: wakeCommandGraceMs,
                minimumSpeechMs: 300,
                initialSpeechMs: 300,
                // The native capture noise floor can hover above -65 dBFS.
                // A less strict quiet threshold lets the combined
                // "Ziggy, <request>" turn end naturally instead of padding it
                // to the safety cap with room tone.
                silenceDb: -58,
                trailingSilenceMs: 900
              })
              beginConversation()
              mergeState({
                transcript: 'Ziggy',
                assistant_response: null,
                microphone: { mode: 'conversation', activity: 'listening', user_energy: measurement.energy }
              })
              console.log(`[wake:kws] ${wakeEvent.keyword} detected`)
            }
          } else {
            audioChunks.push(value.slice())
            capturedBytes += value.byteLength
          }
          if (streamingSession && !streamingStartedThisChunk) streamingSession.write(value)
          if ((!ambientStream || wakeEvent || !streamingWake) && capturedBytes > 16000 * 4 * 60) {
            throw new Error('microphone utterance exceeded 60 second safety limit')
          }
          const endpoint = dismissalEvent
            ? { speech_detected: false, endpoint: false }
            : endpointDetector.update(measurement)
          const hadSpeech = speechDetected
          speechDetected ||= endpoint.speech_detected
          if (!hadSpeech && speechDetected) {
            turnMetrics.mark('speech_started')
            console.log(`[vad] speech detected; noise=${endpoint.noise_floor_db?.toFixed(1) ?? 'unknown'} dBFS, speech=${endpoint.speech_threshold_db?.toFixed(1)}, silence=${endpoint.silence_threshold_db?.toFixed(1)}`)
          }
          if (activeMicrophoneStream === streamId && speechDetected) activeCaptureHasSpeech = true
          loudestDb = Math.max(loudestDb, measurement.db)
          peakEnergy = Math.max(peakEnergy, measurement.energy)
          const now = performance.now()
          const enrollmentMinimumReached = !enrollmentStream || bytes >= 16000 * 4 * 5
          if (!autoStopRequested && endpoint.endpoint && enrollmentMinimumReached) {
            autoStopRequested = true
            turnMetrics.mark('speech_ended')
            if (ambientStream && !wakeEvent) {
              const buffered = ambientUtterance.snapshot()
              audioChunks.push(buffered)
              capturedBytes = buffered.byteLength
              console.log(`[wake:fallback] local speech candidate captured (${Math.round(capturedBytes / (16000 * 4) * 1000)} ms)`)
            }
            if (!ambientStream || wakeEvent) mergeState({ microphone: { mode: 'conversation', activity: 'thinking', user_energy: 0 } })
            console.log(`[vad] speech endpoint after ${Math.round(capturedBytes / (16000 * 4) * 1000)} ms captured`)
            controlMicrophone('stop').catch((error) => console.error('[vad] auto-stop failed:', error.message || error))
          }
          // Music or steady machinery can prevent an energy-only detector
          // from ever observing silence. Never let that wedge a successful
          // wake indefinitely: close the first turn at a conversationally
          // useful upper bound and send the captured audio to STT.
          if (wakeEvent && !autoStopRequested && capturedBytes >= 16000 * 4 * wakeCaptureMaxMs / 1000) {
            autoStopRequested = true
            mergeState({ microphone: { mode: 'conversation', activity: 'thinking', user_energy: 0 } })
            console.log(`[vad] wake turn capped after ${Math.round(capturedBytes / (16000 * 4) * 1000)} ms captured`)
            controlMicrophone('stop').catch((error) => console.error('[vad] wake cap stop failed:', error.message || error))
          }
          if (!ambientStream && !enrollmentStream && !autoStopRequested && capturedBytes >= 16000 * 4 * conversationCaptureMaxMs / 1000) {
            autoStopRequested = true
            mergeState({ microphone: { mode: 'conversation', activity: 'thinking', user_energy: 0 } })
            console.log(`[vad] conversation turn capped after ${Math.round(capturedBytes / (16000 * 4) * 1000)} ms captured`)
            controlMicrophone('stop').catch((error) => console.error('[vad] conversation cap stop failed:', error.message || error))
          }
          const captureNoSpeechMs = enrollmentStream ? 60000 : noSpeechCycleMs
          if (!streamingWake && !autoStopRequested && !speechDetected && bytes >= 16000 * 4 * captureNoSpeechMs / 1000) {
            autoStopRequested = true
            noSpeechTimeout = true
            console.log(`[${enrollmentStream ? 'enrollment' : ambientStream ? 'ambient' : 'conversation'}] no speech in ${captureNoSpeechMs} ms; cycling capture`)
            controlMicrophone('stop').catch((error) => console.error('[conversation] capture cycle failed:', error.message || error))
          }
          if ((!ambientStream || wakeEvent) && !autoStopRequested && measurement.samples && now - lastBroadcast >= 75) {
            lastBroadcast = now
            mergeState({ microphone: {
              mode: 'conversation',
              activity: 'listening',
              user_energy: measurement.energy,
              input_db: Number(measurement.db.toFixed(1))
            } })
          }
        }
        // Only the PCM upload is mutually exclusive. Release the stream slot
        // before STT/agent/TTS so an explicit interruption can begin capture.
        if (activeMicrophoneStream === streamId) {
          activeMicrophoneStream = null
          activeCaptureHasSpeech = false
        }
        if (enrollmentStream) {
          if (!speechDetected || capturedBytes < 16000 * 4) {
            console.log('[speaker] enrollment rejected: insufficient speech')
            return Response.json({ ok: false, error: 'Please speak for at least two seconds, then pause.' }, { status: 422 })
          }
          try {
            const embedding = await extractSpeakerEmbedding(Buffer.concat(audioChunks.map((chunk) => Buffer.from(chunk))))
            if (!embedding) throw new Error('speaker embedding runtime is unavailable')
            const saved = await addEnrollmentSample(embedding, enrollment.name)
            console.log(`[speaker] enrollment sample saved for ${saved.name} (${saved.samples}/3)`)
            mergeState({ assistant_response: `VOICE ENROLLMENT · SAMPLE ${Math.min(saved.samples, 3)} OF 3 SAVED` })
            return Response.json({ ok: true, enrolled: saved.samples >= 3, ...saved })
          } catch (error) {
            console.error('[speaker] enrollment failed:', error.message || error)
            return Response.json({ ok: false, error: error.message || String(error) }, { status: 500 })
          }
        }
        // The streaming keyword detector already evaluates ambient audio in
        // real time. Do not also feed every room-noise VAD candidate into the
        // much heavier Whisper queue: that can starve genuine conversation on
        // small hosts. Keep Whisper fallback only when KWS is unavailable.
        const capturedMs = capturedBytes / (16000 * 4) * 1000
        const boundedAmbientFallback = ambientStream && streamingWake && !wakeEvent &&
          capturedMs <= ambientFallbackMaxMs &&
          pendingVoiceTurns === 0 &&
          Date.now() - lastAmbientFallbackAt >= ambientFallbackCooldownMs
        const shouldTranscribe = !ambientStream || Boolean(wakeEvent) || !streamingWake || boundedAmbientFallback
        if (shouldTranscribe && !dismissalEvent && !noSpeechTimeout && speechDetected && capturedBytes >= 16000 * 4 * 0.4) {
          if (boundedAmbientFallback) {
            lastAmbientFallbackAt = Date.now()
            console.log(`[wake:fallback] bounded transcription (${Math.round(capturedMs)} ms)`)
          }
          if (!ambientStream || wakeEvent) mergeState({ microphone: { mode: 'conversation', activity: 'thinking', user_energy: 0 } })
          const pcm = Buffer.concat(audioChunks.map((chunk) => Buffer.from(chunk)))
          turnMetrics.mark('capture_finished').mark('turn_queued')
          const streamingFinal = streamingSession?.finish()
          streamingSession = null
          followupDeferredToVoiceTurn = ambientStream && Boolean(wakeEvent)
          enqueueVoiceTurn(() => processVoiceTurn({ pcm, ambientStream, wakeEvent, streamingFinal, metrics: turnMetrics }))
            .catch((error) => console.error('[voice] queued turn failed:', error.message || error))
        } else {
          streamingSession?.cancel()
          streamingSession = null
        }
        // The device cannot open another upload until this response closes.
        // Acknowledge capture now; transcription, Muse and TTS run in order
        // from the background queue while the next capture can begin.
        return Response.json({ ok: true, queued: true, bytes, loudest_db: Number(loudestDb.toFixed(1)), peak_energy: Number(peakEnergy.toFixed(3)) })
      } finally {
        streamingSession?.cancel()
        if (activeMicrophoneStream === streamId) {
          activeMicrophoneStream = null
          activeCaptureHasSpeech = false
        }
        if (conversationActive && !activeMicrophoneStream && !followupDeferredToVoiceTurn) {
          mergeState({ microphone: { mode: 'conversation', activity: 'idle', user_energy: 0, assistant_energy: 0 } })
          scheduleFollowup()
        } else if (microphoneEnabled) {
          mergeState({ microphone: { mode: 'ambient', activity: 'idle', user_energy: 0, assistant_energy: 0 } })
          scheduleAmbient()
        } else {
          mergeState({ microphone: { mode: 'off', activity: 'idle', user_energy: 0, assistant_energy: 0 } })
        }
      }
    }

    return new Response('Not found', { status: 404 })
  },
  websocket: {
    open(ws) {
      clients.add(ws)
      send(ws, envelope('hello', {
        role: 'host',
        capabilities: ['dashboard_state', 'input_event', 'command_ack']
      }))
      send(ws, snapshot())
    },
    async message(ws, raw) {
      let message
      try {
        message = JSON.parse(String(raw))
      } catch {
        send(ws, envelope('error', { reply_to: null, code: 'invalid_json', message: 'Expected JSON text frame' }))
        return
      }

      if (message.protocol !== protocol) {
        send(ws, envelope('error', { reply_to: message.id || null, code: 'protocol_mismatch', message: `Expected ${protocol}` }))
        return
      }

      if (message.type === 'hello') {
        send(ws, envelope('ack', { reply_to: message.id }))
        return
      }

      if (message.type === 'input_event') {
        console.log(`[input] ${message.input}`, message.value ?? '')
        if (message.input === 'knob_press' && speakerEnrollmentRequested) {
          mergeState({
            microphone: { mode: 'conversation', activity: 'listening', user_energy: 0, assistant_energy: 0 },
            assistant_response: 'VOICE ENROLLMENT · SPEAK NOW'
          })
          controlMicrophone('start').catch((error) => {
            console.error('[speaker] enrollment capture failed:', error.message || error)
            speakerEnrollmentRequested = null
            scheduleAmbient()
          })
          send(ws, envelope('ack', { reply_to: message.id }))
          return
        }
        if (['knob_left', 'knob_right'].includes(message.input)) {
          try {
            setSystemVolume(message.value?.volume)
          } catch (error) {
            console.error('[volume] update failed:', error.message || error)
          }
        }
        if (message.input === 'knob_press' || message.input === 'back') {
          if (message.input === 'knob_press' && conversationActive && state.microphone.activity === 'speaking') {
            const cancelled = cancelSpeech()
            extendConversation()
            mergeState({
              microphone: { mode: 'conversation', activity: 'listening', user_energy: 0, assistant_energy: 0 },
              assistant_response: null
            })
            controlMicrophone('start').catch((error) => {
              console.error('[barge-in] capture failed:', error.message || error)
              endConversation()
            })
            console.log(`[barge-in] knob interruption${cancelled ? '' : ' (no active playback)'}`)
            send(ws, envelope('ack', { reply_to: message.id }))
            return
          }
          if (message.input === 'back') { send(ws, envelope('ack', { reply_to: message.id })); return }
          if (conversationActive) {
            endConversation()
            controlMicrophone('off').catch((error) => console.error('[microphone] conversation exit failed:', error.message || error))
          } else {
            activateConversation('knob').catch(() => {})
          }
        }
        send(ws, envelope('ack', { reply_to: message.id }))
        return
      }

      if (message.type === 'command') {
        console.log(`[command] ${message.command}`, message.arguments || {})
        try {
          if (message.command === 'microphone.toggle') {
            if (microphoneEnabled) {
              endConversation({ returnToAmbient: false })
              await controlMicrophone('off')
            } else {
              microphoneEnabled = true
              mergeState({ microphone: { mode: 'ambient', activity: 'idle', user_energy: 0, assistant_energy: 0 } })
              scheduleAmbient(0)
            }
            send(ws, envelope('ack', { reply_to: message.id }))
            return
          }
          if (['spotify.play', 'spotify.toggle'].includes(message.command) && !state.now_playing) {
            throw new Error('Start something in Spotify first')
          }
          if (!await executeMediaCommand(message.command, {
            playing: Boolean(state.now_playing?.playing),
            device_id: state.now_playing?.device_id || message.arguments?.device_id,
            ...(message.arguments || {})
          })) throw new Error(`${message.command} is not connected yet`)
          send(ws, envelope('ack', { reply_to: message.id }))
          setTimeout(refreshNowPlaying, 500)
        } catch (error) {
          send(ws, envelope('error', {
            reply_to: message.id,
            code: 'integration_unavailable',
            message: error.message || String(error)
          }))
        }
        return
      }

      send(ws, envelope('error', { reply_to: message.id || null, code: 'unsupported_type', message: `Unsupported message type: ${message.type}` }))
    },
    close(ws) {
      clients.delete(ws)
    }
  }
})

const alexaGatewayServer = process.env.HERTHING_ALEXA_GATEWAY_TOKEN
  ? Bun.serve({
      hostname: '127.0.0.1',
      port: alexaGatewayPort,
      fetch(request) {
        const url = new URL(request.url)
        if (url.pathname === '/api/alexa/conversation' && request.method === 'POST') {
          return alexaConversationHandler(request)
        }
        return new Response('Not found', { status: 404 })
      }
    })
  : null

console.log(`HerThing host ${protocol} listening on http://${server.hostname}:${server.port}`)
if (alexaGatewayServer) console.log(`[alexa] private gateway listening on http://${alexaGatewayServer.hostname}:${alexaGatewayServer.port}`)
else console.log('[alexa] disabled; set HERTHING_ALEXA_GATEWAY_TOKEN to enable')
console.log(`[assistant] provider: ${assistantConfig().provider}`)
console.log(`[tts] ${speechConfig().enabled ? 'enabled' : 'disabled'}`)
console.log(`[wake] streaming keyword detector ${wakeDetector.start() ? 'starting' : 'unavailable; using transcription fallback'}`)
console.log(`[dismissal] streaming detector ${dismissalDetector.start() ? 'starting' : 'unavailable; using transcription fallback'}`)
console.log(`[stt:streaming] ${streamingRecognizer.startWorker() ? 'worker starting' : streamingRecognizer.status().enabled ? 'unavailable' : 'disabled'}`)
initializeAmbientCapture()
if (configuredWeather) {
  refreshWeather()
  setInterval(refreshWeather, 10 * 60 * 1000)
} else {
  console.log('[weather] disabled; set HERTHING_LATITUDE and HERTHING_LONGITUDE to enable')
}
if (configuredCalendar) {
  refreshCalendar()
  setInterval(refreshCalendar, 5 * 60 * 1000)
} else {
  console.log('[calendar] disabled; set HERTHING_CALENDAR_ICS_URL to enable')
}
refreshNowPlaying()
// Development-mode Spotify applications have a deliberately small shared
// quota. A one-minute cadence keeps ambient state useful without starving
// explicit play, pause, and transfer commands.
setInterval(refreshNowPlaying, 5 * 60 * 1000)
