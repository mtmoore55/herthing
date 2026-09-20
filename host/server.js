import { fetchWeather, weatherConfig } from './weather.js'
import { calendarConfig, fetchCalendarState } from './calendar.js'
import { executeMediaCommand, readNowPlaying } from './media-player.js'
import { setSystemVolume } from './system-volume.js'
import { createPcmEnergyAnalyzer, createSpeechEndpointDetector } from './microphone-audio.js'
import { transcribeS32le } from './stt-whisper.js'
import { askAssistant, assistantConfig, resetAssistantConversation } from './assistant.js'
import { museBrowserHealth } from './muse-browser.js'
import { cancelSpeech, speak, speechConfig } from './speech.js'
import { extractWakeCommand, isSleepIntent } from './conversation-intents.js'

const protocol = 'herthing/1'
const bindHost = process.env.HERTHING_HOST || '172.16.42.1'
const port = Number(process.env.HERTHING_PORT || 8787)
const deviceControlUrl = process.env.HERTHING_DEVICE_CONTROL_URL || 'http://172.16.42.2:8790/cgi-bin/microphone'
const clients = new Set()
let activeMicrophoneStream = null
const conversationTimeoutMs = Number(process.env.HERTHING_CONVERSATION_TIMEOUT_MS || 3 * 60 * 1000)
const followupDelayMs = Number(process.env.HERTHING_FOLLOWUP_DELAY_MS || 300)
const noSpeechCycleMs = Number(process.env.HERTHING_NO_SPEECH_CYCLE_MS || 15000)
let conversationActive = false
let conversationExpiresAt = 0
let conversationGeneration = 0
let followupTimer = null
let ambientTimer = null
let microphoneEnabled = true

let revision = 1
let state = {
  weather: null,
  next_event: null,
  today_events: [],
  now_playing: null,
  microphone: { mode: 'ambient', activity: 'idle' },
  conversation: { active: false, expires_at: null },
  transcript: null,
  assistant_response: null
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
    'microphone',
    'conversation',
    'transcript',
    'assistant_response'
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
}

function endConversation({ returnToAmbient = true } = {}) {
  clearTimeout(followupTimer)
  clearTimeout(ambientTimer)
  cancelSpeech()
  conversationGeneration += 1
  conversationActive = false
  conversationExpiresAt = 0
  microphoneEnabled = returnToAmbient
  publishConversation()
  mergeState({ microphone: { mode: returnToAmbient ? 'ambient' : 'off', activity: 'idle', user_energy: 0, assistant_energy: 0 } })
  if (returnToAmbient) scheduleAmbient()
}

function scheduleAmbient(delayMs = 300) {
  clearTimeout(ambientTimer)
  if (!microphoneEnabled || conversationActive || activeMicrophoneStream) return
  ambientTimer = setTimeout(async () => {
    if (!microphoneEnabled || conversationActive || activeMicrophoneStream) return
    try {
      mergeState({ microphone: { mode: 'ambient', activity: 'idle', user_energy: 0, assistant_energy: 0 } })
      await controlMicrophone('start')
    } catch (error) {
      console.error('[ambient] capture failed:', error.message || error)
      scheduleAmbient(2000)
    }
  }, delayMs)
}

function scheduleFollowup() {
  clearTimeout(followupTimer)
  if (!conversationActive) return
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

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function refreshNowPlaying() {
  const nowPlaying = readNowPlaying()
  if (!sameValue(nowPlaying, state.now_playing)) mergeState({ now_playing: nowPlaying })
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
      return Response.json({ ok: true, protocol, revision, clients: clients.size, assistant })
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

    if (url.pathname === '/api/microphone/stream' && request.method === 'POST') {
      if (!request.body) return Response.json({ error: 'PCM request body required' }, { status: 400 })
      if (activeMicrophoneStream) return Response.json({ error: 'microphone stream already active' }, { status: 409 })
      const streamId = crypto.randomUUID()
      activeMicrophoneStream = streamId
      const ambientStream = !conversationActive
      const analyzer = createPcmEnergyAnalyzer()
      const endpointDetector = createSpeechEndpointDetector()
      const reader = request.body.getReader()
      let bytes = 0
      let lastBroadcast = 0
      let loudestDb = -120
      let peakEnergy = 0
      let autoStopRequested = false
      let speechDetected = false
      let noSpeechTimeout = false
      const audioChunks = []
      mergeState({
        microphone: { mode: ambientStream ? 'ambient' : 'conversation', activity: ambientStream ? 'idle' : 'listening', user_energy: 0 },
        transcript: null,
        assistant_response: null
      })
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          bytes += value.byteLength
          if (bytes > 16000 * 4 * 60) throw new Error('microphone stream exceeded 60 second safety limit')
          audioChunks.push(value.slice())
          const measurement = analyzer.analyze(value)
          const endpoint = endpointDetector.update(measurement)
          speechDetected ||= endpoint.speech_detected
          loudestDb = Math.max(loudestDb, measurement.db)
          peakEnergy = Math.max(peakEnergy, measurement.energy)
          const now = performance.now()
          if (!autoStopRequested && endpoint.endpoint) {
            autoStopRequested = true
            if (!ambientStream) mergeState({ microphone: { mode: 'conversation', activity: 'thinking', user_energy: 0 } })
            console.log(`[vad] speech endpoint after ${Math.round(bytes / (16000 * 4) * 1000)} ms`)
            controlMicrophone('stop').catch((error) => console.error('[vad] auto-stop failed:', error.message || error))
          }
          if (!autoStopRequested && !speechDetected && bytes >= 16000 * 4 * noSpeechCycleMs / 1000) {
            autoStopRequested = true
            noSpeechTimeout = true
            console.log(`[${ambientStream ? 'ambient' : 'conversation'}] no speech in ${noSpeechCycleMs} ms; cycling capture`)
            controlMicrophone('stop').catch((error) => console.error('[conversation] capture cycle failed:', error.message || error))
          }
          if (!ambientStream && !autoStopRequested && measurement.samples && now - lastBroadcast >= 75) {
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
        if (activeMicrophoneStream === streamId) activeMicrophoneStream = null
        let transcription = null
        let assistant = null
        if (!noSpeechTimeout && speechDetected && bytes >= 16000 * 4 * 0.4) {
          if (!ambientStream) mergeState({ microphone: { mode: 'conversation', activity: 'thinking', user_energy: 0 } })
          try {
            transcription = await transcribeS32le(Buffer.concat(audioChunks.map((chunk) => Buffer.from(chunk))))
            console.log(`[stt:${ambientStream ? 'ambient' : 'conversation'}] ${transcription.elapsed_ms} ms: ${transcription.text}`)
            const wake = ambientStream ? extractWakeCommand(transcription.text) : null
            const spokenRequest = ambientStream ? wake?.command : transcription.text
            if (ambientStream && wake) {
              console.log(`[wake] Ziggy${spokenRequest ? `: ${spokenRequest}` : ''}`)
              beginConversation()
              mergeState({ transcript: spokenRequest || 'Ziggy', microphone: { mode: 'conversation', activity: spokenRequest ? 'thinking' : 'idle', user_energy: 0 } })
            } else if (!ambientStream) {
              mergeState({ transcript: transcription.text || null })
            }
            if (!ambientStream && transcription.text && isSleepIntent(transcription.text)) {
              console.log(`[conversation] sleep intent: ${transcription.text}`)
              endConversation()
            } else if (spokenRequest) {
              extendConversation()
              assistant = await askAssistant(spokenRequest, state)
              if (conversationActive) {
                mergeState({
                  assistant_response: assistant.text,
                  microphone: { mode: 'conversation', activity: 'speaking', user_energy: 0, assistant_energy: 0.45 }
                })
                console.log(`[assistant:${assistant.provider}] ${assistant.elapsed_ms} ms: ${assistant.text}`)
                const speech = await speak(assistant.text)
                console.log(`[tts] first audio ${speech.first_audio_ms ?? 'unknown'} ms; complete ${speech.elapsed_ms} ms${speech.skipped ? ' (disabled)' : speech.cancelled ? ' (cancelled)' : ''}`)
              } else {
                console.log('[conversation] response discarded after session ended')
              }
            }
          } catch (error) {
            console.error('[voice] turn failed:', error.message || error)
          }
        }
        return Response.json({ ok: true, bytes, loudest_db: Number(loudestDb.toFixed(1)), peak_energy: Number(peakEnergy.toFixed(3)), transcription, assistant })
      } finally {
        if (activeMicrophoneStream === streamId) activeMicrophoneStream = null
        if (conversationActive && !activeMicrophoneStream) {
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
    message(ws, raw) {
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

      if (message.type === 'input_event') {
        console.log(`[input] ${message.input}`, message.value ?? '')
        if (['knob_left', 'knob_right'].includes(message.input)) {
          try {
            setSystemVolume(message.value?.volume)
          } catch (error) {
            console.error('[volume] update failed:', error.message || error)
          }
        }
        if (message.input === 'knob_press' || message.input === 'preset_4') {
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
          if (message.input === 'preset_4') {
            if (microphoneEnabled) {
              endConversation({ returnToAmbient: false })
              controlMicrophone('off').catch((error) => console.error('[microphone] off failed:', error.message || error))
            } else {
              microphoneEnabled = true
              mergeState({ microphone: { mode: 'ambient', activity: 'idle', user_energy: 0, assistant_energy: 0 } })
              scheduleAmbient(0)
            }
            send(ws, envelope('ack', { reply_to: message.id }))
            return
          }
          if (conversationActive) {
            endConversation()
            controlMicrophone('off').catch((error) => console.error('[microphone] conversation exit failed:', error.message || error))
          } else {
            beginConversation()
            mergeState({
              microphone: { mode: 'conversation', activity: 'listening', user_energy: 0 },
              transcript: null,
              assistant_response: null
            })
            // Ambient capture may already own the device. Stop it first so
            // the replacement stream is classified as conversational.
            controlMicrophone('off').then(() => controlMicrophone('start')).catch((error) => {
              console.error('[microphone] control failed:', error.message || error)
              endConversation()
            })
          }
        }
        send(ws, envelope('ack', { reply_to: message.id }))
        return
      }

      if (message.type === 'command') {
        console.log(`[command] ${message.command}`, message.arguments || {})
        try {
          if (!executeMediaCommand(message.command)) throw new Error(`${message.command} is not connected yet`)
          send(ws, envelope('ack', { reply_to: message.id }))
          setTimeout(refreshNowPlaying, 150)
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

console.log(`HerThing host ${protocol} listening on http://${server.hostname}:${server.port}`)
console.log(`[assistant] provider: ${assistantConfig().provider}`)
console.log(`[tts] ${speechConfig().enabled ? 'enabled' : 'disabled'}`)
scheduleAmbient(1000)
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
setInterval(refreshNowPlaying, 1000)
