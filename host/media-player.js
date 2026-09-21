import { readFileSync } from 'node:fs'

const tokenPath = process.env.HERTHING_SPOTIFY_TOKEN_FILE || `${process.env.HOME}/.cache/spotify-player/user_client_token.json`
const clientId = process.env.HERTHING_SPOTIFY_CLIENT_ID || 'd420a117a32841c2b3474932e49fb54b'
let token = null

function cachedToken() {
  if (!token) token = JSON.parse(readFileSync(tokenPath, 'utf8'))
  return token
}

async function accessToken(fetchImpl = fetch, forceRefresh = false) {
  const current = cachedToken()
  const expiresAt = Date.parse(String(current.expires_at || '').replace(/(\.\d{3})\d+Z$/, '$1Z'))
  if (!forceRefresh && current.access_token && Number.isFinite(expiresAt) && expiresAt > Date.now() + 60000) return current.access_token
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: current.refresh_token, client_id: clientId })
  const response = await fetchImpl('https://accounts.spotify.com/api/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body
  })
  const result = await response.json()
  if (!response.ok) throw new Error(result?.error_description || `Spotify token refresh returned ${response.status}`)
  token = {
    ...current,
    ...result,
    refresh_token: result.refresh_token || current.refresh_token,
    expires_at: new Date(Date.now() + Number(result.expires_in || 3600) * 1000).toISOString()
  }
  return token.access_token
}

async function spotifyRequest(path, options = {}, fetchImpl = fetch) {
  const request = async (forceRefresh) => fetchImpl(`https://api.spotify.com/v1${path}`, {
    ...options,
    headers: { ...options.headers, authorization: `Bearer ${await accessToken(fetchImpl, forceRefresh)}` }
  })
  let response = await request(false)
  if (response.status === 401) response = await request(true)
  return response
}

export function normalizePlayback(playback) {
  const item = playback?.item
  if (!item?.name) return null
  return {
    track: item.name,
    artist: (item.artists || []).map((artist) => artist.name).filter(Boolean).join(', ') || 'Unknown artist',
    album: item.album?.name || null,
    artwork_source_url: item.album?.images?.[0]?.url || null,
    duration_ms: Number(item.duration_ms || 0),
    position_ms: Number(playback.progress_ms || 0),
    playing: Boolean(playback.is_playing),
    device: playback.device?.name || null,
    device_id: playback.device?.id || null,
    shuffle: Boolean(playback.shuffle_state),
    repeat: ['off', 'track', 'context'].includes(playback.repeat_state) ? playback.repeat_state : 'off'
  }
}

export async function readNowPlaying(fetchImpl = fetch) {
  const response = await spotifyRequest('/me/player', {}, fetchImpl)
  if (response.status === 204) return null
  if (!response.ok) throw new Error(`Spotify playback returned ${response.status}`)
  return normalizePlayback(await response.json())
}

export async function readSpotifyDevices(fetchImpl = fetch) {
  const response = await spotifyRequest('/me/player/devices', {}, fetchImpl)
  if (!response.ok) throw new Error(`Spotify devices returned ${response.status}`)
  const result = await response.json()
  return (result.devices || []).filter((device) => device.id).map((device) => ({
    id: device.id,
    name: device.name || 'Spotify device',
    type: device.type || 'unknown',
    active: Boolean(device.is_active),
    restricted: Boolean(device.is_restricted),
    volume: device.volume_percent == null ? null : Number(device.volume_percent)
  }))
}

const commands = {
  'spotify.pause': { path: '/me/player/pause', method: 'PUT' },
  'spotify.play': { path: '/me/player/play', method: 'PUT' },
  'spotify.previous': { path: '/me/player/previous', method: 'POST' },
  'spotify.next': { path: '/me/player/next', method: 'POST' }
}

export async function executeMediaCommand(command, context = {}, fetchImpl = fetch) {
  if (typeof context === 'boolean') context = { playing: context }
  const deviceQuery = context.device_id ? `?device_id=${encodeURIComponent(context.device_id)}` : ''
  const action = command === 'spotify.toggle'
    ? { path: (context.playing ? '/me/player/pause' : '/me/player/play') + deviceQuery, method: 'PUT' }
    : command === 'spotify.transfer' && context.device_id
      ? { path: '/me/player', method: 'PUT', body: { device_ids: [context.device_id], play: true } }
      : command === 'spotify.shuffle' && typeof context.enabled === 'boolean'
        ? { path: `/me/player/shuffle?state=${context.enabled}`, method: 'PUT' }
        : command === 'spotify.repeat' && ['off', 'track', 'context'].includes(context.mode)
          ? { path: `/me/player/repeat?state=${context.mode}`, method: 'PUT' }
          : commands[command]
  if (!action) return false
  const options = { method: action.method }
  if (action.body) {
    options.headers = { 'content-type': 'application/json' }
    options.body = JSON.stringify(action.body)
  }
  const response = await spotifyRequest(action.path, options, fetchImpl)
  if (!response.ok) throw new Error(`Spotify control returned ${response.status}`)
  return true
}

export function resetSpotifyTokenForTest() { token = null }
export function setSpotifyTokenForTest(value) { token = value }
