import { fetchWeather, weatherConfig } from './weather.js'
import { calendarConfig, fetchNextEvent } from './calendar.js'
import { executeMediaCommand, readNowPlaying } from './media-player.js'
import { setSystemVolume } from './system-volume.js'

const protocol = 'herthing/1'
const bindHost = process.env.HERTHING_HOST || '172.16.42.1'
const port = Number(process.env.HERTHING_PORT || 8787)
const clients = new Set()

let revision = 1
let state = {
  weather: null,
  next_event: null,
  now_playing: null,
  microphone: { mode: 'off', activity: 'idle' },
  transcript: null,
  assistant_response: null
}

function clockState() {
  return {
    time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    utc_offset_minutes: -new Date().getTimezoneOffset()
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
    'now_playing',
    'microphone',
    'transcript',
    'assistant_response'
  ]
  for (const key of allowed) {
    if (Object.hasOwn(patch, key)) state[key] = patch[key]
  }
  revision += 1
  broadcast()
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function refreshNowPlaying() {
  const nowPlaying = readNowPlaying()
  if (!sameValue(nowPlaying, state.now_playing)) mergeState({ now_playing: nowPlaying })
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
    mergeState({ next_event: await fetchNextEvent(configuredCalendar) })
    console.log('[calendar] next event refreshed')
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
      return Response.json({ ok: true, protocol, revision, clients: clients.size })
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
